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
import {
  applyPreviewAppearance,
  clampPreviewFontScale,
  DEFAULT_PREVIEW_FONT_SCALE,
  DEFAULT_PREVIEW_THEME_ID,
  PREVIEW_FONT_SCALE_MAX,
  PREVIEW_FONT_SCALE_MIN,
  PREVIEW_FONT_SCALE_STEP,
  PREVIEW_THEMES,
} from "./viewer/appearance.js";
import { createImageViewerController } from "./viewer/imageViewer.js";
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
  activeMediaIndex: 0,
  filesFilterQuery: "",
  modalCleanup: undefined,
  modalFocusReturnTarget: undefined,
  modalToken: 0,
  modalImmersive: false,
  modalScrollTop: 0,
  previewAppearance: applyPreviewAppearance({
    themeId: DEFAULT_PREVIEW_THEME_ID,
    fontScale: DEFAULT_PREVIEW_FONT_SCALE,
  }),
  previewRenderToken: 0,
  headingHighlightTimer: undefined,
};

let elements;
let isInitialized = false;
let panelRendering;
let previewNavigation;
let uiState;
let modalController;
let imageViewer;

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
    state,
    vscode,
  });

  modalController = createModalController({
    elements,
    state,
    getCurrentScrollTop: () => previewNavigation.getCurrentScrollTop(),
  });

  imageViewer = createImageViewerController({
    elements,
    showModal: (options) => modalController.showModal(options),
    state,
  });

  previewNavigation = createPreviewNavigationController({
    basename,
    debugToc,
    elements,
    hasTextSelectionWithin,
    openImageViewerAt: (index, source) =>
      imageViewer.openImageViewerAt(index, source),
    renderToc: () => panelRendering.renderToc(),
    state,
    vscode,
  });

  uiState = createUiStateController({
    elements,
    isDesktopInspectorLayout: getDesktopInspectorLayout,
    state,
    syncTopbarMetrics: () => syncTopbarMetrics(elements),
    updateInspectorCopy: () => panelRendering.updateInspectorCopy(),
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
  panelRendering.renderFiles();
  uiState.applyFilesPanelState();
  uiState.applyInspectorPanelState();
  imageViewer.syncTriggerState();
}

function bindUIEvents() {
  elements.refreshButton.addEventListener("click", () => {
    vscode.postMessage({ type: "refresh" });
  });

  elements.toggleAppearanceButton.addEventListener("click", () => {
    openAppearanceModal();
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
    imageViewer.openImageViewerAt(state.activeMediaIndex, "toolbar");
  });

  elements.filesFilterInput.addEventListener("input", (event) => {
    state.filesFilterQuery = event.target.value.trim().toLowerCase();
    panelRendering.renderFiles();
  });

  elements.inspectorCloseButton.addEventListener("click", () => {
    uiState.setInspectorPanel(undefined, { returnFocus: true });
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

  if (state.activeInspectorPanel) {
    uiState.setInspectorPanel(undefined, { returnFocus: true });
    return;
  }

  if (state.filesPanelOpen) {
    uiState.setFilesPanelOpen(false, { returnFocus: true });
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
    case "previewAppearance":
      applyIncomingPreviewAppearance({
        themeId: message.themeId,
        fontScale: message.fontScale,
      });
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

function handleThemeGridClick(event) {
  if (!(event.target instanceof Element)) {
    return;
  }

  const button = event.target.closest("button[data-theme-id]");
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }

  updatePreviewAppearance({ themeId: button.dataset.themeId });
}

function applyIncomingPreviewAppearance(preferences) {
  state.previewAppearance = applyPreviewAppearance(preferences);
}

function updatePreviewAppearance(partialPreferences) {
  const nextAppearance = {
    ...state.previewAppearance,
    ...partialPreferences,
  };
  const nextApplied = applyPreviewAppearance(nextAppearance);
  const changedTheme = nextApplied.themeId !== state.previewAppearance.themeId;
  const changedFontScale =
    nextApplied.fontScale !== state.previewAppearance.fontScale;

  if (!changedTheme && !changedFontScale) {
    renderAppearanceControls();
    return;
  }

  state.previewAppearance = nextApplied;
  vscode.postMessage({
    type: "updatePreviewAppearance",
    ...(changedTheme ? { themeId: nextApplied.themeId } : {}),
    ...(changedFontScale ? { fontScale: nextApplied.fontScale } : {}),
  });
}

function renderThemeGrid(container, mode, selectedThemeId) {
  container.innerHTML = "";
  const themes = PREVIEW_THEMES.filter((theme) => theme.mode === mode);

  for (const theme of themes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "appearance-theme-button";
    button.dataset.themeId = theme.id;
    button.setAttribute("aria-pressed", String(theme.id === selectedThemeId));
    if (theme.id === selectedThemeId) {
      button.classList.add("is-active");
    }

    const swatch = document.createElement("span");
    swatch.className = "appearance-theme-swatch";
    swatch.style.setProperty("--swatch-canvas", theme.canvas);
    swatch.style.setProperty("--swatch-surface", theme.surface);
    swatch.style.setProperty("--swatch-ink", theme.ink);
    swatch.style.setProperty("--swatch-accent", theme.accent);

    const label = document.createElement("span");
    label.className = "appearance-theme-label";
    label.textContent = theme.label;

    button.append(swatch, label);
    container.append(button);
  }
}

function formatFontScale(fontScale) {
  return `${Math.round(fontScale * 100)}%`;
}

function openAppearanceModal() {
  const content = document.createElement("div");
  content.className = "appearance-modal";

  const intro = document.createElement("p");
  intro.className = "appearance-menu-subtitle";
  intro.textContent =
    "Click any theme swatch to save it immediately. Text size updates the rendered markdown content only.";

  const lightSection = document.createElement("section");
  lightSection.className = "appearance-section";
  lightSection.append(
    createAppearanceSectionHeading(
      "Light Themes",
      "Eight brighter palettes with live previews.",
      true,
    ),
  );
  const lightThemeGrid = document.createElement("div");
  lightThemeGrid.className = "appearance-theme-grid";
  lightSection.append(lightThemeGrid);

  const darkSection = document.createElement("section");
  darkSection.className = "appearance-section";
  darkSection.append(
    createAppearanceSectionHeading(
      "Dark Themes",
      "Eight darker palettes with live previews.",
      true,
    ),
  );
  const darkThemeGrid = document.createElement("div");
  darkThemeGrid.className = "appearance-theme-grid";
  darkSection.append(darkThemeGrid);

  const fontSection = document.createElement("section");
  fontSection.className = "appearance-section";
  const fontHeader = createAppearanceSectionHeading(
    "Text Size",
    "Make rendered markdown easier to scan.",
    false,
  );
  const fontValue = document.createElement("p");
  fontValue.className = "appearance-font-value";
  fontHeader.append(fontValue);
  const fontControls = document.createElement("div");
  fontControls.className = "appearance-font-controls";
  const decreaseButton = createAppearanceFontButton("A-", "Decrease text size");
  const resetButton = createAppearanceFontButton("Reset", "Reset text size");
  const increaseButton = createAppearanceFontButton("A+", "Increase text size");
  fontControls.append(decreaseButton, resetButton, increaseButton);
  fontSection.append(fontHeader, fontControls);

  content.append(intro, lightSection, darkSection, fontSection);

  const refreshModalControls = () => {
    renderThemeGrid(lightThemeGrid, "light", state.previewAppearance.themeId);
    renderThemeGrid(darkThemeGrid, "dark", state.previewAppearance.themeId);
    fontValue.textContent = formatFontScale(state.previewAppearance.fontScale);
    decreaseButton.disabled =
      state.previewAppearance.fontScale <= PREVIEW_FONT_SCALE_MIN;
    increaseButton.disabled =
      state.previewAppearance.fontScale >= PREVIEW_FONT_SCALE_MAX;
    resetButton.disabled =
      state.previewAppearance.fontScale === DEFAULT_PREVIEW_FONT_SCALE;
  };

  const handleModalThemeClick = (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }
    const button = event.target.closest("button[data-theme-id]");
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    updatePreviewAppearance({ themeId: button.dataset.themeId });
    refreshModalControls();
  };

  lightThemeGrid.addEventListener("click", handleModalThemeClick);
  darkThemeGrid.addEventListener("click", handleModalThemeClick);
  decreaseButton.addEventListener("click", () => {
    updatePreviewAppearance({
      fontScale: clampPreviewFontScale(
        state.previewAppearance.fontScale - PREVIEW_FONT_SCALE_STEP,
      ),
    });
    refreshModalControls();
  });
  resetButton.addEventListener("click", () => {
    updatePreviewAppearance({ fontScale: DEFAULT_PREVIEW_FONT_SCALE });
    refreshModalControls();
  });
  increaseButton.addEventListener("click", () => {
    updatePreviewAppearance({
      fontScale: clampPreviewFontScale(
        state.previewAppearance.fontScale + PREVIEW_FONT_SCALE_STEP,
      ),
    });
    refreshModalControls();
  });

  refreshModalControls();
  elements.toggleAppearanceButton.classList.add("is-active");
  const modal = modalController.showModal({
    title: "Preview Style",
    subtitle: "Choose a saved color theme and adjust rendered text size.",
    content,
    wide: true,
  });
  modal.setOnClose(() => {
    elements.toggleAppearanceButton.classList.remove("is-active");
  });
}

function createAppearanceSectionHeading(title, description, compact) {
  const header = document.createElement("div");
  header.className = `appearance-section-heading${compact ? " compact" : ""}`;
  const textWrap = document.createElement("div");
  const heading = document.createElement("h3");
  heading.textContent = title;
  const descriptionText = document.createElement("p");
  descriptionText.textContent = description;
  textWrap.append(heading, descriptionText);
  header.append(textWrap);
  return header;
}

function createAppearanceFontButton(label, ariaLabel) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ghost-button appearance-font-button";
  button.textContent = label;
  button.setAttribute("aria-label", ariaLabel);
  return button;
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
  imageViewer.syncTriggerState();

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
    imageViewer.syncTriggerState();
    previewNavigation.collectPreviewArtifacts();
    if (getDesktopInspectorLayout() && !state.activeInspectorPanel) {
      state.activeInspectorPanel = "toc";
    }
    panelRendering.renderToc();
    panelRendering.renderLinks();
    uiState.applyInspectorPanelState();
    imageViewer.syncTriggerState();
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
  imageViewer.syncTriggerState();
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
