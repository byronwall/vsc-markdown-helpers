import hljs from "highlight.js/lib/common";

export function countLines(source) {
  if (!source) {
    return 0;
  }

  return source.replace(/\n$/, "").split("\n").length;
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function waitForNextFrame() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      resolve();
    });
  });
}

export function uid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function flashButton(button, label) {
  const originalLabel = button.getAttribute("aria-label") || button.title;
  const originalText = button.textContent;
  if (label) {
    button.setAttribute("aria-label", label);
    button.title = label;
    if (!button.querySelector("svg")) {
      button.textContent = label;
    }
  }

  button.classList.add("is-flashed");
  window.setTimeout(() => {
    button.classList.remove("is-flashed");
    if (originalLabel) {
      button.setAttribute("aria-label", originalLabel);
      button.title = originalLabel;
    }
    if (originalText && !button.querySelector("svg")) {
      button.textContent = originalText;
    }
  }, 1200);
}

export function getLanguageLabel(code) {
  const languageClass = Array.from(code.classList).find((className) =>
    className.startsWith("language-"),
  );
  return languageClass?.slice("language-".length) || "";
}

export function applySyntaxHighlighting(code, language) {
  const resolvedLanguage = resolveHighlightLanguage(language);
  if (resolvedLanguage) {
    code.innerHTML = hljs.highlight(code.textContent || "", {
      language: resolvedLanguage,
      ignoreIllegals: true,
    }).value;
    return;
  }

  code.innerHTML = hljs.highlightAuto(code.textContent || "").value;
}

function resolveHighlightLanguage(language) {
  for (const candidate of getHighlightLanguageCandidates(language)) {
    if (hljs.getLanguage(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function getHighlightLanguageCandidates(language) {
  if (!language) {
    return [];
  }

  const normalized = language.trim().toLowerCase();
  if (!normalized) {
    return [];
  }

  const aliases = {
    shell: ["bash", "shell"],
    sh: ["bash", "sh"],
    zsh: ["bash", "zsh"],
    console: ["bash", "shell"],
    ts: ["typescript", "ts"],
    js: ["javascript", "js"],
    yml: ["yaml", "yml"],
    md: ["markdown", "md"],
  };

  return aliases[normalized] || [normalized];
}
