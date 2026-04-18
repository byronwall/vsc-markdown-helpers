import { enhancePreview } from "./viewer/markdownRenderer.js";
import { getRequiredElements } from "./viewer/domElements.js";
import {
  addViewportChangeListener,
  applyWidthVariables,
  isDesktopInspectorLayout,
  syncTopbarMetrics,
} from "./viewer/layout.js";
import { createModalController } from "./viewer/modal.js";
import { createPanelRenderingController } from "./viewer/panelRendering.js";
import { createPreviewNavigationController } from "./viewer/previewNavigation.js";
import {
  basename,
  dirname,
  formatAge,
  formatWordCount,
  hasTextSelectionWithin,
} from "./viewer/shared.js";
import { createUiStateController } from "./viewer/uiState.js";

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
let panelRendering;
let previewNavigation;
let uiState;
let modalController;

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

  panelRendering = createPanelRenderingController({
    basename,
    debugToc,
    dirname,
    elements,
    formatAge,
    formatWordCount,
    getCurrentScrollTop: () => previewNavigation.getCurrentScrollTop(),
    isDesktopInspectorLayout: getDesktopInspectorLayout,
    openLinkItem: (item) => previewNavigation.openLinkItem(item),
    scrollToHeadingById: (id) => previewNavigation.scrollToHeadingById(id),
    setFilesPanelOpen: (...args) => uiState.setFilesPanelOpen(...args),
    setInspectorPanel: (...args) => uiState.setInspectorPanel(...args),
    setMediaPanelOpen: (...args) => uiState.setMediaPanelOpen(...args),
    state,
    vscode,
  });

  previewNavigation = createPreviewNavigationController({
    basename,
    debugToc,
    elements,
    hasTextSelectionWithin,
    openMediaPanelAt: (index) => uiState.openMediaPanelAt(index),
    renderMediaPanel: () => panelRendering.renderMediaPanel(),
    renderToc: () => panelRendering.renderToc(),
    showModal: (options) => modalController.showModal(options),
    state,
    vscode,
  });

  uiState = createUiStateController({
    elements,
    isDesktopInspectorLayout: getDesktopInspectorLayout,
    renderMediaPanel: () => panelRendering.renderMediaPanel(),
    state,
    syncTopbarMetrics: () => syncTopbarMetrics(elements),
    updateInspectorCopy: () => panelRendering.updateInspectorCopy(),
  });

  modalController = createModalController({
    elements,
    state,
    getCurrentScrollTop: () => previewNavigation.getCurrentScrollTop(),
  });

  isInitialized = true;
  if (getDesktopInspectorLayout()) {
    state.activeInspectorPanel = "toc";
  }
  applyWidthVariables(96);
  syncTopbarMetrics(elements);

  bindUIEvents();
  bindWindowEvents();

  vscode.postMessage({ type: "ready" });
  panelRendering.renderToc();
  panelRendering.renderLinks();
  panelRendering.renderMediaPanel();
  panelRendering.renderFiles();
  uiState.applyFilesPanelState();
  uiState.applyInspectorPanelState();
  uiState.applyMediaPanelState();
}

function bindUIEvents() {
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
    uiState.setFilesPanelOpen(!state.filesPanelOpen);
  });

  elements.toggleTocButton.addEventListener("click", () => {
    uiState.toggleInspectorPanel("toc");
  });

  elements.toggleLinksButton.addEventListener("click", () => {
    uiState.toggleInspectorPanel("links");
  });

  elements.toggleMediaButton.addEventListener("click", () => {
    uiState.setMediaPanelOpen(!state.mediaPanelOpen);
  });

  elements.filesFilterInput.addEventListener("input", (event) => {
    state.filesFilterQuery = event.target.value.trim().toLowerCase();
    panelRendering.renderFiles();
  });

  elements.inspectorCloseButton.addEventListener("click", () => {
    uiState.setInspectorPanel(undefined, { returnFocus: true });
  });

  elements.mediaCloseButton.addEventListener("click", () => {
    uiState.setMediaPanelOpen(false, { returnFocus: true });
  });

  elements.mediaPrevButton.addEventListener("click", () => {
    uiState.stepMedia(-1);
  });

  elements.mediaNextButton.addEventListener("click", () => {
    uiState.stepMedia(1);
  });

  elements.panelBackdrop.addEventListener("click", () => {
    uiState.closeOpenPanels({ returnFocus: true });
  });

  elements.modalCloseButton.addEventListener("click", () => {
    modalController.hideModal();
  });

  elements.modalShell.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.dataset.closeModal === "true") {
      modalController.hideModal();
    }
  });
}

