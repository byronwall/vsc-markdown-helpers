import { enhancePreview } from "./viewer/markdownRenderer.js";
import {
  basename,
  dirname,
  formatAge,
  formatWordCount,
  hasTextSelectionWithin,
} from "./viewer/shared.js";

const vscode = acquireVsCodeApi();
const panelLayoutQuery = window.matchMedia("(min-width: 1200px)");

const state = {
  files: [],
  selectedPath: undefined,
  toc: [],
  activeHeadingId: undefined,
  headings: [],
  links: [],
  mediaItems: [],
  filesPanelOpen: false,
  activeInspectorPanel: undefined,
  mediaPanelOpen: false,
  activeMediaIndex: 0,
  filesFilterQuery: "",
  modalCleanup: undefined,
  modalFocusReturnTarget: undefined,
  modalToken: 0,
  modalImmersive: false,
  modalScrollTop: 0,
  previewRenderToken: 0,
  headingHighlightTimer: undefined,
};

let elements;
let isInitialized = false;
const pendingPreviewLinkResolutions = new Map();
let nextPreviewLinkResolutionRequestId = 1;
const pendingPreviewLinkHoverResolutions = new Map();
const previewLinkHoverCache = new Map();
let nextPreviewLinkHoverRequestId = 1;

initialize();

function initialize() {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
    return;
  }

  if (isInitialized) {
    return;
  }

  elements = getRequiredElements();
  if (!elements) {
    return;
  }

  isInitialized = true;
  if (isDesktopInspectorLayout()) {
    state.activeInspectorPanel = "toc";
  }
  applyWidthVariables(96);
  syncTopbarMetrics();

  elements.refreshButton.addEventListener("click", () => {
    vscode.postMessage({ type: "refresh" });
  });

  elements.openTextButton.addEventListener("click", () => {
    if (!state.selectedPath) {
      return;
    }
    vscode.postMessage({ type: "openTextFile", path: state.selectedPath });
  });

  elements.toggleFilesButton.addEventListener("click", () => {
    setFilesPanelOpen(!state.filesPanelOpen);
  });

  elements.toggleTocButton.addEventListener("click", () => {
    toggleInspectorPanel("toc");
  });

  elements.toggleLinksButton.addEventListener("click", () => {
    toggleInspectorPanel("links");
  });

  elements.toggleMediaButton.addEventListener("click", () => {
    setMediaPanelOpen(!state.mediaPanelOpen);
  });

  elements.filesFilterInput.addEventListener("input", (event) => {
    state.filesFilterQuery = event.target.value.trim().toLowerCase();
    renderFiles();
  });

  elements.inspectorCloseButton.addEventListener("click", () => {
    setInspectorPanel(undefined, { returnFocus: true });
  });

  elements.mediaCloseButton.addEventListener("click", () => {
    setMediaPanelOpen(false, { returnFocus: true });
  });

  elements.mediaPrevButton.addEventListener("click", () => {
    stepMedia(-1);
  });

  elements.mediaNextButton.addEventListener("click", () => {
    stepMedia(1);
  });

  elements.panelBackdrop.addEventListener("click", () => {
    closeOpenPanels({ returnFocus: true });
  });

  elements.modalCloseButton.addEventListener("click", () => {
    hideModal();
  });

  elements.modalShell.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.dataset.closeModal === "true") {
      hideModal();
    }
  });

  window.addEventListener("scroll", scheduleSyncActiveHeading, {
    passive: true,
  });

  window.addEventListener("resize", scheduleSyncActiveHeading, {
    passive: true,
  });

  window.addEventListener("resize", syncTopbarMetrics, {
    passive: true,
  });

  addViewportChangeListener(panelLayoutQuery, handleViewportLayoutChange);

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Node)) {
      return;
    }

    if (hasTextSelectionWithin(event.target)) {
      return;
    }

    if (
      state.filesPanelOpen &&
      !elements.filesPanel.contains(event.target) &&
      !elements.toggleFilesButton.contains(event.target)
    ) {
      setFilesPanelOpen(false);
    }

    if (
      state.mediaPanelOpen &&
      !elements.mediaPanel.contains(event.target) &&
      !elements.toggleMediaButton.contains(event.target)
    ) {
      setMediaPanelOpen(false);
    }

    if (
      !isDesktopInspectorLayout() &&
      state.activeInspectorPanel &&
      !elements.inspectorPanel.contains(event.target) &&
      !elements.toggleTocButton.contains(event.target) &&
      !elements.toggleLinksButton.contains(event.target)
    ) {
      setInspectorPanel(undefined);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    if (!elements.modalShell.classList.contains("hidden")) {
      hideModal();
      return;
    }

    if (state.mediaPanelOpen) {
      setMediaPanelOpen(false, { returnFocus: true });
      return;
    }

    if (state.activeInspectorPanel) {
      setInspectorPanel(undefined, { returnFocus: true });
      return;
    }

    if (state.filesPanelOpen) {
      setFilesPanelOpen(false, { returnFocus: true });
      return;
    }
  });

  document.addEventListener("keydown", (event) => {
    if (!state.mediaPanelOpen) {
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      stepMedia(-1);
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      stepMedia(1);
    }
  });

  window.addEventListener("message", (event) => {
    const message = event.data;
    switch (message.type) {
      case "files":
        state.files = Array.isArray(message.files) ? message.files : [];
        state.selectedPath = message.selectedPath;
        renderFiles();
        break;
      case "fileContent":
        state.selectedPath = message.path;
        state.toc = Array.isArray(message.toc) ? message.toc : [];
        applyWidthVariables(message.maxWidthCh);
        renderPreview(message.path, message.html);
        clearError();
        break;
      case "fileError":
        showError(message.message || "Unable to load markdown file.");
        break;
      case "previewLinksResolved": {
        const resolve = pendingPreviewLinkResolutions.get(message.requestId);
        if (!resolve) {
          break;
        }
        pendingPreviewLinkResolutions.delete(message.requestId);
        resolve(Array.isArray(message.results) ? message.results : []);
        break;
      }
      case "previewLinkHoverResolved": {
        const resolve = pendingPreviewLinkHoverResolutions.get(
          message.requestId,
        );
        if (!resolve) {
          break;
        }
        pendingPreviewLinkHoverResolutions.delete(message.requestId);
        resolve(message.result);
        break;
      }
      default:
        break;
    }
  });

  vscode.postMessage({ type: "ready" });
  renderToc();
  renderLinks();
  renderMediaPanel();
  renderFiles();
  applyFilesPanelState();
  applyInspectorPanelState();
  applyMediaPanelState();
}

