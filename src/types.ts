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
  line?: number;
  column?: number;
}

export interface CodeBlockMatch {
  language: string | undefined;
  content: string;
  startLine: number;
  endLine: number;
}