function bindWindowEvents() {
  window.addEventListener(
    "scroll",
    () => previewNavigation.scheduleSyncActiveHeading(),
    { passive: true },
  );

  window.addEventListener(
    "resize",
    () => previewNavigation.scheduleSyncActiveHeading(),
    { passive: true },
  );

  window.addEventListener("resize", () => syncTopbarMetrics(elements), {
    passive: true,
  });

  addViewportChangeListener(panelLayoutQuery, (event) => {
    uiState.handleViewportLayoutChange(event);
  });

  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("keydown", handleEscapeKey);
  document.addEventListener("keydown", handleMediaArrowKeys);
  window.addEventListener("message", handleWebviewMessage);
}

function handleDocumentClick(event) {
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
    uiState.setFilesPanelOpen(false);
  }

  if (
    state.mediaPanelOpen &&
    !elements.mediaPanel.contains(event.target) &&
    !elements.toggleMediaButton.contains(event.target)
  ) {
    uiState.setMediaPanelOpen(false);
  }

  if (
    !getDesktopInspectorLayout() &&
    state.activeInspectorPanel &&
    !elements.inspectorPanel.contains(event.target) &&
    !elements.toggleTocButton.contains(event.target) &&
    !elements.toggleLinksButton.contains(event.target)
  ) {
    uiState.setInspectorPanel(undefined);
  }
}

function handleEscapeKey(event) {
  if (event.key !== "Escape") {
    return;
  }

  if (!elements.modalShell.classList.contains("hidden")) {
    modalController.hideModal();
    return;
  }

  if (state.mediaPanelOpen) {
    uiState.setMediaPanelOpen(false, { returnFocus: true });
    return;
  }

  if (state.activeInspectorPanel) {
    uiState.setInspectorPanel(undefined, { returnFocus: true });
    return;
  }

  if (state.filesPanelOpen) {
    uiState.setFilesPanelOpen(false, { returnFocus: true });
  }
}

function handleMediaArrowKeys(event) {
  if (!state.mediaPanelOpen) {
    return;
  }

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    uiState.stepMedia(-1);
  }

  if (event.key === "ArrowRight") {
    event.preventDefault();
    uiState.stepMedia(1);
  }
}

function handleWebviewMessage(event) {
  const message = event.data;
  switch (message.type) {
    case "files":
      state.files = Array.isArray(message.files) ? message.files : [];
      state.selectedPath = message.selectedPath;
      panelRendering.renderFiles();
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
      const resolve = pendingPreviewLinkHoverResolutions.get(message.requestId);
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

  previewNavigation.bindInternalAnchorLinks();
  previewNavigation.collectPreviewArtifacts();
  panelRendering.renderToc();
  panelRendering.renderFiles();
  panelRendering.renderMediaPanel();

  void enhancePreview(elements.previewContent, {
    vscode,
    copyText,
    showModal: (options) => modalController.showModal(options),
    handleLocalLinkNavigation: (href) =>
      previewNavigation.handlePreviewLocalLinkNavigation(href),
    requestResolvedLocalLinks: (hrefs) =>
      requestResolvedLocalLinks(hrefs, renderToken),
    requestPreviewLinkHover: (href) =>
      requestPreviewLinkHover(href, renderToken),
  }).then(() => {
    if (renderToken !== state.previewRenderToken) {
      return;
    }

    previewNavigation.bindInternalAnchorLinks();
    previewNavigation.collectPreviewArtifacts();
    if (getDesktopInspectorLayout() && !state.activeInspectorPanel) {
      state.activeInspectorPanel = "toc";
    }
    panelRendering.renderToc();
    panelRendering.renderLinks();
    panelRendering.renderMediaPanel();
    uiState.applyInspectorPanelState();
    uiState.applyMediaPanelState();
    previewNavigation.syncActiveHeading();
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

function showError(message) {
  elements.errorBanner.textContent = message;
  elements.errorBanner.classList.remove("hidden");
  state.links = [];
  state.mediaItems = [];
  panelRendering.renderLinks();
  panelRendering.renderMediaPanel();
}

function clearError() {
  elements.errorBanner.textContent = "";
  elements.errorBanner.classList.add("hidden");
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

function debugToc(event, details) {
  console.debug("[Markdown Helpers][TOC]", event, details);
}

function getDesktopInspectorLayout() {
  return isDesktopInspectorLayout(panelLayoutQuery);
}
