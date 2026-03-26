import * as vscode from "vscode";

const DEFAULT_MARKDOWN_EXTENSIONS = [".md", ".markdown", ".mdx"];

export function getDefaultMarkdownExtensions(): string[] {
  return [...DEFAULT_MARKDOWN_EXTENSIONS];
}

export function normalizeMarkdownExtensions(rawExtensions: string[]): string[] {
  const normalized = rawExtensions
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0)
    .map((value) => (value.startsWith(".") ? value : `.${value}`));

  return normalized.length > 0
    ? [...new Set(normalized)]
    : getDefaultMarkdownExtensions();
}

export function isMarkdownLikeFilePath(
  filePath: string,
  extensions: string[],
): boolean {
  const lowerPath = filePath.toLowerCase();
  return normalizeMarkdownExtensions(extensions).some((extension) =>
    lowerPath.endsWith(extension),
  );
}

export function isMarkdownLikeDocument(
  document: vscode.TextDocument,
  extensions: string[],
): boolean {
  return (
    document.languageId === "markdown" ||
    (document.uri.scheme === "file" &&
      isMarkdownLikeFilePath(document.uri.fsPath, extensions))
  );
}

export function buildMarkdownDocumentSelector(
  extensions: string[],
): vscode.DocumentSelector {
  const normalized = normalizeMarkdownExtensions(extensions);

  return [
    { language: "markdown", scheme: "file" },
    { language: "markdown", scheme: "untitled" },
    ...normalized.map((extension) => ({
      scheme: "file",
      pattern: `**/*${extension}`,
    })),
  ];
}
