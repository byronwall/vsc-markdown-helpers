import { cleanText } from "./shared.js";

export function createPreviewNavigationController({
  basename,
  debugToc,
  elements,
  hasTextSelectionWithin,
  openMediaPanelAt,
  renderToc,
  state,
  vscode,
}) {
  function collectPreviewArtifacts() {
    state.links = collectPreviewLinks();
    state.mediaItems = collectPreviewMedia();
    if (state.activeMediaIndex >= state.mediaItems.length) {
      state.activeMediaIndex = 0;
    }
  }

  function bindInternalAnchorLinks() {
    const anchors = elements.previewContent.querySelectorAll(
      "a.anchor-link[href^='#']",
    );
    for (const anchor of anchors) {
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.dataset.anchorBound === "true"
      ) {
        continue;
      }

      anchor.dataset.anchorBound = "true";
      anchor.addEventListener("click", (event) => {
        if (hasTextSelectionWithin(anchor)) {
          return;
        }

        event.preventDefault();
        const href = anchor.getAttribute("href") || "";
        if (href.startsWith("#")) {
          scrollToHeadingById(href.slice(1));
        }
      });
    }
  }

  function handlePreviewLocalLinkNavigation(href) {
    const { pathPart, hash } = splitHrefHash(href);
    if (!hash || !targetsCurrentDocument(pathPart)) {
      return false;
    }

    return scrollToHeadingById(hash);
  }

  function openLinkItem(item) {
    if (item.kind === "external") {
      window.open(item.href, "_blank", "noopener");
      return;
    }

    if (item.kind === "heading") {
      scrollToHeadingById(item.href.slice(1));
      return;
    }

    if (handlePreviewLocalLinkNavigation(item.href)) {
      return;
    }

    vscode.postMessage({ type: "openLocalLink", href: item.href });
  }

  function scrollToHeadingById(id) {
    const target = getHeadingElement(decodeFragmentPart(id));
    if (!target) {
      return false;
    }

    const scrollTarget = getDocumentScrollTopForElement(target);
    window.scrollTo({ top: scrollTarget, behavior: "smooth" });
    state.activeHeadingId = target.id;
    flashHeadingTarget(target);
    renderToc();
    updateWindowHash(target.id);
    return true;
  }

  function syncActiveHeading() {
    if (state.headings.length === 0) {
      if (state.activeHeadingId !== undefined) {
        state.activeHeadingId = undefined;
        renderToc();
      }
      return;
    }

    const scrollTop = getCurrentScrollTop();
    const activationOffset = 120;
    let activeId = state.headings[0].id;

    for (const heading of state.headings) {
      const top = getHeadingTopInDocument(heading);
      if (top <= scrollTop + activationOffset) {
        activeId = heading.id;
        continue;
      }
      break;
    }

    if (activeId !== state.activeHeadingId) {
      debugToc("activeHeadingChanged", {
        previous: state.activeHeadingId,
        next: activeId,
        scrollTop,
      });
      state.activeHeadingId = activeId;
      renderToc();
    }
  }

  function scheduleSyncActiveHeading() {
    window.requestAnimationFrame(syncActiveHeading);
  }

  function getCurrentScrollTop() {
    const scrollingElement =
      document.scrollingElement || document.documentElement;
    return scrollingElement.scrollTop;
  }

  function collectPreviewLinks() {
    const anchors = Array.from(
      elements.previewContent.querySelectorAll("a[data-local-href], a[href]"),
    );
    const items = [];
    const itemsByKey = new Map();

    for (const anchor of anchors) {
      const item = buildLinkItem(anchor);
      if (!item) {
        continue;
      }

      const existing = itemsByKey.get(item.key);
      if (existing) {
        existing.count += 1;
        if (!existing.context && item.context) {
          existing.context = item.context;
        }
        continue;
      }

      itemsByKey.set(item.key, item);
      items.push(item);
    }

    return items;
  }

  function buildLinkItem(anchor) {
    if (!(anchor instanceof HTMLAnchorElement)) {
      return undefined;
    }

    const authoredHref =
      anchor.dataset.localHref || anchor.getAttribute("href") || "";
    if (!authoredHref || authoredHref === "#") {
      return undefined;
    }

    const kind = getLinkKind(authoredHref, anchor);
    const source = anchor.classList.contains("preview-detected-link")
      ? "detected"
      : "authored";
    const text =
      cleanText(anchor.textContent) ||
      cleanText(anchor.querySelector("img")?.getAttribute("alt")) ||
      authoredHref;

    return {
      key: `${kind}:${source}:${authoredHref}`,
      href: authoredHref,
      label: text,
      kind,
      source,
      count: 1,
      context: getLinkContext(anchor),
    };
  }

  function getLinkKind(href, anchor) {
    if (href.startsWith("#")) {
      return "heading";
    }

    if (/^(https?|mailto):/i.test(href)) {
      return "external";
    }

    if (anchor.dataset.linkKind === "markdown") {
      return "markdown";
    }

    return "file";
  }

  function getLinkContext(anchor) {
    const contextNode = anchor.closest(
      "p, li, blockquote, td, th, figcaption, summary, dd",
    );
    const source = cleanText(contextNode?.textContent);
    if (!source) {
      return "Referenced in the rendered preview.";
    }

    return source.length > 140 ? `${source.slice(0, 137)}...` : source;
  }

  function collectPreviewMedia() {
    const images = Array.from(
      elements.previewContent.querySelectorAll("img[src]"),
    );
    const items = [];
    const mediaIndexByKey = new Map();

    for (const image of images) {
      if (!(image instanceof HTMLImageElement)) {
        continue;
      }

      const src = image.currentSrc || image.getAttribute("src") || "";
      if (!src) {
        continue;
      }

      const caption = getMediaCaption(image);
      const key = `${src}:${caption}`;
      let index = mediaIndexByKey.get(key);
      if (index === undefined) {
        index = items.length;
        items.push({
          src,
          alt: image.alt || "",
          caption,
          meta: getMediaMeta(image),
        });
        mediaIndexByKey.set(key, index);
      }

      decoratePreviewImage(image, index);
    }

    return items;
  }

  function decoratePreviewImage(image, index) {
    image.dataset.mediaIndex = String(index);
    if (image.dataset.mediaBound === "true" || image.closest("a[href]")) {
      return;
    }

    image.dataset.mediaBound = "true";
    image.classList.add("is-preview-media");
    image.tabIndex = 0;
    image.setAttribute("role", "button");
    image.setAttribute("aria-label", "Open image in media carousel");
    image.addEventListener("click", () => {
      openMediaPanelAt(index);
    });
    image.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openMediaPanelAt(index);
      }
    });
  }

  function getMediaCaption(image) {
    const figureCaption = cleanText(
      image.closest("figure")?.querySelector("figcaption")?.textContent,
    );
    return (
      figureCaption ||
      cleanText(image.getAttribute("title")) ||
      cleanText(image.getAttribute("alt")) ||
      "Rendered image"
    );
  }

  function getMediaMeta(image) {
    const src = image.getAttribute("src") || "";
    const hint = image.alt ? `Alt text: ${image.alt}` : "Rendered in preview";
    return src ? `${hint} • ${src}` : hint;
  }

  function getHeadingElement(id) {
    if (!id || typeof CSS === "undefined" || typeof CSS.escape !== "function") {
      return document.getElementById(id);
    }

    return elements.previewContent.querySelector(`#${CSS.escape(id)}`);
  }

  function getDocumentScrollTopForElement(element) {
    const scrollingElement =
      document.scrollingElement || document.documentElement;
    const targetRect = element.getBoundingClientRect();
    return Math.max(
      scrollingElement.scrollTop + targetRect.top - getStickyScrollOffset(),
      0,
    );
  }

  function getHeadingTopInDocument(heading) {
    const scrollingElement =
      document.scrollingElement || document.documentElement;
    return heading.getBoundingClientRect().top + scrollingElement.scrollTop;
  }

  function getStickyScrollOffset() {
    return (elements.topbar?.offsetHeight ?? 88) + 28;
  }

  function splitHrefHash(href) {
    const hashIndex = href.indexOf("#");
    if (hashIndex < 0) {
      return { pathPart: href, hash: "" };
    }

    return {
      pathPart: href.slice(0, hashIndex),
      hash: href.slice(hashIndex + 1),
    };
  }

  function targetsCurrentDocument(pathPart) {
    const normalizedTarget = normalizeDocPath(pathPart);
    if (!normalizedTarget) {
      return true;
    }

    const currentPath = normalizeDocPath(state.selectedPath || "");
    const currentName = normalizeDocPath(basename(state.selectedPath || ""));
    const targetName = normalizeDocPath(
      normalizedTarget.split("/").pop() || "",
    );
    return (
      normalizedTarget === currentPath ||
      normalizedTarget === currentName ||
      targetName === currentName
    );
  }

  function normalizeDocPath(value) {
    return decodeFragmentPart(value)
      .replace(/\\/g, "/")
      .replace(/^\.\//, "")
      .replace(/\/$/, "")
      .toLowerCase();
  }

  function decodeFragmentPart(value) {
    try {
      return decodeURIComponent(value || "");
    } catch {
      return value || "";
    }
  }

  function flashHeadingTarget(target) {
    target.classList.add("is-anchor-target");
    if (state.headingHighlightTimer) {
      window.clearTimeout(state.headingHighlightTimer);
    }

    state.headingHighlightTimer = window.setTimeout(() => {
      target.classList.remove("is-anchor-target");
      state.headingHighlightTimer = undefined;
    }, 1400);
  }

  function updateWindowHash(id) {
    if (!id) {
      return;
    }

    if (window.history?.replaceState) {
      window.history.replaceState(undefined, "", `#${encodeURIComponent(id)}`);
    } else {
      window.location.hash = id;
    }
  }

  return {
    bindInternalAnchorLinks,
    collectPreviewArtifacts,
    getCurrentScrollTop,
    handlePreviewLocalLinkNavigation,
    openLinkItem,
    scheduleSyncActiveHeading,
    scrollToHeadingById,
    syncActiveHeading,
  };
}