function getRequiredElements() {
  const resolved = {
    errorBanner: document.getElementById("errorBanner"),
    filesEmptyState: document.getElementById("filesEmptyState"),
    filesFilterInput: document.getElementById("filesFilterInput"),
    filesList: document.getElementById("filesList"),
    filesPanel: document.getElementById("filesPanel"),
    inspectorCloseButton: document.getElementById("inspectorCloseButton"),
    inspectorEyebrow: document.getElementById("inspectorEyebrow"),
    inspectorPanel: document.getElementById("inspectorPanel"),
    inspectorSubtitle: document.getElementById("inspectorSubtitle"),
    inspectorTitle: document.getElementById("inspectorTitle"),
    linksEmptyState: document.getElementById("linksEmptyState"),
    linksList: document.getElementById("linksList"),
    linksSection: document.getElementById("linksSection"),
    mediaCaption: document.getElementById("mediaCaption"),
    mediaCloseButton: document.getElementById("mediaCloseButton"),
    mediaCounter: document.getElementById("mediaCounter"),
    mediaEmptyState: document.getElementById("mediaEmptyState"),
    mediaMeta: document.getElementById("mediaMeta"),
    mediaNextButton: document.getElementById("mediaNextButton"),
    mediaPanel: document.getElementById("mediaPanel"),
    mediaPrevButton: document.getElementById("mediaPrevButton"),
    mediaStage: document.getElementById("mediaStage"),
    mediaStageImage: document.getElementById("mediaStageImage"),
    mediaSubtitle: document.getElementById("mediaSubtitle"),
    mediaThumbs: document.getElementById("mediaThumbs"),
    modalCloseButton: document.getElementById("modalCloseButton"),
    modalContent: document.getElementById("modalContent"),
    modalHeaderExtras: document.getElementById("modalHeaderExtras"),
    modalShell: document.getElementById("modalShell"),
    modalSubtitle: document.getElementById("modalSubtitle"),
    modalTitle: document.getElementById("modalTitle"),
    openTextButton: document.getElementById("openTextButton"),
    panelBackdrop: document.getElementById("panelBackdrop"),
    previewContent: document.getElementById("previewContent"),
    previewPath: document.getElementById("previewPath"),
    previewTitle: document.getElementById("previewTitle"),
    refreshButton: document.getElementById("refreshButton"),
    toggleLinksButton: document.getElementById("toggleLinksButton"),
    toggleMediaButton: document.getElementById("toggleMediaButton"),
    toggleTocButton: document.getElementById("toggleTocButton"),
    toggleFilesButton: document.getElementById("toggleFilesButton"),
    tocSection: document.getElementById("tocSection"),
    tocEmptyState: document.getElementById("tocEmptyState"),
    tocList: document.getElementById("tocList"),
    topbar: document.getElementById("topbar"),
  };

  const missing = Object.entries(resolved)
    .filter(([, element]) => !(element instanceof HTMLElement))
    .map(([name]) => name);

  if (missing.length > 0) {
    console.error(
      "Markdown Helpers webview failed to initialize. Missing DOM nodes:",
      missing,
    );
    return undefined;
  }

  return resolved;
}

