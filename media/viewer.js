import { enhancePreview } from "./viewer/markdownRenderer.js";
import { basename, formatAge, formatWordCount } from "./viewer/shared.js";

const vscode = acquireVsCodeApi();

const state = {
  files: [],
  selectedPath: undefined,
  toc: [],
};

const elements = {
  errorBanner: document.getElementById("errorBanner"),
  filesEmptyState: document.getElementById("filesEmptyState"),
  filesList: document.getElementById("filesList"),
  openTextButton: document.getElementById("openTextButton"),
  previewContent: document.getElementById("previewContent"),
  previewTitle: document.getElementById("previewTitle"),
  refreshButton: document.getElementById("refreshButton"),
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

function renderFiles() {
  elements.filesList.innerHTML = "";
  const files = state.files;
  elements.filesEmptyState.classList.toggle("hidden", files.length > 0);

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

    button.append(title, meta);
    button.addEventListener("click", () => {
      vscode.postMessage({ type: "openFile", path: file.relativePath });
    });
    elements.filesList.append(button);
  }
}

function renderPreview(path, html) {
  elements.previewTitle.textContent = path;
  elements.previewContent.classList.remove("empty-preview");
  elements.previewContent.innerHTML = html;

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

  enhancePreview(elements.previewContent, vscode);
}

function renderToc() {
  elements.tocList.innerHTML = "";
  elements.tocEmptyState.classList.toggle("hidden", state.toc.length > 0);

  for (const item of state.toc) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "toc-link";
    button.style.setProperty("--level", String(item.level));
    button.textContent = item.text;
    button.addEventListener("click", () => {
      const target = document.getElementById(item.id);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    elements.tocList.append(button);
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
