import hljs from "highlight.js/lib/common";
import mermaid from "mermaid";
import svgPanZoom from "svg-pan-zoom";

const COLLAPSED_CODE_LINES = 15;

export async function enhancePreview(container, tools) {
  await Promise.all([
    enhanceCodeBlocks(container, tools),
    enhanceMermaidBlocks(container, tools),
  ]);
}

async function enhanceCodeBlocks(container, tools) {
  const blocks = container.querySelectorAll(
    "pre > code:not(.language-mermaid)",
  );

  for (const code of blocks) {
    const pre = code.parentElement;
    if (!pre || pre.dataset.enhanced === "true") {
      continue;
    }

    pre.dataset.enhanced = "true";
    const language = getLanguageLabel(code);
    const source = code.textContent || "";
    const lineCount = countLines(source);

    if (language && hljs.getLanguage(language)) {
      hljs.highlightElement(code);
    } else {
      code.classList.add("hljs");
    }

    const wrapper = document.createElement("div");
    wrapper.className = "code-block-card";
    if (lineCount > COLLAPSED_CODE_LINES) {
      wrapper.classList.add("is-collapsed");
    }

    const toolbar = document.createElement("div");
    toolbar.className = "code-block-toolbar";

    const meta = document.createElement("div");
    meta.className = "code-block-meta";

    const label = document.createElement("span");
    label.className = "code-block-label";
    label.textContent = language || "code";

    const stats = document.createElement("span");
    stats.className = "code-block-stats";
    stats.textContent = `${lineCount} ${lineCount === 1 ? "line" : "lines"}`;
    meta.append(label, stats);

    const actions = document.createElement("div");
    actions.className = "code-block-actions";

    if (lineCount > COLLAPSED_CODE_LINES) {
      const expandButton = document.createElement("button");
      expandButton.type = "button";
      expandButton.className = "code-block-button";
      expandButton.textContent = "Expand";
      expandButton.addEventListener("click", () => {
        const collapsed = wrapper.classList.toggle("is-collapsed");
        expandButton.textContent = collapsed ? "Expand" : "Collapse";
      });
      actions.append(expandButton);
    }

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "code-block-button icon-button icon-copy";
    copyButton.title = "Copy code block";
    copyButton.setAttribute("aria-label", "Copy code block");
    copyButton.addEventListener("click", async () => {
      await tools.copyText(source);
      flashButton(copyButton, "Copied code block");
    });

    const modalButton = document.createElement("button");
    modalButton.type = "button";
    modalButton.className = "code-block-button icon-button icon-expand";
    modalButton.title = "Show full code sample";
    modalButton.setAttribute("aria-label", "Show full code sample");
    modalButton.addEventListener("click", () => {
      tools.showModal({
        title: language || "Code sample",
        subtitle: `${lineCount} ${lineCount === 1 ? "line" : "lines"}`,
        content: createCodeModalContent(source, language),
        wide: true,
      });
    });

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "code-block-button icon-button icon-open-code";
    openButton.title = "Open code block in editor";
    openButton.setAttribute("aria-label", "Open code block in editor");
    openButton.addEventListener("click", () => {
      tools.vscode.postMessage({
        type: "openPreviewCodeBlock",
        language,
        content: source,
      });
    });

    actions.append(copyButton, modalButton, openButton);

    const viewport = document.createElement("div");
    viewport.className = "code-block-viewport";

    pre.classList.add("code-block-pre");

    pre.replaceWith(wrapper);
    viewport.append(pre);
    toolbar.append(meta, actions);
    wrapper.append(toolbar, viewport);
  }
}

