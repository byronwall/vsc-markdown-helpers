import hljs from "highlight.js/lib/common";
import mermaid from "mermaid";
import svgPanZoom from "svg-pan-zoom";

export async function enhancePreview(container, vscode) {
  await Promise.all([
    enhanceCodeBlocks(container, vscode),
    enhanceMermaidBlocks(container, vscode),
  ]);
}

async function enhanceCodeBlocks(container, vscode) {
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

    if (language && hljs.getLanguage(language)) {
      hljs.highlightElement(code);
    } else {
      code.classList.add("hljs");
    }

    const toolbar = document.createElement("div");
    toolbar.className = "code-block-toolbar";

    const label = document.createElement("span");
    label.className = "code-block-label";
    label.textContent = language || "code";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "code-block-button icon-button icon-open-code";
    button.title = "Open code block";
    button.setAttribute("aria-label", "Open code block");
    button.addEventListener("click", () => {
      vscode.postMessage({
        type: "openPreviewCodeBlock",
        language,
        content: code.textContent || "",
      });
    });

    toolbar.append(label, button);
    pre.prepend(toolbar);
  }
}

async function enhanceMermaidBlocks(container, vscode) {
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
    const wrapper = document.createElement("div");
    wrapper.className = "mermaid-card";

    const toolbar = document.createElement("div");
    toolbar.className = "code-block-toolbar mermaid-toolbar";

    const label = document.createElement("span");
    label.className = "code-block-label";
    label.textContent = language;

    const actions = document.createElement("div");
    actions.className = "mermaid-actions";

    const sourceToggle = document.createElement("button");
    sourceToggle.type = "button";
    sourceToggle.className = "code-block-button";
    sourceToggle.textContent = "Show source";

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "code-block-button icon-button icon-open-code";
    openButton.title = "Open code block";
    openButton.setAttribute("aria-label", "Open code block");
    openButton.addEventListener("click", () => {
      vscode.postMessage({
        type: "openPreviewCodeBlock",
        language,
        content: source,
      });
    });

    actions.append(sourceToggle, openButton);
    toolbar.append(label, actions);

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
      const { svg } = await mermaid.render(uid("mermaid"), source);
      diagram.innerHTML = svg;
      const svgElement = diagram.querySelector("svg");
      if (svgElement) {
        svgElement.setAttribute("width", "100%");
        svgElement.setAttribute("height", "100%");
        svgPanZoom(svgElement, {
          zoomEnabled: true,
          controlIconsEnabled: true,
          fit: true,
          center: true,
          minZoom: 0.2,
          maxZoom: 10,
        });
      }
    } catch (error) {
      diagram.textContent = `Mermaid render error: ${String(error)}`;
      diagram.classList.add("mermaid-error");
    }
  }
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
