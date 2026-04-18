export function createModalController({
  elements,
  state,
  getCurrentScrollTop,
}) {
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
        state.modalCleanup =
          typeof cleanup === "function" ? cleanup : undefined;
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

  return {
    hideModal,
    showModal,
  };
}
