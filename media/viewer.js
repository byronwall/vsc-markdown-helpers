import { enhancePreview } from "./viewer/markdownRenderer.js";
import {
  basename,
  dirname,
  formatAge,
  formatWordCount,
} from "./viewer/shared.js";

const vscode = acquireVsCodeApi();

const state = {
  files: [],
  selectedPath: undefined,
  toc: [],
  activeHeadingId: undefined,
  headings: [],
  filesFilterQuery: "",
  filesCollapsed: true,
  modalCleanup: undefined,
  modalFocusReturnTarget: undefined,
  modalToken: 0,
  modalImmersive: false,
};

let elements;
let isInitialized = false;

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
    setFilesPanelCollapsed(!state.filesCollapsed);
  });

  elements.filesFilterInput.addEventListener("input", (event) => {
    state.filesFilterQuery = event.target.value.trim().toLowerCase();
    renderFiles();
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

  elements.previewContent.addEventListener(
    "scroll",
    scheduleSyncActiveHeading,
    {
      passive: true,
    },
  );

  window.addEventListener("scroll", scheduleSyncActiveHeading, {
    passive: true,
  });

  window.addEventListener("resize", scheduleSyncActiveHeading, {
    passive: true,
  });

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Node)) {
      return;
    }

    if (
      !state.filesCollapsed &&
      !elements.filesPanel.contains(event.target) &&
      !elements.toggleFilesButton.contains(event.target)
    ) {
      setFilesPanelCollapsed(true);
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

    if (!state.filesCollapsed) {
      setFilesPanelCollapsed(true, { returnFocus: true });
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
        document.documentElement.style.setProperty(
          "--content-width",
          `${message.maxWidthCh || 96}ch`,
        );
        renderPreview(message.path, message.html);
        renderToc();
        renderFiles();
        clearError();
        break;
      case "fileError":
        showError(message.message || "Unable to load markdown file.");
        break;
      default:
        break;
    }
  });

  vscode.postMessage({ type: "ready" });
  applyFilesPanelState();
}

function getRequiredElements() {
  const resolved = {
    errorBanner: document.getElementById("errorBanner"),
    filesEmptyState: document.getElementById("filesEmptyState"),
    filesFilterInput: document.getElementById("filesFilterInput"),
    filesList: document.getElementById("filesList"),
    filesPanel: document.getElementById("filesPanel"),
    modalCloseButton: document.getElementById("modalCloseButton"),
    modalContent: document.getElementById("modalContent"),
    modalShell: document.getElementById("modalShell"),
    modalSubtitle: document.getElementById("modalSubtitle"),
    modalTitle: document.getElementById("modalTitle"),
    openTextButton: document.getElementById("openTextButton"),
    previewContent: document.getElementById("previewContent"),
    previewPath: document.getElementById("previewPath"),
    previewTitle: document.getElementById("previewTitle"),
    refreshButton: document.getElementById("refreshButton"),
    toggleFilesButton: document.getElementById("toggleFilesButton"),
    tocEmptyState: document.getElementById("tocEmptyState"),
    tocList: document.getElementById("tocList"),
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
      setFilesPanelCollapsed(true);
    });
    elements.filesList.append(button);
  }
}

function renderPreview(path, html) {
  elements.previewTitle.textContent = basename(path);
  elements.previewPath.textContent = path;
  document.title = `${basename(path)} • Markdown Helpers`;
  elements.previewContent.classList.remove("empty-preview");
  elements.previewContent.innerHTML = html;
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

  elements.previewContent
    .querySelectorAll("a[data-local-href]")
    .forEach((anchor) => {
      anchor.addEventListener("click", (event) => {
        event.preventDefault();
        const href = anchor.getAttribute("data-local-href");
        if (!href) {
          return;
        }
        vscode.postMessage({ type: "openLocalLink", href });
      });
    });

  void enhancePreview(elements.previewContent, {
    vscode,
    copyText,
    showModal,
  }).then(() => {
    syncActiveHeading();
  });
}

function renderToc() {
  elements.tocList.innerHTML = "";
  elements.tocEmptyState.classList.toggle("hidden", state.toc.length > 0);
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
      const target = getHeadingElement(item.id);
      if (target) {
        const scrollTarget = getScrollTargetForElement(target);
        debugToc("tocClick", {
          id: item.id,
          top: scrollTarget.top,
          currentScrollTop: getCurrentScrollTop(),
          scrollContext: scrollTarget.context,
        });
        scrollToHeadingTarget(scrollTarget);
      }
      state.activeHeadingId = item.id;
      renderToc();
    });
    elements.tocList.append(button);
  }

  ensureActiveTocItemVisible();
}

