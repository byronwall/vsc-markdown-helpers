export function enhancePreview(container, vscode) {
  const blocks = container.querySelectorAll("pre > code");
  for (const code of blocks) {
    const pre = code.parentElement;
    if (!pre || pre.dataset.enhanced === "true") {
      continue;
    }

    pre.dataset.enhanced = "true";

    const toolbar = document.createElement("div");
    toolbar.className = "code-block-toolbar";

    const label = document.createElement("span");
    label.className = "code-block-label";
    const language = getLanguageLabel(code);
    label.textContent = language || "code";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "code-block-button";
    button.textContent = "Open as untitled";
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

function getLanguageLabel(code) {
  const match = [...code.classList].find((value) =>
    value.startsWith("language-"),
  );
  return match ? match.slice("language-".length) : "";
}