async function enhanceMermaidBlocks(container, tools) {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "loose",
    theme: "neutral",
    flowchart: { useMaxWidth: true, htmlLabels: true },
  });

  const blocks = container.querySelectorAll(
    'pre > code.language-mermaid:not([data-mermaid="true"])',
  );

  for (const code of blocks) {
    const pre = code.parentElement;
    if (!pre) {
      continue;
    }

    code.dataset.mermaid = "true";
    const source = code.textContent || "";
    const language = getLanguageLabel(code) || "mermaid";
    const lineCount = countLines(source);
    const wrapper = document.createElement("div");
    wrapper.className = "mermaid-card";

    const toolbar = document.createElement("div");
    toolbar.className = "code-block-toolbar mermaid-toolbar";

    const meta = document.createElement("div");
    meta.className = "code-block-meta";

    const label = document.createElement("span");
    label.className = "code-block-label";
    label.textContent = language;

    const stats = document.createElement("span");
    stats.className = "code-block-stats";
    stats.textContent = `${lineCount} ${lineCount === 1 ? "line" : "lines"}`;
    meta.append(label, stats);

    const actions = document.createElement("div");
    actions.className = "mermaid-actions";

    const sourceToggle = document.createElement("button");
    sourceToggle.type = "button";
    sourceToggle.className = "code-block-button";
    sourceToggle.textContent = "Show source";

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "code-block-button icon-button icon-copy";
    copyButton.title = "Copy mermaid source";
    copyButton.setAttribute("aria-label", "Copy mermaid source");
    copyButton.addEventListener("click", async () => {
      await tools.copyText(source);
      flashButton(copyButton, "Copied mermaid source");
    });

    const modalButton = document.createElement("button");
    modalButton.type = "button";
    modalButton.className = "code-block-button icon-button icon-expand";
    modalButton.title = "Show full diagram";
    modalButton.setAttribute("aria-label", "Show full diagram");
    modalButton.addEventListener("click", async () => {
      const diagramStage = document.createElement("div");
      diagramStage.className = "mermaid-modal-stage";

      const modalDiagram = document.createElement("div");
      modalDiagram.className = "mermaid-diagram mermaid-diagram-modal";
      diagramStage.append(modalDiagram);

      const modal = tools.showModal({
        title: "Mermaid diagram",
        subtitle: `${lineCount} lines of source`,
        content: diagramStage,
        immersive: true,
        wide: true,
      });

      try {
        await waitForNextFrame();
        if (!modal.isActive()) {
          return;
        }

        const cleanup = await renderMermaidDiagram(modalDiagram, source, {
          fit: true,
          minZoom: 0.15,
          maxZoom: 12,
        });

        modal.setOnClose(cleanup);
      } catch (error) {
        modalDiagram.textContent = `Mermaid render error: ${String(error)}`;
        modalDiagram.classList.add("mermaid-error");
      }
    });

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "code-block-button icon-button icon-open-code";
    openButton.title = "Open code block";
    openButton.setAttribute("aria-label", "Open code block");
    openButton.addEventListener("click", () => {
      tools.vscode.postMessage({
        type: "openPreviewCodeBlock",
        language,
        content: source,
      });
    });

    actions.append(sourceToggle, copyButton, modalButton, openButton);
    toolbar.append(meta, actions);

    const diagramFrame = document.createElement("div");
    diagramFrame.className = "mermaid-diagram-frame";

    const diagram = document.createElement("div");
    diagram.className = "mermaid-diagram";
    diagramFrame.append(diagram);

    const sourcePanel = document.createElement("pre");
    sourcePanel.className = "mermaid-source hidden";
    sourcePanel.textContent = source;

    wrapper.append(toolbar, diagramFrame, sourcePanel);
    pre.replaceWith(wrapper);

    sourceToggle.addEventListener("click", () => {
      const hidden = sourcePanel.classList.toggle("hidden");
      sourceToggle.textContent = hidden ? "Show source" : "Hide source";
    });

    try {
      await renderMermaidDiagram(diagram, source, {
        fit: true,
        minZoom: 0.2,
        maxZoom: 10,
      });
    } catch (error) {
      diagram.textContent = `Mermaid render error: ${String(error)}`;
      diagram.classList.add("mermaid-error");
    }
  }
}

function createCodeModalContent(source, language) {
  const wrapper = document.createElement("div");
  wrapper.className = "modal-code-stage";

  const pre = document.createElement("pre");
  pre.className = "code-block-pre modal-code-pre";

  const code = document.createElement("code");
  if (language) {
    code.className = `language-${language}`;
  }
  code.textContent = source;
  if (language && hljs.getLanguage(language)) {
    hljs.highlightElement(code);
  } else {
    code.classList.add("hljs");
  }

  pre.append(code);
  wrapper.append(pre);
  return wrapper;
}

async function renderMermaidDiagram(container, source, panZoomOptions) {
  const { svg } = await mermaid.render(uid("mermaid"), source);
  container.innerHTML = svg;
  const svgElement = container.querySelector("svg");
  if (!svgElement) {
    return undefined;
  }

  svgElement.setAttribute("width", "100%");
  svgElement.setAttribute("height", "100%");
  svgElement.style.width = "100%";
  svgElement.style.height = "100%";
  const panZoom = svgPanZoom(svgElement, {
    zoomEnabled: true,
    controlIconsEnabled: true,
    fit: true,
    center: true,
    ...panZoomOptions,
  });

  return () => {
    try {
      panZoom.destroy();
    } catch (error) {
      if (
        !(error instanceof DOMException) ||
        error.name !== "InvalidStateError"
      ) {
        throw error;
      }
    }
  };
}

function waitForNextFrame() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      resolve();
    });
  });
}

function countLines(source) {
  if (!source) {
    return 0;
  }

  return source.replace(/\n$/, "").split("\n").length;
}

function flashButton(button, label) {
  const originalTitle = button.title;
  const originalLabel = button.getAttribute("aria-label");
  button.classList.add("is-confirmed");
  button.title = label;
  button.setAttribute("aria-label", label);
  window.setTimeout(() => {
    button.classList.remove("is-confirmed");
    button.title = originalTitle;
    if (originalLabel) {
      button.setAttribute("aria-label", originalLabel);
    }
  }, 1600);
}

function getLanguageLabel(code) {
  const match = [...code.classList].find((value) =>
    value.startsWith("language-"),
  );
  return match ? match.slice("language-".length) : "";
}

function uid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}
