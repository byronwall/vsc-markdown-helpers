import mermaid from "mermaid";
import svgPanZoom from "svg-pan-zoom";
import {
  countLines,
  flashButton,
  getLanguageLabel,
  uid,
  waitForNextFrame,
} from "./syntaxHighlighting.js";

let mermaidInitialized = false;

export async function enhanceMermaidBlocks(container, tools) {
  if (!mermaidInitialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "loose",
      theme: "neutral",
      flowchart: { useMaxWidth: true, htmlLabels: true },
    });
    mermaidInitialized = true;
  }

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