function renderFiles() {
  elements.filesList.innerHTML = "";
  const files = getFilteredFiles();
  const hasAnyFiles = state.files.length > 0;
  elements.filesEmptyState.classList.toggle("hidden", files.length > 0);
  elements.filesEmptyState.textContent = hasAnyFiles
    ? "No markdown files match the current filter."
    : "No markdown files found.";
  applyFilesPanelState();

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
      vscode.postMessage({ type: "openFile", path: file.relativePath });
      setFilesPanelOpen(false);
    });
    elements.filesList.append(button);
  }
}

function renderPreview(path, html) {
  const renderToken = ++state.previewRenderToken;
  previewLinkHoverCache.clear();
  elements.previewTitle.textContent = basename(path);
  elements.previewTitle.title = path;
  elements.previewTitle.setAttribute("aria-label", path);
  elements.previewPath.textContent = path;
  elements.previewPath.title = path;
  document.title = `${basename(path)} • Markdown Helpers`;
  elements.previewContent.classList.remove("empty-preview");
  elements.previewContent.innerHTML = `<div class="preview-document">${html}</div>`;
  state.headings = Array.from(
    elements.previewContent.querySelectorAll(
      "h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]",
    ),
  );
  state.activeHeadingId = state.headings[0]?.id;
  debugToc("renderPreview", {
    path,
    tocItems: state.toc.length,
    headingCount: state.headings.length,
  });

  bindInternalAnchorLinks();
  renderToc();
  renderFiles();

  void enhancePreview(elements.previewContent, {
    vscode,
    copyText,
    showModal,
    handleLocalLinkNavigation: (href) => handlePreviewLocalLinkNavigation(href),
    requestResolvedLocalLinks: (hrefs) =>
      requestResolvedLocalLinks(hrefs, renderToken),
    requestPreviewLinkHover: (href) =>
      requestPreviewLinkHover(href, renderToken),
  }).then(() => {
    if (renderToken !== state.previewRenderToken) {
      return;
    }

    bindInternalAnchorLinks();
    collectPreviewArtifacts();
    if (isDesktopInspectorLayout() && !state.activeInspectorPanel) {
      state.activeInspectorPanel = "toc";
    }
    renderToc();
    renderLinks();
    renderMediaPanel();
    applyInspectorPanelState();
    applyMediaPanelState();
    syncActiveHeading();
  });
}

function requestResolvedLocalLinks(hrefs, renderToken) {
  if (!Array.isArray(hrefs) || hrefs.length === 0) {
    return Promise.resolve([]);
  }

  if (renderToken !== state.previewRenderToken) {
    return Promise.resolve([]);
  }

  return new Promise((resolve) => {
    const requestId = String(nextPreviewLinkResolutionRequestId++);
    pendingPreviewLinkResolutions.set(requestId, (results) => {
      if (renderToken !== state.previewRenderToken) {
        resolve([]);
        return;
      }
      resolve(results);
    });
    vscode.postMessage({
      type: "resolvePreviewLinks",
      requestId,
      hrefs,
    });
  });
}

