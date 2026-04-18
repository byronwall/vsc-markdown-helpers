import {
  applySyntaxHighlighting,
  countLines,
  flashButton,
  getLanguageLabel,
} from "./syntaxHighlighting.js";

const COLLAPSED_CODE_LINES = 15;

export async function enhanceCodeBlocks(container, tools) {
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

    applySyntaxHighlighting(code, language);

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

    if (lineCount > COLLAPSED_CODE_LINES) {
      const expandButton = document.createElement("button");
      expandButton.type = "button";
      expandButton.className = "code-block-button code-block-expand-button";
      expandButton.textContent = "Expand";
      expandButton.addEventListener("click", () => {
        const collapsed = wrapper.classList.toggle("is-collapsed");
        expandButton.textContent = collapsed ? "Expand" : "Collapse";
      });
      wrapper.append(expandButton);
    }

    const viewport = document.createElement("div");
    viewport.className = "code-block-viewport";

    pre.classList.add("code-block-pre");

    pre.replaceWith(wrapper);
    viewport.append(pre);
    toolbar.append(meta, actions);
    wrapper.append(toolbar, viewport);
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
  applySyntaxHighlighting(code, language);

  pre.append(code);
  wrapper.append(pre);
  return wrapper;
}
