const MIN_SCALE = 0.05;
const MAX_SCALE = 12;
const ZOOM_STEP = 1.2;
const WHEEL_ZOOM_STEP = 1.08;
const SCALE_EPSILON = 0.001;

export function createImageViewerController({ elements, showModal, state }) {
  function syncTriggerState() {
    const hasMedia = state.mediaItems.length > 0;
    elements.toggleMediaButton.disabled = !hasMedia;
    elements.toggleMediaButton.setAttribute("aria-disabled", String(!hasMedia));
    if (!hasMedia) {
      elements.toggleMediaButton.classList.remove("is-active");
    }
  }

  function openImageViewerAt(index = 0, source = "toolbar") {
    if (state.mediaItems.length === 0) {
      syncTriggerState();
      return;
    }

    state.activeMediaIndex = clampMediaIndex(index, state.mediaItems.length);

    const modalStage = document.createElement("div");
    modalStage.className = "media-stage media-modal-stage image-viewer-stage";

    const frame = document.createElement("div");
    frame.className = "media-stage-frame media-modal-frame image-viewer-frame";

    const previousButton = document.createElement("button");
    previousButton.type = "button";
    previousButton.className =
      "ghost-button icon-button icon-chevron-left media-nav-button image-viewer-nav-button";
    previousButton.title = "Previous image";
    previousButton.setAttribute("aria-label", "Previous image");

    const viewport = document.createElement("div");
    viewport.className = "image-viewer-viewport";

    const panLayer = document.createElement("div");
    panLayer.className = "image-viewer-pan-layer";

    const stageImage = document.createElement("img");
    stageImage.className =
      "media-stage-image media-modal-image image-viewer-image";
    stageImage.alt = "";
    stageImage.draggable = false;

    const nextButton = document.createElement("button");
    nextButton.type = "button";
    nextButton.className =
      "ghost-button icon-button icon-chevron-right media-nav-button image-viewer-nav-button";
    nextButton.title = "Next image";
    nextButton.setAttribute("aria-label", "Next image");

    panLayer.append(stageImage);
    viewport.append(panLayer);
    frame.append(previousButton, viewport, nextButton);

    const meta = document.createElement("div");
    meta.className = "media-stage-meta media-modal-meta image-viewer-meta";

    const metaBlock = document.createElement("div");
    const counter = document.createElement("p");
    counter.className = "media-counter";
    const caption = document.createElement("p");
    caption.className = "media-caption";
    const details = document.createElement("p");
    details.className = "media-meta";
    metaBlock.append(counter, caption, details);
    meta.append(metaBlock);

    const thumbs = document.createElement("div");
    thumbs.className = "media-thumbs media-modal-thumbs image-viewer-thumbs";
    thumbs.setAttribute("role", "list");

    modalStage.append(frame, meta, thumbs);
    modalStage.addEventListener("click", (event) => {
      event.stopPropagation();
    });

    const toolbar = document.createElement("div");
    toolbar.className = "image-viewer-toolbar";

    const zoomOutButton = createToolbarButton("-", "Zoom out");
    const zoomReadout = document.createElement("span");
    zoomReadout.className = "image-viewer-zoom-readout";
    zoomReadout.setAttribute("aria-live", "polite");
    const zoomInButton = createToolbarButton("+", "Zoom in");
    const fitButton = createToolbarButton("Fit", "Zoom to fit");
    const actualSizeButton = createToolbarButton("100%", "Actual size");

    toolbar.append(
      zoomOutButton,
      zoomReadout,
      zoomInButton,
      fitButton,
      actualSizeButton,
    );

    const modal = showModal({
      title: "Image viewer",
      subtitle: `${state.mediaItems.length} rendered image${state.mediaItems.length === 1 ? "" : "s"} in this file.`,
      headerContent: toolbar,
      content: modalStage,
      wide: true,
    });

    const modalContent = modalStage.closest(".modal-content");
    if (modalContent instanceof HTMLElement) {
      modalContent.classList.add("has-media-modal");
    }
    elements.modalShell.classList.add("is-media-viewer");
    elements.toggleMediaButton.classList.add("is-active");

    const viewState = {
      imageLoaded: false,
      naturalWidth: 1,
      naturalHeight: 1,
      fitScale: 1,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      pointerId: undefined,
      dragOriginX: 0,
      dragOriginY: 0,
      dragStartOffsetX: 0,
      dragStartOffsetY: 0,
    };

    function renderModal() {
      const item = state.mediaItems[state.activeMediaIndex];
      if (!item) {
        return;
      }

      resetImageState();
      stageImage.src = item.src;
      stageImage.alt = item.alt || item.caption || "Preview image";
      counter.textContent = `${state.activeMediaIndex + 1} of ${state.mediaItems.length}`;
      caption.textContent = item.caption;
      details.textContent = item.meta;
      previousButton.disabled = state.mediaItems.length < 2;
      nextButton.disabled = state.mediaItems.length < 2;
      thumbs.innerHTML = "";
      thumbs.classList.toggle("hidden", state.mediaItems.length < 2);

      state.mediaItems.forEach((mediaItem, mediaIndex) => {
        const thumbButton = document.createElement("button");
        thumbButton.type = "button";
        thumbButton.className = "media-thumb-button";
        if (mediaIndex === state.activeMediaIndex) {
          thumbButton.classList.add("is-active");
        }
        thumbButton.setAttribute(
          "aria-label",
          `Show image ${mediaIndex + 1}: ${mediaItem.caption}`,
        );

        const thumbImage = document.createElement("img");
        thumbImage.src = mediaItem.src;
        thumbImage.alt = mediaItem.alt || mediaItem.caption;

        thumbButton.append(thumbImage);
        thumbButton.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          state.activeMediaIndex = mediaIndex;
          renderModal();
        });
        thumbs.append(thumbButton);
      });

      if (stageImage.complete && stageImage.naturalWidth > 0) {
        window.requestAnimationFrame(handleImageLoad);
      }

      window.requestAnimationFrame(syncModalLayout);
    }

    function resetImageState() {
      viewState.imageLoaded = false;
      viewState.pointerId = undefined;
      viewState.offsetX = 0;
      viewState.offsetY = 0;
      viewState.scale = 1;
      viewState.fitScale = 1;
      viewport.classList.remove("is-pannable", "is-dragging");
      viewport.classList.add("is-loading");
      panLayer.style.transform = "translate(0px, 0px) scale(1)";
      panLayer.style.width = "auto";
      panLayer.style.height = "auto";
      stageImage.style.width = "auto";
      stageImage.style.height = "auto";
      zoomReadout.textContent = "Loading";
    }

    function syncModalLayout() {
      if (!(modalContent instanceof HTMLElement) || !modal.isActive()) {
        return;
      }

      const stageStyles = window.getComputedStyle(modalStage);
      const rowGap =
        Number.parseFloat(stageStyles.rowGap || stageStyles.gap || "0") || 0;
      const gapMultiplier = thumbs.classList.contains("hidden") ? 1 : 2;
      const reservedHeight =
        meta.offsetHeight + thumbs.offsetHeight + rowGap * gapMultiplier;
      const availableHeight = Math.max(
        0,
        modalContent.clientHeight - reservedHeight,
      );

      frame.style.height = `${availableHeight}px`;
      updateScaleForViewport();
    }

    function updateScaleForViewport() {
      if (!viewState.imageLoaded) {
        return;
      }

      const nextFitScale = computeFitScale();
      const wasAtFit = isNear(viewState.scale, viewState.fitScale);
      viewState.fitScale = nextFitScale;
      if (wasAtFit) {
        viewState.scale = nextFitScale;
      }

      if (viewState.scale < MIN_SCALE) {
        viewState.scale = Math.max(nextFitScale, MIN_SCALE);
      }

      clampOffsets();
      renderTransform();
    }

    function computeFitScale() {
      if (!viewState.imageLoaded) {
        return 1;
      }

      const viewportWidth = Math.max(viewport.clientWidth - 18, 1);
      const viewportHeight = Math.max(viewport.clientHeight - 18, 1);
      return Math.min(
        viewportWidth / viewState.naturalWidth,
        viewportHeight / viewState.naturalHeight,
        1,
      );
    }

    function setScale(nextScale, focalPoint) {
      if (!viewState.imageLoaded) {
        return;
      }

      const clampedScale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
      if (isNear(clampedScale, viewState.scale)) {
        return;
      }

      if (focalPoint) {
        const viewportRect = viewport.getBoundingClientRect();
        const focalX = focalPoint.clientX - viewportRect.left;
        const focalY = focalPoint.clientY - viewportRect.top;
        const currentMetrics = getLayoutMetrics(viewState.scale);
        const currentTranslateX = currentMetrics.baseX + viewState.offsetX;
        const currentTranslateY = currentMetrics.baseY + viewState.offsetY;
        const contentX = (focalX - currentTranslateX) / viewState.scale;
        const contentY = (focalY - currentTranslateY) / viewState.scale;
        const nextMetrics = getLayoutMetrics(clampedScale);
        viewState.offsetX =
          focalX - contentX * clampedScale - nextMetrics.baseX;
        viewState.offsetY =
          focalY - contentY * clampedScale - nextMetrics.baseY;
      }

      viewState.scale = clampedScale;
      clampOffsets();
      renderTransform();
    }

    function zoomBy(multiplier, focalPoint) {
      setScale(viewState.scale * multiplier, focalPoint);
    }

    function zoomToFit() {
      if (!viewState.imageLoaded) {
        return;
      }

      viewState.scale = viewState.fitScale;
      viewState.offsetX = 0;
      viewState.offsetY = 0;
      renderTransform();
    }

    function zoomToActualSize() {
      if (!viewState.imageLoaded) {
        return;
      }

      viewState.scale = clamp(1, MIN_SCALE, MAX_SCALE);
      viewState.offsetX = 0;
      viewState.offsetY = 0;
      clampOffsets();
      renderTransform();
    }

    function clampOffsets() {
      const metrics = getLayoutMetrics(viewState.scale);
      viewState.offsetX = clamp(
        viewState.offsetX,
        -metrics.maxPanX,
        metrics.maxPanX,
      );
      viewState.offsetY = clamp(
        viewState.offsetY,
        -metrics.maxPanY,
        metrics.maxPanY,
      );
    }

    function renderTransform() {
      const metrics = getLayoutMetrics(viewState.scale);
      const panEnabled = metrics.maxPanX > 0.5 || metrics.maxPanY > 0.5;
      const translateX = metrics.baseX + viewState.offsetX;
      const translateY = metrics.baseY + viewState.offsetY;

      panLayer.style.transform = `translate(${translateX}px, ${translateY}px) scale(${viewState.scale})`;
      zoomReadout.textContent = formatZoomReadout(
        viewState.scale,
        viewState.fitScale,
      );
      viewport.classList.toggle("is-pannable", panEnabled);
      if (!panEnabled) {
        viewport.classList.remove("is-dragging");
      }
    }

    function stepImage(delta) {
      if (state.mediaItems.length < 2) {
        return;
      }

      state.activeMediaIndex = clampMediaIndex(
        state.activeMediaIndex + delta,
        state.mediaItems.length,
      );
      renderModal();
    }

    function handlePointerDown(event) {
      if (event.button !== 0 || !viewState.imageLoaded) {
        return;
      }

      const metrics = getLayoutMetrics(viewState.scale);
      const panEnabled = metrics.maxPanX > 0.5 || metrics.maxPanY > 0.5;
      if (!panEnabled) {
        return;
      }

      viewState.pointerId = event.pointerId;
      viewState.dragOriginX = event.clientX;
      viewState.dragOriginY = event.clientY;
      viewState.dragStartOffsetX = viewState.offsetX;
      viewState.dragStartOffsetY = viewState.offsetY;
      viewport.classList.add("is-dragging");
      viewport.setPointerCapture(event.pointerId);
      event.preventDefault();
    }

    function handlePointerMove(event) {
      if (viewState.pointerId !== event.pointerId) {
        return;
      }

      viewState.offsetX =
        viewState.dragStartOffsetX + (event.clientX - viewState.dragOriginX);
      viewState.offsetY =
        viewState.dragStartOffsetY + (event.clientY - viewState.dragOriginY);
      clampOffsets();
      renderTransform();
    }

    function releasePointer(event) {
      if (viewState.pointerId !== event.pointerId) {
        return;
      }

      viewState.pointerId = undefined;
      viewport.classList.remove("is-dragging");
      if (viewport.hasPointerCapture(event.pointerId)) {
        viewport.releasePointerCapture(event.pointerId);
      }
    }

    function handleWheel(event) {
      if (!viewState.imageLoaded) {
        return;
      }

      event.preventDefault();
      const multiplier =
        event.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP;
      zoomBy(multiplier, event);
    }

    function handleViewportDoubleClick(event) {
      if (!viewState.imageLoaded) {
        return;
      }

      if (isNear(viewState.scale, viewState.fitScale)) {
        setScale(1, event);
        return;
      }

      zoomToFit();
    }

    function handleModalKeydown(event) {
      if (!modal.isActive()) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        stepImage(-1);
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        stepImage(1);
        return;
      }

      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomBy(ZOOM_STEP);
        return;
      }

      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomBy(1 / ZOOM_STEP);
        return;
      }

      if (event.key === "0" || event.key.toLowerCase() === "f") {
        event.preventDefault();
        zoomToFit();
        return;
      }

      if (event.key === "1") {
        event.preventDefault();
        zoomToActualSize();
      }
    }

    function handleImageLoad() {
      viewState.imageLoaded = true;
      viewState.naturalWidth = Math.max(stageImage.naturalWidth || 1, 1);
      viewState.naturalHeight = Math.max(stageImage.naturalHeight || 1, 1);
      panLayer.style.width = `${viewState.naturalWidth}px`;
      panLayer.style.height = `${viewState.naturalHeight}px`;
      stageImage.style.width = "100%";
      stageImage.style.height = "100%";
      viewport.classList.remove("is-loading");
      viewState.fitScale = computeFitScale();
      viewState.scale = viewState.fitScale;
      viewState.offsetX = 0;
      viewState.offsetY = 0;
      renderTransform();

      const activeThumb = thumbs.querySelector(".media-thumb-button.is-active");
      if (activeThumb instanceof HTMLElement) {
        activeThumb.scrollIntoView({ block: "nearest", inline: "center" });
      }
    }

    function getLayoutMetrics(scale) {
      const scaledWidth = viewState.naturalWidth * scale;
      const scaledHeight = viewState.naturalHeight * scale;
      const viewportWidth = Math.max(viewport.clientWidth, 1);
      const viewportHeight = Math.max(viewport.clientHeight, 1);
      const overflowX = Math.max(scaledWidth - viewportWidth, 0);
      const overflowY = Math.max(scaledHeight - viewportHeight, 0);

      return {
        baseX: (viewportWidth - scaledWidth) / 2,
        baseY: (viewportHeight - scaledHeight) / 2,
        maxPanX: overflowX / 2,
        maxPanY: overflowY / 2,
      };
    }

    function handleImageError() {
      viewport.classList.remove("is-loading");
      zoomReadout.textContent = "Unavailable";
    }

    previousButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      stepImage(-1);
    });
    nextButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      stepImage(1);
    });
    zoomOutButton.addEventListener("click", () => zoomBy(1 / ZOOM_STEP));
    zoomInButton.addEventListener("click", () => zoomBy(ZOOM_STEP));
    fitButton.addEventListener("click", () => zoomToFit());
    actualSizeButton.addEventListener("click", () => zoomToActualSize());
    viewport.addEventListener("pointerdown", handlePointerDown);
    viewport.addEventListener("pointermove", handlePointerMove);
    viewport.addEventListener("pointerup", releasePointer);
    viewport.addEventListener("pointercancel", releasePointer);
    viewport.addEventListener("wheel", handleWheel, { passive: false });
    viewport.addEventListener("dblclick", handleViewportDoubleClick);
    stageImage.addEventListener("load", handleImageLoad);
    stageImage.addEventListener("error", handleImageError);
    document.addEventListener("keydown", handleModalKeydown);
    window.addEventListener("resize", syncModalLayout);

    renderModal();
    console.log("[Markdown Helpers][media] Opening image viewer", {
      activeIndex: state.activeMediaIndex,
      source,
      total: state.mediaItems.length,
    });

    modal.setOnClose(() => {
      document.removeEventListener("keydown", handleModalKeydown);
      window.removeEventListener("resize", syncModalLayout);
      stageImage.removeEventListener("load", handleImageLoad);
      stageImage.removeEventListener("error", handleImageError);
      if (modalContent instanceof HTMLElement) {
        modalContent.classList.remove("has-media-modal");
      }
      elements.modalShell.classList.remove("is-media-viewer");
      elements.toggleMediaButton.classList.remove("is-active");
    });
  }

  return {
    openImageViewerAt,
    syncTriggerState,
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function clampMediaIndex(index, length) {
  if (length === 0) {
    return 0;
  }

  return ((index % length) + length) % length;
}

function createToolbarButton(label, title) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ghost-button image-viewer-toolbar-button";
  button.textContent = label;
  button.title = title;
  button.setAttribute("aria-label", title);
  return button;
}

function formatZoomReadout(scale, fitScale) {
  const percent = `${Math.round(scale * 100)}%`;
  return isNear(scale, fitScale) ? `Fit ${percent}` : percent;
}

function isNear(value, expected) {
  return Math.abs(value - expected) <= SCALE_EPSILON;
}
