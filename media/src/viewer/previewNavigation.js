import { cleanText } from "./shared.js";

export function createPreviewNavigationController({
  basename,
  debugToc,
  elements,
  hasTextSelectionWithin,
  openMediaPanelAt,
  renderMediaPanel,
  renderToc,
  showModal,
  state,
  vscode,
}) {
  function collectPreviewArtifacts() {
    state.links = collectPreviewLinks();
    state.mediaItems = collectPreviewMedia();
    if (state.activeMediaIndex >= state.mediaItems.length) {
      state.activeMediaIndex = 0;
    }

    console.log("[Markdown Helpers][media] Collected preview media", {
      count: state.mediaItems.length,
      selectedPath: state.selectedPath,
    });
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
    image.classList.add("is-preview-media");

    const linkedAnchor = image.closest("a[href]");
    if (linkedAnchor instanceof HTMLAnchorElement) {
      decorateLinkedPreviewImage(linkedAnchor, image, index);
      return;
    }

    if (image.dataset.mediaBound === "true") {
      return;
    }

    image.dataset.mediaBound = "true";
    image.tabIndex = 0;
    image.setAttribute("role", "button");
    image.setAttribute("aria-label", "Open image in media carousel modal");
    image.addEventListener("click", (event) => {
      console.log("[Markdown Helpers][media] Standalone image clicked", {
        index,
        src: image.currentSrc || image.getAttribute("src") || "",
      });
      if (!isPlainPrimaryActivation(event) || hasTextSelectionWithin(image)) {
        return;
      }

      event.preventDefault();
      openMediaModalAt(index, "image");
    });
    image.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        console.log(
          "[Markdown Helpers][media] Standalone image keyboard open",
          {
            index,
            key: event.key,
          },
        );
        openMediaModalAt(index, "image-keyboard");
      }
    });
  }

  function decorateLinkedPreviewImage(anchor, image, index) {
    anchor.dataset.mediaIndex = String(index);
    anchor.classList.add("is-preview-media-link");

    if (anchor.dataset.mediaBound === "true") {
      return;
    }

    anchor.dataset.mediaBound = "true";
    anchor.setAttribute("aria-label", "Open image in media carousel modal");

    image.addEventListener("click", (event) => {
      console.log("[Markdown Helpers][media] Linked image clicked", {
        index,
        href: anchor.getAttribute("href") || "",
        src: image.currentSrc || image.getAttribute("src") || "",
      });
      if (!isPlainPrimaryActivation(event) || hasTextSelectionWithin(image)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      openMediaModalAt(index, "linked-image");
    });

    anchor.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      if (hasTextSelectionWithin(anchor)) {
        return;
      }

      event.preventDefault();
      console.log("[Markdown Helpers][media] Linked image keyboard open", {
        index,
        key: event.key,
      });
      openMediaModalAt(index, "linked-image-keyboard");
    });
  }

  function openMediaModalAt(index, source) {
    if (state.mediaItems.length === 0) {
      console.log(
        "[Markdown Helpers][media] Modal open skipped; no media items",
        {
          requestedIndex: index,
          source,
        },
      );
      return;
    }

    state.activeMediaIndex = clampMediaIndex(index);
    renderMediaPanel();

    console.log("[Markdown Helpers][media] Opening media modal", {
      activeIndex: state.activeMediaIndex,
      source,
      total: state.mediaItems.length,
    });

    const modalStage = document.createElement("div");
    modalStage.className = "media-stage media-modal-stage";

    const frame = document.createElement("div");
    frame.className = "media-stage-frame media-modal-frame";

    const previousButton = document.createElement("button");
    previousButton.type = "button";
    previousButton.className =
      "ghost-button icon-button icon-chevron-left media-nav-button";
    previousButton.title = "Previous image";
    previousButton.setAttribute("aria-label", "Previous image");

    const stageImage = document.createElement("img");
    stageImage.className = "media-stage-image media-modal-image";
    stageImage.alt = "";

    const nextButton = document.createElement("button");
    nextButton.type = "button";
    nextButton.className =
      "ghost-button icon-button icon-chevron-right media-nav-button";
    nextButton.title = "Next image";
    nextButton.setAttribute("aria-label", "Next image");

    frame.append(previousButton, stageImage, nextButton);

    const meta = document.createElement("div");
    meta.className = "media-stage-meta media-modal-meta";

    const metaBlock = document.createElement("div");

    const counter = document.createElement("p");
    counter.className = "media-counter";

    const caption = document.createElement("p");
    caption.className = "media-caption";

    const details = document.createElement("p");
    details.className = "media-meta";

    metaBlock.append(counter, caption, details);
    meta.append(metaBlock);

    const thumbs = document.createElement("div");
    thumbs.className = "media-thumbs media-modal-thumbs";
    thumbs.setAttribute("role", "list");

    modalStage.append(frame, meta, thumbs);
    modalStage.addEventListener("click", (event) => {
      event.stopPropagation();
    });

    const modal = showModal({
      title: "Image carousel",
      subtitle: `${state.mediaItems.length} rendered image${state.mediaItems.length === 1 ? "" : "s"} in this file.`,
      content: modalStage,
      wide: true,
    });
    const modalContent = modalStage.closest(".modal-content");
    if (modalContent instanceof HTMLElement) {
      modalContent.classList.add("has-media-modal");
    }

    const syncModalLayout = () => {
      if (!(modalContent instanceof HTMLElement) || !modal.isActive()) {
        return;
      }

      const stageStyles = window.getComputedStyle(modalStage);
      const rowGap =
        Number.parseFloat(stageStyles.rowGap || stageStyles.gap || "0") || 0;
      const reservedHeight =
        meta.offsetHeight + thumbs.offsetHeight + rowGap * 2;
      const availableHeight = Math.max(
        0,
        modalContent.clientHeight - reservedHeight,
      );

      frame.style.height = `${availableHeight}px`;
    };

    const renderModal = () => {
      const item = state.mediaItems[state.activeMediaIndex];
      if (!item) {
        return;
      }

      stageImage.src = item.src;
      stageImage.alt = item.alt || item.caption || "Preview image";
      counter.textContent = `${state.activeMediaIndex + 1} of ${state.mediaItems.length}`;
      caption.textContent = item.caption;
      details.textContent = item.meta;
      previousButton.disabled = state.mediaItems.length < 2;
      nextButton.disabled = state.mediaItems.length < 2;
      thumbs.innerHTML = "";

      state.mediaItems.forEach((mediaItem, mediaIndex) => {
        const thumbButton = document.createElement("button");
        thumbButton.type = "button";
        thumbButton.className = "media-thumb-button";
        if (mediaIndex === state.activeMediaIndex) {
          thumbButton.classList.add("is-active");
        }
        thumbButton.setAttribute(
          "aria-label",
          `Show image ${mediaIndex + 1}: ${mediaItem.caption}`,
        );

        const thumbImage = document.createElement("img");
        thumbImage.src = mediaItem.src;
        thumbImage.alt = mediaItem.alt || mediaItem.caption;

        thumbButton.append(thumbImage);
        thumbButton.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          state.activeMediaIndex = mediaIndex;
          renderMediaPanel();
          renderModal();
        });
        thumbs.append(thumbButton);
      });

      window.requestAnimationFrame(syncModalLayout);
    };

    const stepModal = (delta) => {
      if (state.mediaItems.length < 2) {
        return;
      }

      state.activeMediaIndex = clampMediaIndex(state.activeMediaIndex + delta);
      renderMediaPanel();
      renderModal();
    };

    previousButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      stepModal(-1);
    });
    nextButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      stepModal(1);
    });

    const handleModalKeydown = (event) => {
      if (!modal.isActive()) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        stepModal(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        stepModal(1);
      }
    };

    const handleWindowResize = () => {
      window.requestAnimationFrame(syncModalLayout);
    };

    stageImage.addEventListener("load", syncModalLayout);

    document.addEventListener("keydown", handleModalKeydown);
    window.addEventListener("resize", handleWindowResize);
    renderModal();
    modal.setOnClose(() => {
      document.removeEventListener("keydown", handleModalKeydown);
      window.removeEventListener("resize", handleWindowResize);
      stageImage.removeEventListener("load", syncModalLayout);
      if (modalContent instanceof HTMLElement) {
        modalContent.classList.remove("has-media-modal");
      }
    });
  }

  function clampMediaIndex(index) {
    if (state.mediaItems.length === 0) {
      return 0;
    }

    return (
      ((index % state.mediaItems.length) + state.mediaItems.length) %
      state.mediaItems.length
    );
  }

  function isPlainPrimaryActivation(event) {
    return (
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey
    );
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
    if (!src) {
      return hint;
    }

    if (/^data:/i.test(src)) {
      return `${hint} • Embedded data image`;
    }

    return `${hint} • ${src}`;
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
