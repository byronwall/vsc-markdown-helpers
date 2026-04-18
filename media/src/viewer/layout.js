export function applyWidthVariables(maxWidthCh) {
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

export function addViewportChangeListener(query, listener) {
  if (typeof query.addEventListener === "function") {
    query.addEventListener("change", listener);
    return;
  }

  if (typeof query.addListener === "function") {
    query.addListener(listener);
  }
}

export function isDesktopInspectorLayout(panelLayoutQuery) {
  return panelLayoutQuery.matches;
}

export function syncTopbarMetrics(elements) {
  const topbarHeight = elements.topbar?.offsetHeight ?? 88;
  document.documentElement.style.setProperty(
    "--topbar-height",
    `${topbarHeight}px`,
  );
}