function applyFilesPanelState() {
  elements.filesPanel.classList.toggle("is-collapsed", state.filesCollapsed);
  elements.filesPanel.setAttribute("aria-hidden", String(state.filesCollapsed));
  elements.toggleFilesButton.setAttribute(
    "aria-expanded",
    String(!state.filesCollapsed),
  );
  elements.toggleFilesButton.setAttribute(
    "aria-label",
    state.filesCollapsed ? "Show markdown files" : "Hide markdown files",
  );
}

function setFilesPanelCollapsed(collapsed, options = {}) {
  state.filesCollapsed = collapsed;
  applyFilesPanelState();

  if (!collapsed) {
    elements.filesFilterInput.focus();
    elements.filesFilterInput.select();
    return;
  }

  if (options.returnFocus) {
    elements.toggleFilesButton.focus();
  }
}

function syncActiveHeading() {
  if (state.headings.length === 0) {
    if (state.activeHeadingId !== undefined) {
      state.activeHeadingId = undefined;
      renderToc();
    }
    return;
  }

  const scrollContext = getScrollContext();
  const activationOffset = 120;
  let activeId = state.headings[0].id;

  for (const heading of state.headings) {
    const top = getHeadingTopInScrollContext(heading, scrollContext);
    if (top <= scrollContext.top + activationOffset) {
      activeId = heading.id;
      continue;
    }
    break;
  }

  if (activeId !== state.activeHeadingId) {
    debugToc("activeHeadingChanged", {
      previous: state.activeHeadingId,
      next: activeId,
      scrollTop: scrollContext.top,
      scrollContext: scrollContext.kind,
    });
    state.activeHeadingId = activeId;
    renderToc();
  }
}

function showError(message) {
  elements.errorBanner.textContent = message;
  elements.errorBanner.classList.remove("hidden");
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

  elements.modalTitle.textContent = title || "Preview";
  elements.modalSubtitle.textContent = subtitle || "";
  elements.modalSubtitle.classList.toggle("hidden", !subtitle);
  elements.modalContent.replaceChildren(content);
  elements.modalShell.classList.remove("hidden");
  elements.modalShell.setAttribute("aria-hidden", "false");
  elements.modalShell.classList.toggle("is-wide", Boolean(wide));
  elements.modalShell.classList.toggle("is-immersive", state.modalImmersive);
  document.body.classList.add("has-modal");
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
  document.body.classList.remove("has-modal");
  state.modalImmersive = false;

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

  activeItem.scrollIntoView({
    block: "nearest",
    inline: "nearest",
  });
}

function getHeadingElement(id) {
  if (!id || typeof CSS === "undefined" || typeof CSS.escape !== "function") {
    return document.getElementById(id);
  }

  return elements.previewContent.querySelector(`#${CSS.escape(id)}`);
}

function getPreviewScrollTopForElement(element) {
  const previewRect = elements.previewContent.getBoundingClientRect();
  const targetRect = element.getBoundingClientRect();
  return Math.max(
    elements.previewContent.scrollTop + targetRect.top - previewRect.top - 28,
    0,
  );
}

function scheduleSyncActiveHeading() {
  window.requestAnimationFrame(syncActiveHeading);
}

function getScrollContext() {
  const scrollingElement =
    document.scrollingElement || document.documentElement;
  if (isScrollable(elements.previewContent)) {
    return {
      kind: "preview",
      top: elements.previewContent.scrollTop,
    };
  }

  return {
    kind: "document",
    top: scrollingElement.scrollTop,
  };
}

function getScrollTargetForElement(element) {
  const scrollContext = getScrollContext();
  if (scrollContext.kind === "preview") {
    return {
      context: scrollContext.kind,
      top: getPreviewScrollTopForElement(element),
    };
  }

  return {
    context: scrollContext.kind,
    top: getDocumentScrollTopForElement(element),
  };
}

function getDocumentScrollTopForElement(element) {
  const scrollingElement =
    document.scrollingElement || document.documentElement;
  const targetRect = element.getBoundingClientRect();
  return Math.max(scrollingElement.scrollTop + targetRect.top - 28, 0);
}

function scrollToHeadingTarget(target) {
  if (target.context === "preview") {
    elements.previewContent.scrollTo({ top: target.top, behavior: "smooth" });
    return;
  }

  window.scrollTo({ top: target.top, behavior: "smooth" });
}

function getHeadingTopInScrollContext(heading, scrollContext) {
  if (scrollContext.kind === "preview") {
    const previewRect = elements.previewContent.getBoundingClientRect();
    return (
      heading.getBoundingClientRect().top -
      previewRect.top +
      elements.previewContent.scrollTop
    );
  }

  const scrollingElement =
    document.scrollingElement || document.documentElement;
  return heading.getBoundingClientRect().top + scrollingElement.scrollTop;
}

function getCurrentScrollTop() {
  return getScrollContext().top;
}

function isScrollable(element) {
  return element.scrollHeight > element.clientHeight + 1;
}

function debugToc(event, details) {
  console.debug("[Markdown Helpers][TOC]", event, details);
}
