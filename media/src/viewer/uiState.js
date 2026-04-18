export function createUiStateController({
  elements,
  isDesktopInspectorLayout,
  renderMediaPanel,
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
    const activeInspectorWidth = desktop && isOpen ? "var(--inspector-width)" : "0px";
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
      state.mediaPanelOpen ||
      (!isDesktopInspectorLayout() &&
        (state.filesPanelOpen || Boolean(state.activeInspectorPanel)));
    elements.panelBackdrop.classList.toggle("hidden", !showBackdrop);
    elements.panelBackdrop.setAttribute("aria-hidden", String(!showBackdrop));
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

  return {
    applyFilesPanelState,
    applyInspectorPanelState,
    applyMediaPanelState,
    closeOpenPanels,
    handleViewportLayoutChange,
    openMediaPanelAt,
    setFilesPanelOpen,
    setInspectorPanel,
    setMediaPanelOpen,
    stepMedia,
    toggleInspectorPanel,
  };
}
