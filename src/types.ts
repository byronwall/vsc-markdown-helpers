import * as vscode from "vscode";

export interface MarkdownFileEntry {
  uri: vscode.Uri;
  relativePath: string;
  mtimeMs: number;
  size: number;
  headingCount: number;
  wordCount: number;
}

export interface DiscoverySnapshot {
  files: MarkdownFileEntry[];
  generatedAt: number;
}

export interface MarkdownTocItem {
  id: string;
  level: number;
  text: string;
}

export interface RenderedMarkdownDocument {
  html: string;
  toc: MarkdownTocItem[];
}

export interface FileLocationTarget {
  uri: vscode.Uri;
  kind: "file" | "directory";
  line?: number;
  endLine?: number;
  column?: number;
}

export interface LocalLinkHoverEntry {
  label: string;
  path: string;
  kind: "file" | "directory";
}

export interface LocalLinkHoverPreview {
  kind: "file" | "directory";
  displayPath: string;
  location?: string;
  note?: string;
  language?: string;
  code?: string;
  entries?: LocalLinkHoverEntry[];
  message?: string;
  footer?: string;
}

export interface CodeBlockMatch {
  language: string | undefined;
  content: string;
  startLine: number;
  endLine: number;
}
