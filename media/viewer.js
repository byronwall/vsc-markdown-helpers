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
  filesCollapsed: true,
};

const elements = {
  errorBanner: document.getElementById("errorBanner"),
  filesEmptyState: document.getElementById("filesEmptyState"),
  filesList: document.getElementById("filesList"),
  filesPanel: document.getElementById("filesPanel"),
  openTextButton: document.getElementById("openTextButton"),
  previewContent: document.getElementById("previewContent"),
  previewPath: document.getElementById("previewPath"),
  previewTitle: document.getElementById("previewTitle"),
  refreshButton: document.getElementById("refreshButton"),
  toggleFilesButton: document.getElementById("toggleFilesButton"),
  tocEmptyState: document.getElementById("tocEmptyState"),
  tocList: document.getElementById("tocList"),
};

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

elements.previewContent.addEventListener("scroll", () => {
  window.requestAnimationFrame(syncActiveHeading);
});

document.addEventListener("click", (event) => {
  if (state.filesCollapsed) {
    return;
  }

  if (!(event.target instanceof Node)) {
    return;
  }

  if (
    elements.filesPanel.contains(event.target) ||
    elements.toggleFilesButton.contains(event.target)
  ) {
    return;
  }

  setFilesPanelCollapsed(true);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !state.filesCollapsed) {
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

function renderFiles() {
  elements.filesList.innerHTML = "";
  const files = state.files;
  elements.filesEmptyState.classList.toggle("hidden", files.length > 0);
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

  void enhancePreview(elements.previewContent, vscode).then(() => {
    syncActiveHeading();
  });
}

function renderToc() {
  elements.tocList.innerHTML = "";
  elements.tocEmptyState.classList.toggle("hidden", state.toc.length > 0);

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
      const target = document.getElementById(item.id);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
      state.activeHeadingId = item.id;
      renderToc();
    });
    elements.tocList.append(button);
  }
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
    elements.filesPanel.focus();
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

  const containerTop = elements.previewContent.getBoundingClientRect().top;
  let activeId = state.headings[0].id;

  for (const heading of state.headings) {
    const distance = heading.getBoundingClientRect().top - containerTop;
    if (distance <= 84) {
      activeId = heading.id;
      continue;
    }
    break;
  }

  if (activeId !== state.activeHeadingId) {
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
