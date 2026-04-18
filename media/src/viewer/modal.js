export function createModalController({
  elements,
  state,
  getCurrentScrollTop,
}) {
  let lockedPageStyles;

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
    lockPageScroll(state.modalScrollTop);
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
    unlockPageScroll();
    window.scrollTo({ top: state.modalScrollTop, behavior: "auto" });
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

  function lockPageScroll(scrollTop) {
    const root = document.documentElement;
    const body = document.body;

    lockedPageStyles = {
      htmlOverflow: root.style.overflow,
      htmlOverscrollBehavior: root.style.overscrollBehavior,
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyLeft: body.style.left,
      bodyRight: body.style.right,
      bodyWidth: body.style.width,
      bodyOverscrollBehavior: body.style.overscrollBehavior,
    };

    root.classList.add("has-modal");
    body.classList.add("has-modal");
    root.style.overflow = "hidden";
    root.style.overscrollBehavior = "none";
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollTop}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overscrollBehavior = "none";
  }

  function unlockPageScroll() {
    const root = document.documentElement;
    const body = document.body;

    root.classList.remove("has-modal");
    body.classList.remove("has-modal");

    if (!lockedPageStyles) {
      root.style.overflow = "";
      root.style.overscrollBehavior = "";
      body.style.overflow = "";
      body.style.position = "";
      body.style.top = "";
      body.style.left = "";
      body.style.right = "";
      body.style.width = "";
      body.style.overscrollBehavior = "";
      return;
    }

    root.style.overflow = lockedPageStyles.htmlOverflow;
    root.style.overscrollBehavior = lockedPageStyles.htmlOverscrollBehavior;
    body.style.overflow = lockedPageStyles.bodyOverflow;
    body.style.position = lockedPageStyles.bodyPosition;
    body.style.top = lockedPageStyles.bodyTop;
    body.style.left = lockedPageStyles.bodyLeft;
    body.style.right = lockedPageStyles.bodyRight;
    body.style.width = lockedPageStyles.bodyWidth;
    body.style.overscrollBehavior = lockedPageStyles.bodyOverscrollBehavior;
    lockedPageStyles = undefined;
  }

  return {
    hideModal,
    showModal,
  };
}