function requestPreviewLinkHover(href, renderToken) {
  if (typeof href !== "string" || href.length === 0) {
    return Promise.resolve(undefined);
  }

  if (renderToken !== state.previewRenderToken) {
    return Promise.resolve(undefined);
  }

  if (previewLinkHoverCache.has(href)) {
    return Promise.resolve(previewLinkHoverCache.get(href));
  }

  return new Promise((resolve) => {
    const requestId = String(nextPreviewLinkHoverRequestId++);
    pendingPreviewLinkHoverResolutions.set(requestId, (result) => {
      if (renderToken !== state.previewRenderToken) {
        resolve(undefined);
        return;
      }

      if (result) {
        previewLinkHoverCache.set(href, result);
      }

      resolve(result);
    });
    vscode.postMessage({
      type: "resolvePreviewLinkHover",
      requestId,
      href,
    });
  });
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

function applyFilesPanelState() {
  elements.filesPanel.classList.toggle("is-collapsed", !state.filesPanelOpen);
  elements.filesPanel.setAttribute(
    "aria-hidden",
    String(!state.filesPanelOpen),
  );
  elements.toggleFilesButton.setAttribute(
    "aria-expanded",
    String(state.filesPanelOpen),
  );
  elements.toggleFilesButton.classList.toggle(
    "is-active",
    state.filesPanelOpen,
  );
  applyPanelBackdropState();
}

function applyInspectorPanelState() {
  const activePanel = state.activeInspectorPanel;
  const isOpen = Boolean(activePanel);
  const desktop = isDesktopInspectorLayout();
  elements.inspectorPanel.classList.toggle("is-collapsed", !isOpen);
  elements.inspectorPanel.classList.toggle(
    "is-desktop-docked",
    desktop && isOpen,
  );
  elements.inspectorPanel.setAttribute("aria-hidden", String(!isOpen));
  elements.toggleTocButton.setAttribute(
    "aria-expanded",
    String(activePanel === "toc"),
  );
  elements.toggleLinksButton.setAttribute(
    "aria-expanded",
    String(activePanel === "links"),
  );
  elements.toggleTocButton.classList.toggle("is-active", activePanel === "toc");
  elements.toggleLinksButton.classList.toggle(
    "is-active",
    activePanel === "links",
  );
  elements.tocSection.classList.toggle("hidden", activePanel !== "toc");
  elements.linksSection.classList.toggle("hidden", activePanel !== "links");
  document.documentElement.classList.toggle(
    "has-desktop-inspector",
    desktop && isOpen,
  );
  updateInspectorCopy();
  applyPanelBackdropState();
}

function applyMediaPanelState() {
  elements.mediaPanel.classList.toggle("is-collapsed", !state.mediaPanelOpen);
  elements.mediaPanel.setAttribute(
    "aria-hidden",
    String(!state.mediaPanelOpen),
  );
  elements.toggleMediaButton.setAttribute(
    "aria-expanded",
    String(state.mediaPanelOpen),
  );
  elements.toggleMediaButton.classList.toggle(
    "is-active",
    state.mediaPanelOpen,
  );
  applyPanelBackdropState();
}

function setFilesPanelOpen(open, options = {}) {
  state.filesPanelOpen = open;
  applyFilesPanelState();

  if (open) {
    elements.filesFilterInput.focus();
    elements.filesFilterInput.select();
    return;
  }

  if (options.returnFocus) {
    elements.toggleFilesButton.focus();
  }
}

function setInspectorPanel(panelName, options = {}) {
  state.activeInspectorPanel = panelName;
  applyInspectorPanelState();

  if (!panelName) {
    if (options.returnFocus) {
      elements.toggleTocButton.focus();
    }
    return;
  }

  if (!isDesktopInspectorLayout()) {
    elements.inspectorCloseButton.focus();
  }
}

function toggleInspectorPanel(panelName) {
  setInspectorPanel(
    state.activeInspectorPanel === panelName ? undefined : panelName,
  );
}

function setMediaPanelOpen(open, options = {}) {
  if (open && state.mediaItems.length === 0) {
    return;
  }

  state.mediaPanelOpen = open;
  applyMediaPanelState();

  if (open) {
    renderMediaPanel();
    elements.mediaCloseButton.focus();
    return;
  }

  if (options.returnFocus) {
    elements.toggleMediaButton.focus();
  }
}

function openMediaPanelAt(index) {
  if (state.mediaItems.length === 0) {
    return;
  }

  state.activeMediaIndex = clampMediaIndex(index);
  setMediaPanelOpen(true);
  renderMediaPanel();
}

function stepMedia(delta) {
  if (state.mediaItems.length < 2) {
    return;
  }

  state.activeMediaIndex = clampMediaIndex(state.activeMediaIndex + delta);
  renderMediaPanel();
}

function closeOpenPanels(options = {}) {
  if (state.mediaPanelOpen) {
    setMediaPanelOpen(false, options);
  }
  if (state.activeInspectorPanel && !isDesktopInspectorLayout()) {
    setInspectorPanel(undefined, options);
  }
  if (state.filesPanelOpen) {
    setFilesPanelOpen(false, options);
  }
}

function applyPanelBackdropState() {
  const showBackdrop =
    state.mediaPanelOpen ||
    (!isDesktopInspectorLayout() &&
      (state.filesPanelOpen || Boolean(state.activeInspectorPanel)));
  elements.panelBackdrop.classList.toggle("hidden", !showBackdrop);
  elements.panelBackdrop.setAttribute("aria-hidden", String(!showBackdrop));
}

function handleViewportLayoutChange(event) {
  if (event.matches && !state.activeInspectorPanel) {
    state.activeInspectorPanel = "toc";
  }

  applyInspectorPanelState();
  applyPanelBackdropState();
  syncTopbarMetrics();
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

function showError(message) {
  elements.errorBanner.textContent = message;
  elements.errorBanner.classList.remove("hidden");
  state.links = [];
  state.mediaItems = [];
  renderLinks();
  renderMediaPanel();
}

function clearError() {
  elements.errorBanner.textContent = "";
  elements.errorBanner.classList.add("hidden");
}

function getFilteredFiles() {
  if (!state.filesFilterQuery) {
    return state.files;
  }

  return state.files.filter((file) =>
    file.relativePath.toLowerCase().includes(state.filesFilterQuery),
  );
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.className = "sr-only-textarea";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function showModal(options) {
  const {
    content,
    headerContent,
    immersive = false,
    onClose,
    subtitle,
    title,
    wide = false,
  } = options;

  cleanupModal();
  const modalToken = ++state.modalToken;
  state.modalCleanup = typeof onClose === "function" ? onClose : undefined;
  state.modalFocusReturnTarget = document.activeElement;
  state.modalImmersive = Boolean(immersive);
  state.modalScrollTop = getCurrentScrollTop();

  elements.modalTitle.textContent = title || "Preview";
  elements.modalSubtitle.textContent = subtitle || "";
  elements.modalSubtitle.classList.toggle("hidden", !subtitle);
  elements.modalHeaderExtras.replaceChildren();
  if (headerContent instanceof Node) {
    elements.modalHeaderExtras.append(headerContent);
    elements.modalHeaderExtras.classList.remove("hidden");
  } else {
    elements.modalHeaderExtras.classList.add("hidden");
  }
  elements.modalContent.replaceChildren(content);
  elements.modalShell.classList.remove("hidden");
  elements.modalShell.setAttribute("aria-hidden", "false");
  elements.modalShell.classList.toggle("is-wide", Boolean(wide));
  elements.modalShell.classList.toggle("is-immersive", state.modalImmersive);
  document.documentElement.classList.add("has-modal");
  document.body.classList.add("has-modal");
  document.body.style.top = `-${state.modalScrollTop}px`;
  document.body.style.width = "100%";
  window.requestAnimationFrame(() => {
    elements.modalCloseButton.focus();
  });

  return {
    isActive() {
      return modalToken === state.modalToken;
    },
    setOnClose(cleanup) {
      if (modalToken !== state.modalToken) {
        if (typeof cleanup === "function") {
          cleanup();
        }
        return false;
      }

      cleanupModal();
      state.modalCleanup = typeof cleanup === "function" ? cleanup : undefined;
      return true;
    },
  };
}

function hideModal(options = {}) {
  if (elements.modalShell.classList.contains("hidden")) {
    return;
  }

  cleanupModal();
  elements.modalShell.classList.add("hidden");
  elements.modalShell.setAttribute("aria-hidden", "true");
  elements.modalShell.classList.remove("is-wide");
  elements.modalShell.classList.remove("is-immersive");
  elements.modalContent.replaceChildren();
  elements.modalTitle.textContent = "Preview";
  elements.modalSubtitle.textContent = "";
  elements.modalSubtitle.classList.add("hidden");
  elements.modalHeaderExtras.replaceChildren();
  elements.modalHeaderExtras.classList.add("hidden");
  document.documentElement.classList.remove("has-modal");
  document.body.classList.remove("has-modal");
  document.body.style.top = "";
  document.body.style.width = "";
  window.scrollTo({ top: state.modalScrollTop, behavior: "instant" });
  state.modalImmersive = false;
  state.modalScrollTop = 0;

  if (options.restoreFocus === false) {
    state.modalFocusReturnTarget = undefined;
    return;
  }

  if (state.modalFocusReturnTarget instanceof HTMLElement) {
    state.modalFocusReturnTarget.focus();
  }
  state.modalFocusReturnTarget = undefined;
  state.modalToken += 1;
}

function cleanupModal() {
  if (typeof state.modalCleanup === "function") {
    state.modalCleanup();
  }
  state.modalCleanup = undefined;
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

function getHeadingElement(id) {
  if (!id || typeof CSS === "undefined" || typeof CSS.escape !== "function") {
    return document.getElementById(id);
  }

  return elements.previewContent.querySelector(`#${CSS.escape(id)}`);
}

function scheduleSyncActiveHeading() {
  window.requestAnimationFrame(syncActiveHeading);
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

function getCurrentScrollTop() {
  const scrollingElement =
    document.scrollingElement || document.documentElement;
  return scrollingElement.scrollTop;
}

function debugToc(event, details) {
  console.debug("[Markdown Helpers][TOC]", event, details);
}

function applyWidthVariables(maxWidthCh) {
  const width = Number.isFinite(Number(maxWidthCh))
    ? Math.max(48, Number(maxWidthCh))
    : 96;
  const previewShellWidth = Math.min(width + 22, 136);
  const outlineWidth = Math.max(22, Math.min(Math.round(width * 0.42), 34));
  const tableBleed = Math.max(4, Math.min(width * 0.24, 16));

  document.documentElement.style.setProperty("--content-width", `${width}ch`);
  document.documentElement.style.setProperty(
    "--preview-shell-width",
    `${previewShellWidth}ch`,
  );
  document.documentElement.style.setProperty(
    "--outline-panel-width",
    `clamp(16rem, ${outlineWidth}ch, 22rem)`,
  );
  document.documentElement.style.setProperty(
    "--table-bleed",
    `${tableBleed}rem`,
  );
}

function addViewportChangeListener(query, listener) {
  if (typeof query.addEventListener === "function") {
    query.addEventListener("change", listener);
    return;
  }

  if (typeof query.addListener === "function") {
    query.addListener(listener);
  }
}

function isDesktopInspectorLayout() {
  return panelLayoutQuery.matches;
}

function syncTopbarMetrics() {
  const topbarHeight = elements.topbar?.offsetHeight ?? 88;
  document.documentElement.style.setProperty(
    "--topbar-height",
    `${topbarHeight}px`,
  );
}

function collectPreviewArtifacts() {
  state.links = collectPreviewLinks();
  state.mediaItems = collectPreviewMedia();
  if (state.activeMediaIndex >= state.mediaItems.length) {
    state.activeMediaIndex = 0;
  }
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

function createLinkBadge(label, className) {
  const badge = document.createElement("span");
  badge.className = `link-card-badge ${className}`;
  badge.textContent = label;
  return badge;
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
  const targetName = normalizeDocPath(normalizedTarget.split("/").pop() || "");
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

function clampMediaIndex(index) {
  if (state.mediaItems.length === 0) {
    return 0;
  }

  return (
    ((index % state.mediaItems.length) + state.mediaItems.length) %
    state.mediaItems.length
  );
}

function getStickyScrollOffset() {
  return (elements.topbar?.offsetHeight ?? 88) + 28;
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}
