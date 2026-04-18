export function getRequiredElements() {
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
