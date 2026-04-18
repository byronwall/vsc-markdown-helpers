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

      const hrefText = getLinkHrefText(item);
      const contextText = getLinkContextText(item, hrefText);

      header.append(title, badges);
      button.append(header);
      if (hrefText) {
        const href = document.createElement("div");
        href.className = "link-card-href";
        href.textContent = hrefText;
        button.append(href);
      }
      if (contextText) {
        const context = document.createElement("div");
        context.className = "link-card-context";
        context.textContent = contextText;
        button.append(context);
      }
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

  function updateInspectorCopy() {
    if (state.activeInspectorPanel === "links") {
      elements.inspectorEyebrow.textContent = "Links";
      elements.inspectorTitle.textContent = "Link Inventory";
      elements.inspectorSubtitle.textContent = state.selectedPath
        ? summarizeLinkInventory(state.links)
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

function getLinkHrefText(item) {
  if (!item.href) {
    return "";
  }

  return normalizeLinkText(item.label) === normalizeLinkText(item.href)
    ? ""
    : item.href;
}

function getLinkContextText(item, hrefText) {
  const rawContext = item.context?.trim();
  if (!rawContext || rawContext === "Referenced in the rendered preview.") {
    return "";
  }

  const replacementLabel =
    item.kind === "external" ? "this URL" : "this target";
  const sanitizedContext = rawContext
    .split(item.href)
    .join(replacementLabel)
    .trim();
  const normalizedContext = normalizeLinkText(sanitizedContext);
  if (!normalizedContext) {
    return "";
  }

  if (
    normalizedContext === normalizeLinkText(item.label) ||
    normalizedContext === normalizeLinkText(item.href) ||
    (hrefText && normalizedContext === normalizeLinkText(hrefText))
  ) {
    return "";
  }

  return sanitizedContext;
}

function normalizeLinkText(value) {
  return (value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/["'`]+/g, "")
    .trim();
}

function summarizeLinkInventory(links) {
  const total = links.length;
  const detectedCount = links.filter(
    (item) => item.source === "detected",
  ).length;
  if (detectedCount > 0) {
    return `${total} unique references, ${detectedCount} detected`;
  }

  return `${total} unique references`;
}
