export function createPanelRenderingController({
  basename,
  debugToc,
  dirname,
  elements,
  formatAge,
  formatWordCount,
  getCurrentScrollTop,
  isDesktopInspectorLayout,
  openLinkItem,
  scrollToHeadingById,
  setFilesPanelOpen,
  setInspectorPanel,
  setMediaPanelOpen,
  state,
  vscode,
}) {
  function renderFiles() {
    elements.filesList.innerHTML = "";
    const files = getFilteredFiles();
    const hasAnyFiles = state.files.length > 0;
    elements.filesEmptyState.classList.toggle("hidden", files.length > 0);
    elements.filesEmptyState.textContent = hasAnyFiles
      ? "No markdown files match the current filter."
      : "No markdown files found.";

    for (const file of files) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "file-row";
      if (file.relativePath === state.selectedPath) {
        button.classList.add("is-active");
      }

      const title = document.createElement("div");
      title.className = "file-row-title";
      title.textContent = basename(file.relativePath);

      const meta = document.createElement("div");
      meta.className = "file-row-meta";
      meta.textContent = `${formatAge(file.mtimeMs)} • ${file.headingCount} headings • ${formatWordCount(file.wordCount)}`;

      const location = document.createElement("div");
      location.className = "file-row-path";
      location.textContent = dirname(file.relativePath);

      button.append(title, meta, location);
      button.addEventListener("click", () => {
        vscode.postMessage({
          type: "openFile",
          path: file.relativePath,
        });
        setFilesPanelOpen(false);
      });
      elements.filesList.append(button);
    }
  }

  function renderToc() {
    elements.tocList.innerHTML = "";
    elements.tocEmptyState.classList.toggle("hidden", state.toc.length > 0);
    elements.tocEmptyState.textContent = state.selectedPath
      ? "No headings were rendered for this file."
      : "Choose a markdown file to browse its headings.";
    debugToc("renderToc", {
      tocItems: state.toc.length,
      activeHeadingId: state.activeHeadingId,
    });

    for (const item of state.toc) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "toc-link";
      button.style.setProperty("--level", String(item.level));
      button.style.setProperty("--branch-visible", item.level > 1 ? "1" : "0");
      if (item.id === state.activeHeadingId) {
        button.classList.add("is-active");
      }
      button.textContent = item.text;
      button.addEventListener("click", () => {
        if (scrollToHeadingById(item.id)) {
          debugToc("tocClick", {
            id: item.id,
            currentScrollTop: getCurrentScrollTop(),
          });
        }
        state.activeHeadingId = item.id;
        renderToc();
        if (!isDesktopInspectorLayout()) {
          setInspectorPanel(undefined);
        }
      });
      elements.tocList.append(button);
    }

    ensureActiveTocItemVisible();
  }

  function renderLinks() {
    elements.linksList.innerHTML = "";
    const hasLinks = state.links.length > 0;
    elements.linksEmptyState.classList.toggle("hidden", hasLinks);
    elements.linksEmptyState.textContent = state.selectedPath
      ? "No authored links or detected path references were found in this file."
      : "Choose a markdown file to inspect its links and detected paths.";

    for (const item of state.links) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "link-card";

      const header = document.createElement("div");
      header.className = "link-card-header";

      const title = document.createElement("div");
      title.className = "link-card-title";
      title.textContent = item.label;

      const badges = document.createElement("div");
      badges.className = "link-card-badges";

      badges.append(createLinkBadge(item.kind, `kind-${item.kind}`));
      if (item.source === "detected") {
        badges.append(createLinkBadge("Detected", "kind-detected"));
      }
      if (item.count > 1) {
        badges.append(createLinkBadge(`${item.count} refs`, "kind-count"));
      }

      const href = document.createElement("div");
      href.className = "link-card-href";
      href.textContent = item.href;

      const context = document.createElement("div");
      context.className = "link-card-context";
      context.textContent = item.context;

      header.append(title, badges);
      button.append(header, href, context);
      button.addEventListener("click", () => {
        openLinkItem(item);
        if (!isDesktopInspectorLayout() && item.kind !== "external") {
          setInspectorPanel(undefined);
        }
      });

      elements.linksList.append(button);
    }

    updateInspectorCopy();
  }

  function renderMediaPanel() {
    const hasMedia = state.mediaItems.length > 0;
    if (!hasMedia) {
      state.activeMediaIndex = 0;
    } else if (state.activeMediaIndex >= state.mediaItems.length) {
      state.activeMediaIndex = 0;
    }

    elements.toggleMediaButton.disabled = !hasMedia;
    elements.toggleMediaButton.setAttribute("aria-disabled", String(!hasMedia));
    elements.mediaEmptyState.classList.toggle("hidden", hasMedia);
    elements.mediaStage.classList.toggle("hidden", !hasMedia);
    elements.mediaThumbs.innerHTML = "";

    if (!hasMedia) {
      elements.mediaStageImage.removeAttribute("src");
      elements.mediaStageImage.alt = "";
      elements.mediaCounter.textContent = "";
      elements.mediaCaption.textContent = "";
      elements.mediaMeta.textContent = "";
      elements.mediaSubtitle.textContent = state.selectedPath
        ? "This file does not render any images yet."
        : "Choose a markdown file to browse its rendered images.";
      elements.mediaPrevButton.disabled = true;
      elements.mediaNextButton.disabled = true;
      if (state.mediaPanelOpen) {
        setMediaPanelOpen(false);
      }
      return;
    }

    const item = state.mediaItems[state.activeMediaIndex];
    elements.mediaStageImage.src = item.src;
    elements.mediaStageImage.alt = item.alt || item.caption || "Preview image";
    elements.mediaCounter.textContent = `${state.activeMediaIndex + 1} of ${state.mediaItems.length}`;
    elements.mediaCaption.textContent = item.caption;
    elements.mediaMeta.textContent = item.meta;
    elements.mediaSubtitle.textContent = `${state.mediaItems.length} rendered image${state.mediaItems.length === 1 ? "" : "s"} in this file.`;
    elements.mediaPrevButton.disabled = state.mediaItems.length < 2;
    elements.mediaNextButton.disabled = state.mediaItems.length < 2;

    state.mediaItems.forEach((mediaItem, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "media-thumb-button";
      if (index === state.activeMediaIndex) {
        button.classList.add("is-active");
      }
      button.setAttribute(
        "aria-label",
        `Show image ${index + 1}: ${mediaItem.caption}`,
      );

      const image = document.createElement("img");
      image.src = mediaItem.src;
      image.alt = mediaItem.alt || mediaItem.caption;

      button.append(image);
      button.addEventListener("click", () => {
        state.activeMediaIndex = index;
        renderMediaPanel();
      });
      elements.mediaThumbs.append(button);
    });
  }

  function updateInspectorCopy() {
    if (state.activeInspectorPanel === "links") {
      elements.inspectorEyebrow.textContent = "Links";
      elements.inspectorTitle.textContent = "Link Inventory";
      elements.inspectorSubtitle.textContent = state.selectedPath
        ? `${state.links.length} unique references across authored links and detected path tokens.`
        : "Choose a markdown file to inspect every rendered link.";
      return;
    }

    elements.inspectorEyebrow.textContent = "Outline";
    elements.inspectorTitle.textContent = "Sections";
    elements.inspectorSubtitle.textContent = state.selectedPath
      ? `${state.toc.length} headings mapped from the current document.`
      : "Choose a markdown file to follow its structure.";
  }

  function getFilteredFiles() {
    if (!state.filesFilterQuery) {
      return state.files;
    }

    return state.files.filter((file) =>
      file.relativePath.toLowerCase().includes(state.filesFilterQuery),
    );
  }

  function ensureActiveTocItemVisible() {
    const activeItem = elements.tocList.querySelector(".toc-link.is-active");
    if (!(activeItem instanceof HTMLElement)) {
      return;
    }

    const listRect = elements.tocList.getBoundingClientRect();
    const itemRect = activeItem.getBoundingClientRect();
    const topDelta = itemRect.top - listRect.top;
    const bottomDelta = itemRect.bottom - listRect.bottom;

    if (topDelta < 0) {
      elements.tocList.scrollTop += topDelta - 12;
      return;
    }

    if (bottomDelta > 0) {
      elements.tocList.scrollTop += bottomDelta + 12;
    }
  }

  return {
    renderFiles,
    renderLinks,
    renderMediaPanel,
    renderToc,
    updateInspectorCopy,
  };
}

function createLinkBadge(label, className) {
  const badge = document.createElement("span");
  badge.className = `link-card-badge ${className}`;
  badge.textContent = label;
  return badge;
}
