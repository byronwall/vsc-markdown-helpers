export function createUiStateController({
  elements,
  isDesktopInspectorLayout,
  state,
  syncTopbarMetrics,
  updateInspectorCopy,
}) {
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
    const activeInspectorWidth =
      desktop && isOpen ? "var(--inspector-width)" : "0px";
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
    elements.toggleTocButton.classList.toggle(
      "is-active",
      activePanel === "toc",
    );
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
    document.documentElement.style.setProperty(
      "--active-inspector-width",
      activeInspectorWidth,
    );
    updateInspectorCopy();
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

  function closeOpenPanels(options = {}) {
    if (state.activeInspectorPanel && !isDesktopInspectorLayout()) {
      setInspectorPanel(undefined, options);
    }
    if (state.filesPanelOpen) {
      setFilesPanelOpen(false, options);
    }
  }

  function handleViewportLayoutChange(event) {
    if (event.matches && !state.activeInspectorPanel) {
      state.activeInspectorPanel = "toc";
    }

    applyInspectorPanelState();
    applyPanelBackdropState();
    syncTopbarMetrics();
  }

  function applyPanelBackdropState() {
    const showBackdrop =
      !isDesktopInspectorLayout() &&
      (state.filesPanelOpen || Boolean(state.activeInspectorPanel));
    elements.panelBackdrop.classList.toggle("hidden", !showBackdrop);
    elements.panelBackdrop.setAttribute("aria-hidden", String(!showBackdrop));
  }

  return {
    applyFilesPanelState,
    applyInspectorPanelState,
    closeOpenPanels,
    handleViewportLayoutChange,
    setFilesPanelOpen,
    setInspectorPanel,
    toggleInspectorPanel,
  };
}
