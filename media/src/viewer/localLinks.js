import { hasTextSelectionWithin } from "./shared.js";
import { applySyntaxHighlighting } from "./syntaxHighlighting.js";

const PATH_TOKEN_RE =
  /(^|[\s([{"'`])((?:file:\/\/\/|~\/|\.\.\/|\.\/|\/)?[A-Za-z0-9_@.~-]+(?:\/[A-Za-z0-9_@.,+=~-]+)+(?:\/)?(?:(?::\d+(?::\d+)?(?:-\d+)?)|(?:#L\d+(?:C\d+)?(?:-L?\d+)?)|(?:#\S+))?)(?=$|[\s)\]}"'`.,;!?])/gm;

let localLinkHoverCard;
let localLinkHoverActiveGroup;
let localLinkHoverRequestToken = 0;
let localLinkHoverListenersBound = false;

export async function enhanceLocalLinks(container, tools) {
  const localAnchors = Array.from(
    container.querySelectorAll("a[data-local-href]"),
  );

  const textNodes = collectLinkableTextNodes(container);
  const hrefs = new Set();
  for (const anchor of localAnchors) {
    const href = anchor.getAttribute("data-local-href");
    if (href) {
      hrefs.add(href);
    }
  }

  for (const node of textNodes) {
    for (const match of getPathTokenMatches(node.textContent || "")) {
      hrefs.add(match.rawValue);
    }
  }

  const resolvedByHref = new Map();
  if (hrefs.size > 0) {
    const resolutions = await tools.requestResolvedLocalLinks([...hrefs]);
    for (const entry of resolutions) {
      if (entry && typeof entry.href === "string") {
        resolvedByHref.set(entry.href, entry);
      }
    }
  }

  for (const anchor of localAnchors) {
    const href = anchor.getAttribute("data-local-href");
    if (href) {
      const resolution = resolvedByHref.get(href);
      if (resolution) {
        applyResolvedLocalLinkMetadata(anchor, resolution);
      }
    }
    activateLocalLink(anchor, tools);
  }

  for (const node of textNodes) {
    replacePathTokensInTextNode(node, tools, resolvedByHref);
  }
}

function collectLinkableTextNodes(container) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!(node.parentElement instanceof HTMLElement)) {
        return NodeFilter.FILTER_REJECT;
      }

      if (
        node.parentElement.closest(
          "a, pre, script, style, button, input, textarea",
        )
      ) {
        return NodeFilter.FILTER_REJECT;
      }

      if (!node.textContent || !containsPathToken(node.textContent)) {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes = [];
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode);
  }

  return textNodes;
}

function containsPathToken(text) {
  return new RegExp(PATH_TOKEN_RE).test(text);
}

function getPathTokenMatches(text) {
  const matches = [];

  for (const match of text.matchAll(PATH_TOKEN_RE)) {
    const rawValue = match[2];
    if (!rawValue) {
      continue;
    }

    matches.push({
      prefix: match[1] || "",
      rawValue,
      index: match.index ?? 0,
    });
  }

  return matches;
}

function replacePathTokensInTextNode(node, tools, resolvedByHref) {
  if (!node.parentNode) {
    return;
  }

  const text = node.textContent || "";
  const fragment = document.createDocumentFragment();
  const anchors = [];
  let cursor = 0;

  for (const match of getPathTokenMatches(text)) {
    const resolution = resolvedByHref.get(match.rawValue);
    if (!resolution) {
      continue;
    }

    const startOffset = match.index + match.prefix.length;
    const endOffset = startOffset + match.rawValue.length;
    fragment.append(text.slice(cursor, startOffset));
    const anchor = createLocalLinkAnchor(match.rawValue, resolution);
    fragment.append(anchor);
    anchors.push(anchor);
    cursor = endOffset;
  }

  if (anchors.length === 0) {
    return;
  }

  fragment.append(text.slice(cursor));
  node.replaceWith(fragment);
  for (const anchor of anchors) {
    activateLocalLink(anchor, tools);
  }
}

function createLocalLinkAnchor(rawValue, resolution) {
  const anchor = document.createElement("a");
  anchor.href = "#";
  anchor.className = "preview-link preview-detected-link";
  anchor.dataset.localHref = rawValue;
  applyResolvedLocalLinkMetadata(anchor, resolution);
  anchor.textContent = rawValue;
  return anchor;
}

function applyResolvedLocalLinkMetadata(anchor, resolution) {
  const kind = resolution.isMarkdown ? "markdown" : "file";
  anchor.dataset.linkKind = kind;
  anchor.classList.remove("is-markdown-link", "is-file-link");
  anchor.classList.add(
    kind === "markdown" ? "is-markdown-link" : "is-file-link",
  );

  if (typeof resolution.tooltip === "string" && resolution.tooltip.length > 0) {
    anchor.dataset.previewTooltip = resolution.tooltip;
    return;
  }

  delete anchor.dataset.previewTooltip;
}

function activateLocalLink(anchor, tools) {
  if (
    !(anchor instanceof HTMLAnchorElement) ||
    anchor.dataset.linkEnhanced === "true"
  ) {
    return;
  }

  const href = anchor.getAttribute("data-local-href");
  if (!href) {
    return;
  }

  anchor.dataset.linkEnhanced = "true";
  anchor.addEventListener("click", (event) => {
    if (hasTextSelectionWithin(anchor)) {
      return;
    }

    event.preventDefault();
    if (typeof tools.handleLocalLinkNavigation === "function") {
      const handled = tools.handleLocalLinkNavigation(href, anchor);
      if (handled) {
        return;
      }
    }
    tools.vscode.postMessage({ type: "openLocalLink", href });
  });

  if (anchor.querySelector("img, svg, table, pre, code, div")) {
    return;
  }

  let group = anchor.parentElement;
  if (
    !(group instanceof HTMLElement) ||
    !group.classList.contains("preview-link-group")
  ) {
    group = document.createElement("span");
    group.className = "preview-link-group";
    anchor.replaceWith(group);
    group.append(anchor);
  }

  group.classList.add("is-local-link");
  group.classList.toggle(
    "is-markdown-link",
    anchor.dataset.linkKind === "markdown",
  );
  group.classList.toggle(
    "is-file-link",
    anchor.dataset.linkKind !== "markdown",
  );
  group.dataset.localHref = href;

  if (anchor.dataset.previewTooltip) {
    group.dataset.previewTooltip = anchor.dataset.previewTooltip;
  }

  if (group.dataset.hoverPreviewBound !== "true") {
    group.dataset.hoverPreviewBound = "true";
    group.addEventListener("mouseenter", () => {
      void showLocalLinkHover(group, tools);
    });
    group.addEventListener("focusin", () => {
      void showLocalLinkHover(group, tools);
    });
    group.addEventListener("mouseleave", () => {
      if (localLinkHoverActiveGroup === group) {
        hideLocalLinkHover();
      }
    });
    group.addEventListener("focusout", (event) => {
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && group.contains(nextTarget)) {
        return;
      }

      if (localLinkHoverActiveGroup === group) {
        hideLocalLinkHover();
      }
    });
  }
}

function ensureLocalLinkHoverCard() {
  if (!localLinkHoverCard) {
    localLinkHoverCard = document.createElement("div");
    localLinkHoverCard.className = "preview-link-hover-card";
    localLinkHoverCard.setAttribute("aria-hidden", "true");
    document.body.append(localLinkHoverCard);
  }

  if (!localLinkHoverListenersBound) {
    localLinkHoverListenersBound = true;
    window.addEventListener(
      "scroll",
      () => {
        hideLocalLinkHover();
      },
      { passive: true },
    );
    window.addEventListener(
      "resize",
      () => {
        hideLocalLinkHover();
      },
      { passive: true },
    );
  }

  return localLinkHoverCard;
}

async function showLocalLinkHover(group, tools) {
  const href = group.dataset.localHref;
  if (!href) {
    return;
  }

  const card = ensureLocalLinkHoverCard();
  const requestToken = ++localLinkHoverRequestToken;

  if (
    localLinkHoverActiveGroup &&
    localLinkHoverActiveGroup !== group &&
    localLinkHoverActiveGroup instanceof HTMLElement
  ) {
    localLinkHoverActiveGroup.classList.remove("is-hover-preview-active");
  }

  localLinkHoverActiveGroup = group;
  group.classList.add("is-hover-preview-active");
  renderLocalLinkHoverLoading(card, href);
  positionLocalLinkHoverCard(card, group);

  const preview = await tools.requestPreviewLinkHover(href);
  if (
    requestToken !== localLinkHoverRequestToken ||
    localLinkHoverActiveGroup !== group
  ) {
    return;
  }

  if (!preview) {
    hideLocalLinkHover();
    return;
  }

  renderLocalLinkHoverPreview(card, preview);
  positionLocalLinkHoverCard(card, group);
}

function hideLocalLinkHover() {
  localLinkHoverRequestToken += 1;

  if (localLinkHoverActiveGroup instanceof HTMLElement) {
    localLinkHoverActiveGroup.classList.remove("is-hover-preview-active");
  }

  localLinkHoverActiveGroup = undefined;

  if (!localLinkHoverCard) {
    return;
  }

  localLinkHoverCard.classList.remove("is-visible");
  localLinkHoverCard.setAttribute("aria-hidden", "true");
  localLinkHoverCard.style.left = "-9999px";
  localLinkHoverCard.style.top = "-9999px";
}

function renderLocalLinkHoverLoading(card, href) {
  const fragment = document.createDocumentFragment();

  fragment.append(
    createHoverTextElement("h3", "preview-link-hover-title", href),
    createHoverTextElement(
      "p",
      "preview-link-hover-message is-loading",
      "Loading preview...",
    ),
  );

  card.replaceChildren(fragment);
  card.classList.add("is-visible");
  card.setAttribute("aria-hidden", "false");
}

function renderLocalLinkHoverPreview(card, preview) {
  const fragment = document.createDocumentFragment();
  const headerText = preview.location
    ? `${preview.displayPath} - ${preview.location}`
    : preview.displayPath;

  fragment.append(
    createHoverTextElement("h3", "preview-link-hover-title", headerText),
  );

  if (preview.note) {
    fragment.append(
      createHoverTextElement("p", "preview-link-hover-note", preview.note),
    );
  }

  if (preview.code) {
    const pre = document.createElement("pre");
    pre.className = "preview-link-hover-code modal-code-pre";

    const code = document.createElement("code");
    if (preview.language) {
      code.className = `language-${preview.language}`;
    }
    code.textContent = preview.code;

    applySyntaxHighlighting(code, preview.language);

    pre.append(code);
    fragment.append(pre);
  } else if (preview.message) {
    fragment.append(
      createHoverTextElement(
        "p",
        "preview-link-hover-message",
        preview.message,
      ),
    );
  }

  if (Array.isArray(preview.entries) && preview.entries.length > 0) {
    const list = document.createElement("ul");
    list.className = "preview-link-hover-list";

    for (const entry of preview.entries) {
      const item = document.createElement("li");
      item.textContent = entry.label;
      list.append(item);
    }

    fragment.append(list);
  }

  if (preview.footer) {
    fragment.append(
      createHoverTextElement("p", "preview-link-hover-footer", preview.footer),
    );
  }

  card.replaceChildren(fragment);
  card.classList.add("is-visible");
  card.setAttribute("aria-hidden", "false");
}

function createHoverTextElement(tagName, className, text) {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

function positionLocalLinkHoverCard(card, group) {
  const linkRect = group.getBoundingClientRect();
  const viewportPadding = 12;
  const maxWidth = Math.min(540, window.innerWidth - viewportPadding * 2);

  card.style.maxWidth = `${maxWidth}px`;
  card.style.left = "0px";
  card.style.top = "0px";

  const cardRect = card.getBoundingClientRect();
  let left = linkRect.left;
  let top = linkRect.bottom + 10;

  if (left + cardRect.width > window.innerWidth - viewportPadding) {
    left = window.innerWidth - cardRect.width - viewportPadding;
  }

  if (top + cardRect.height > window.innerHeight - viewportPadding) {
    top = linkRect.top - cardRect.height - 10;
  }

  card.style.left = `${Math.max(viewportPadding, Math.round(left))}px`;
  card.style.top = `${Math.max(viewportPadding, Math.round(top))}px`;
}
