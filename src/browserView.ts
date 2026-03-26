import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { MarkdownDiscoveryService } from "./discovery";
import { openUntitledCodeDocument, resolveWorkspacePath } from "./editorTools";
import { MarkdownLogger } from "./logging";
import { isMarkdownLikeFilePath } from "./markdownFiles";
import { renderMarkdownDocument } from "./previewRenderer";
import { RenderedMarkdownDocument } from "./types";

interface WebviewFileSummary {
  relativePath: string;
  mtimeMs: number;
  size: number;
  headingCount: number;
  wordCount: number;
}

export class MarkdownBrowserViewProvider implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private selectedPath: string | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private htmlTemplate: string | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly discovery: MarkdownDiscoveryService,
    private readonly getPreviewMaxWidth: () => number,
    private readonly getMarkdownExtensions: () => string[],
    private readonly logger?: MarkdownLogger,
  ) {
    this.disposables.push(
      this.discovery.onDidChange(() => {
        if (!this.panel) {
          return;
        }
        void this.postFiles();
        if (this.selectedPath) {
          void this.loadFile(this.selectedPath);
        }
      }),
    );
  }

  public async revealAndOpenByRelativePath(
    relativePath: string,
  ): Promise<void> {
    this.selectedPath = relativePath;
    const panel = await this.ensurePanel();
    panel.reveal(vscode.ViewColumn.Active, true);
    await this.loadFile(relativePath);
  }

  public async revealPanel(): Promise<void> {
    const panel = await this.ensurePanel();
    panel.reveal(vscode.ViewColumn.Active, false);
    await this.postFiles();
    if (this.selectedPath) {
      await this.loadFile(this.selectedPath);
    }
  }

  public async refreshCurrentView(): Promise<void> {
    if (!this.selectedPath) {
      await this.postFiles();
      return;
    }
    await this.loadFile(this.selectedPath);
  }

  private async ensurePanel(): Promise<vscode.WebviewPanel> {
    if (this.panel) {
      return this.panel;
    }

    const panel = vscode.window.createWebviewPanel(
      "markdownHelpers.preview",
      "Markdown Helpers",
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
      },
    );

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    panel.webview.html = await this.getHtml(panel.webview);

    this.disposables.push(
      panel.webview.onDidReceiveMessage((message: unknown) =>
        this.handleWebviewMessage(message),
      ),
      panel.onDidDispose(() => {
        this.panel = undefined;
      }),
    );

    this.panel = panel;
    await this.postFiles();
    return panel;
  }

  private async postFiles(): Promise<void> {
    if (!this.panel) {
      return;
    }

    const files: WebviewFileSummary[] = this.discovery
      .getSnapshot()
      .files.map((file) => ({
        relativePath: file.relativePath,
        mtimeMs: file.mtimeMs,
        size: file.size,
        headingCount: file.headingCount,
        wordCount: file.wordCount,
      }))
      .slice(0, 100);

    await this.panel.webview.postMessage({
      type: "files",
      files,
      selectedPath: this.selectedPath,
    });
  }

  private async loadFile(relativePath: string): Promise<void> {
    if (!this.panel) {
      return;
    }

    const entry = this.discovery.getByRelativePath(relativePath);
    if (!entry) {
      await this.panel.webview.postMessage({
        type: "fileError",
        path: relativePath,
        message: "File is no longer available.",
      });
      return;
    }

    this.selectedPath = relativePath;
    this.panel.title = path.basename(entry.relativePath);

    try {
      const text = await fs.readFile(entry.uri.fsPath, "utf8");
      const rendered = this.renderMarkdown(text);
      await this.panel.webview.postMessage({
        type: "fileContent",
        path: entry.relativePath,
        mtimeMs: entry.mtimeMs,
        size: entry.size,
        text,
        html: rendered.html,
        toc: rendered.toc,
        maxWidthCh: this.getPreviewMaxWidth(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger?.error("Failed reading markdown file", {
        relativePath,
        message,
      });
      await this.panel.webview.postMessage({
        type: "fileError",
        path: relativePath,
        message,
      });
    }
  }

  private async handleWebviewMessage(message: unknown): Promise<void> {
    if (!message || typeof message !== "object") {
      return;
    }

    const typed = message as {
      type?: string;
      path?: string;
      line?: number;
      href?: string;
      content?: string;
      language?: string;
    };

    switch (typed.type) {
      case "ready":
        await this.postFiles();
        if (this.selectedPath) {
          await this.loadFile(this.selectedPath);
        }
        break;
      case "refresh":
        await this.discovery.refresh();
        break;
      case "openFile":
        if (typed.path) {
          await this.loadFile(typed.path);
        }
        break;
      case "openTextFile":
        if (typed.path) {
          const entry = this.discovery.getByRelativePath(typed.path);
          if (entry) {
            await showDocument(entry.uri, typed.line);
          }
        }
        break;
      case "openLocalLink":
        if (typed.href) {
          await this.openLocalLink(typed.href);
        }
        break;
      case "openPreviewCodeBlock":
        if (typed.content) {
          await openUntitledCodeDocument(
            typed.content,
            typed.language,
            this.selectedPath
              ? this.discovery.getByRelativePath(this.selectedPath)?.uri
              : undefined,
          );
        }
        break;
      default:
        break;
    }
  }

  private async openLocalLink(href: string): Promise<void> {
    const baseUri = this.selectedPath
      ? this.discovery.getByRelativePath(this.selectedPath)?.uri
      : undefined;
    const target = await resolveWorkspacePath(href, baseUri);
    if (!target) {
      vscode.window.showWarningMessage(
        `Unable to resolve link target: ${href}`,
      );
      return;
    }

    const relativePath = await this.discovery.resolveRelativePath(target.uri);
    const isMarkdownTarget =
      target.kind === "file" &&
      isMarkdownLikeFilePath(target.uri.fsPath, this.getMarkdownExtensions());

    if (isMarkdownTarget && relativePath) {
      await this.revealAndOpenByRelativePath(relativePath);
      if (typeof target.line === "number") {
        await showDocument(
          target.uri,
          target.line,
          target.endLine,
          target.column,
        );
      }
      return;
    }

    if (target.kind === "directory") {
      await vscode.commands.executeCommand("revealInExplorer", target.uri);
      return;
    }

    await showDocument(target.uri, target.line, target.endLine, target.column);
  }

  private renderMarkdown(text: string): RenderedMarkdownDocument {
    return renderMarkdownDocument(text);
  }

  private async getHtml(webview: vscode.Webview): Promise<string> {
    if (!this.htmlTemplate) {
      const templateUri = vscode.Uri.joinPath(
        this.extensionUri,
        "media",
        "viewer.html",
      );
      this.htmlTemplate = await fs.readFile(templateUri.fsPath, "utf8");
    }

    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "viewer.bundle.css"),
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "viewer.bundle.js"),
    );

    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data: https:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
    ].join("; ");

    return this.htmlTemplate
      .replace(/\{\{CSP\}\}/g, csp)
      .replace(/\{\{STYLE_URI\}\}/g, styleUri.toString())
      .replace(/\{\{SCRIPT_URI\}\}/g, scriptUri.toString());
  }

  public dispose(): void {
    this.panel?.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}

async function showDocument(
  uri: vscode.Uri,
  line?: number,
  endLine?: number,
  column?: number,
): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri);
  if (
    typeof line === "number" &&
    Number.isFinite(line) &&
    document.lineCount > 0
  ) {
    const clampedLine = Math.min(
      Math.max(Math.floor(line) - 1, 0),
      document.lineCount - 1,
    );
    const clampedEndLine = Math.min(
      Math.max(Math.floor((endLine ?? line) - 1), clampedLine),
      document.lineCount - 1,
    );
    const clampedColumn = Math.max(Math.floor((column ?? 1) - 1), 0);
    const selectionStart = new vscode.Position(clampedLine, clampedColumn);
    const selectionEnd = new vscode.Position(
      clampedEndLine,
      document.lineAt(clampedEndLine).range.end.character,
    );
    const range = new vscode.Range(selectionStart, selectionEnd);
    const editor = await vscode.window.showTextDocument(document, {
      preview: true,
      selection: range,
    });
    editor.revealRange(
      range,
      vscode.TextEditorRevealType.InCenterIfOutsideViewport,
    );
    return;
  }

  await vscode.window.showTextDocument(document, { preview: true });
}
