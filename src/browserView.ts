import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { MarkdownDiscoveryService } from "./discovery";
import {
  buildLinkHoverPreview,
  openUntitledCodeDocument,
  resolveWorkspacePath,
} from "./editorTools";
import { MarkdownLogger } from "./logging";
import { isMarkdownLikeFilePath } from "./markdownFiles";
import { renderMarkdownDocument } from "./previewRenderer";
import {
  FileLocationTarget,
  LocalLinkHoverPreview,
  RenderedMarkdownDocument,
} from "./types";

interface WebviewFileSummary {
  relativePath: string;
  mtimeMs: number;
  size: number;
  headingCount: number;
  wordCount: number;
}

const DEFAULT_PREVIEW_THEME = "sage";
const DEFAULT_PREVIEW_FONT_SCALE = 1;
const MIN_PREVIEW_FONT_SCALE = 0.85;
const MAX_PREVIEW_FONT_SCALE = 1.3;

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

  public async refreshAppearanceSettings(): Promise<void> {
    await this.postPreviewAppearance();
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
        localResourceRoots: getWebviewResourceRoots(this.extensionUri),
      },
    );

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: getWebviewResourceRoots(this.extensionUri),
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

  private async postPreviewAppearance(): Promise<void> {
    if (!this.panel) {
      return;
    }

    await this.panel.webview.postMessage({
      type: "previewAppearance",
      themeId: getConfiguredPreviewTheme(),
      fontScale: getConfiguredPreviewFontScale(),
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
      const rendered = await this.renderMarkdown(
        text,
        entry.uri,
        this.panel.webview,
      );
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
      hrefs?: string[];
      requestId?: string;
      content?: string;
      language?: string;
      themeId?: string;
      fontScale?: number;
    };

    switch (typed.type) {
      case "ready":
        await this.postFiles();
        await this.postPreviewAppearance();
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
      case "openLocalLinkInEditor":
        if (typed.href) {
          await this.openLocalLink(typed.href, {
            preferPreview: false,
            pinned: true,
          });
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
      case "resolvePreviewLinks":
        if (typed.requestId && Array.isArray(typed.hrefs)) {
          await this.resolvePreviewLinks(typed.requestId, typed.hrefs);
        }
        break;
      case "resolvePreviewLinkHover":
        if (typed.requestId && typed.href) {
          await this.resolvePreviewLinkHover(typed.requestId, typed.href);
        }
        break;
      case "updatePreviewAppearance":
        await this.updatePreviewAppearance({
          themeId: typed.themeId,
          fontScale: typed.fontScale,
        });
        break;
      default:
        break;
    }
  }

  private async updatePreviewAppearance(preferences: {
    themeId?: string;
    fontScale?: number;
  }): Promise<void> {
    const updates: Thenable<void>[] = [];
    const configuration = vscode.workspace.getConfiguration("markdownHelpers");

    if (typeof preferences.themeId === "string") {
      const nextTheme = preferences.themeId.trim() || DEFAULT_PREVIEW_THEME;
      updates.push(
        configuration.update(
          "previewTheme",
          nextTheme,
          vscode.ConfigurationTarget.Global,
        ),
      );
    }

    if (typeof preferences.fontScale === "number") {
      updates.push(
        configuration.update(
          "previewFontScale",
          clampPreviewFontScale(preferences.fontScale),
          vscode.ConfigurationTarget.Global,
        ),
      );
    }

    if (updates.length > 0) {
      await Promise.all(updates);
    }

    await this.postPreviewAppearance();
  }

  private async resolvePreviewLinks(
    requestId: string,
    hrefs: string[],
  ): Promise<void> {
    if (!this.panel) {
      return;
    }

    const baseUri = this.selectedPath
      ? this.discovery.getByRelativePath(this.selectedPath)?.uri
      : undefined;
    const uniqueHrefs = [...new Set(hrefs)].filter(
      (href): href is string =>
        typeof href === "string" && href.trim().length > 0,
    );
    const resolvedResults = await Promise.all(
      uniqueHrefs.map(async (href) => {
        const target = await resolveWorkspacePath(href, baseUri);
        if (!target) {
          return undefined;
        }

        const isMarkdownTarget =
          target.kind === "file" &&
          isMarkdownLikeFilePath(
            target.uri.fsPath,
            this.getMarkdownExtensions(),
          );

        const relativePath = isMarkdownTarget
          ? this.discovery.getWorkspaceRelativePath(target.uri)
          : undefined;
        return {
          href,
          kind: target.kind,
          isMarkdown: isMarkdownTarget,
          tooltip: formatPreviewLinkTooltip(target, relativePath),
        };
      }),
    );

    await this.panel.webview.postMessage({
      type: "previewLinksResolved",
      requestId,
      results: resolvedResults.filter((result) => result !== undefined),
    });
  }

  private async resolvePreviewLinkHover(
    requestId: string,
    href: string,
  ): Promise<void> {
    if (!this.panel) {
      return;
    }

    const baseUri = this.selectedPath
      ? this.discovery.getByRelativePath(this.selectedPath)?.uri
      : undefined;
    const target = await resolveWorkspacePath(href, baseUri);
    const result: LocalLinkHoverPreview | undefined = target
      ? await buildLinkHoverPreview(target)
      : undefined;

    await this.panel.webview.postMessage({
      type: "previewLinkHoverResolved",
      requestId,
      result,
    });
  }

  private async openLocalLink(
    href: string,
    options: { preferPreview?: boolean; pinned?: boolean } = {},
  ): Promise<void> {
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
    const preferPreview = options.preferPreview ?? true;

    if (preferPreview && isMarkdownTarget && relativePath) {
      await this.revealAndOpenByRelativePath(relativePath);
      if (typeof target.line === "number") {
        await showDocument(
          target.uri,
          target.line,
          target.endLine,
          target.column,
          { pinned: options.pinned },
        );
      }
      return;
    }

    if (target.kind === "directory") {
      await vscode.commands.executeCommand("revealInExplorer", target.uri);
      return;
    }

    await showDocument(target.uri, target.line, target.endLine, target.column, {
      pinned: options.pinned,
    });
  }

  private async renderMarkdown(
    text: string,
    baseUri: vscode.Uri,
    webview: vscode.Webview,
  ): Promise<RenderedMarkdownDocument> {
    return renderMarkdownDocument(text, {
      baseUri,
      resolveImageSource: (src, imageBaseUri) =>
        this.resolvePreviewImageSource(src, imageBaseUri, webview),
    });
  }

  private async resolvePreviewImageSource(
    src: string,
    baseUri: vscode.Uri,
    webview: vscode.Webview,
  ): Promise<string | undefined> {
    const normalized = src.trim();
    if (!normalized || isWebSafeImageSource(normalized)) {
      return undefined;
    }

    const imageUris = resolvePreviewImageUris(normalized, baseUri);
    for (const imageUri of imageUris) {
      try {
        await fs.access(imageUri.fsPath);
      } catch {
        continue;
      }

      if (vscode.workspace.getWorkspaceFolder(imageUri)) {
        return webview.asWebviewUri(imageUri).toString();
      }

      return encodeImageFileAsDataUri(imageUri);
    }

    return undefined;
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
      vscode.Uri.joinPath(
        this.extensionUri,
        "media",
        "dist",
        "viewer.bundle.css",
      ),
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.extensionUri,
        "media",
        "dist",
        "viewer.bundle.js",
      ),
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

function getWebviewResourceRoots(extensionUri: vscode.Uri): vscode.Uri[] {
  const workspaceRoots =
    vscode.workspace.workspaceFolders?.map((folder) => folder.uri) ?? [];
  return [vscode.Uri.joinPath(extensionUri, "media"), ...workspaceRoots];
}

function getConfiguredPreviewTheme(): string {
  const value = vscode.workspace
    .getConfiguration("markdownHelpers")
    .get<string>("previewTheme", DEFAULT_PREVIEW_THEME);
  return value?.trim() ? value.trim() : DEFAULT_PREVIEW_THEME;
}

function getConfiguredPreviewFontScale(): number {
  const value = vscode.workspace
    .getConfiguration("markdownHelpers")
    .get<number>("previewFontScale", DEFAULT_PREVIEW_FONT_SCALE);
  return clampPreviewFontScale(value);
}

function clampPreviewFontScale(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_PREVIEW_FONT_SCALE;
  }

  return Math.round(Math.min(MAX_PREVIEW_FONT_SCALE, Math.max(MIN_PREVIEW_FONT_SCALE, value)) * 100) / 100;
}

function isWebSafeImageSource(src: string): boolean {
  return /^(https?:|data:|vscode-webview-resource:)/i.test(src);
}

function resolvePreviewImageUris(
  src: string,
  baseUri: vscode.Uri,
): vscode.Uri[] {
  const fileUriPrefix = /^file:\/\//i;
  if (fileUriPrefix.test(src)) {
    try {
      const uri = vscode.Uri.parse(src, true);
      return uri.scheme === "file" ? [uri] : [];
    } catch {
      return [];
    }
  }

  const rawPath = normalizePreviewImagePath(src);
  if (!rawPath) {
    return [];
  }

  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  const candidates = new Map<string, vscode.Uri>();

  if (path.isAbsolute(rawPath)) {
    const absoluteUri = vscode.Uri.file(rawPath);
    candidates.set(absoluteUri.fsPath, absoluteUri);

    const workspaceRelativePath = rawPath.replace(/^\/+/, "");
    if (workspaceRelativePath.length > 0) {
      for (const folder of workspaceFolders) {
        const rootedUri = vscode.Uri.file(
          path.join(folder.uri.fsPath, workspaceRelativePath),
        );
        candidates.set(rootedUri.fsPath, rootedUri);
      }
    }

    return [...candidates.values()];
  }

  if (baseUri.scheme === "file") {
    const relativeUri = vscode.Uri.file(
      path.resolve(path.dirname(baseUri.fsPath), rawPath),
    );
    candidates.set(relativeUri.fsPath, relativeUri);
  }

  for (const folder of workspaceFolders) {
    const rootedUri = vscode.Uri.file(path.join(folder.uri.fsPath, rawPath));
    candidates.set(rootedUri.fsPath, rootedUri);
  }

  return [...candidates.values()];
}

function normalizePreviewImagePath(src: string): string {
  const [rawPath] = src.split(/[?#]/, 1);
  if (!rawPath) {
    return "";
  }

  let normalized = rawPath.trim();
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // Preserve partially encoded paths.
  }

  if (normalized.startsWith("~/")) {
    return path.join(os.homedir(), normalized.slice(2));
  }

  return normalized;
}

async function encodeImageFileAsDataUri(
  uri: vscode.Uri,
): Promise<string | undefined> {
  const mimeType = getMimeTypeForImage(uri.fsPath);
  if (!mimeType) {
    return undefined;
  }

  const contents = await fs.readFile(uri.fsPath);
  return `data:${mimeType};base64,${contents.toString("base64")}`;
}

function getMimeTypeForImage(fsPath: string): string | undefined {
  switch (path.extname(fsPath).toLowerCase()) {
    case ".apng":
      return "image/apng";
    case ".avif":
      return "image/avif";
    case ".bmp":
      return "image/bmp";
    case ".gif":
      return "image/gif";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".webp":
      return "image/webp";
    default:
      return undefined;
  }
}

function formatPreviewLinkTooltip(
  target: FileLocationTarget,
  relativePath?: string,
): string {
  const displayPath = relativePath ?? target.uri.fsPath;

  if (target.kind === "directory") {
    return `Reveal ${displayPath} in explorer`;
  }

  if (
    typeof target.line === "number" &&
    typeof target.endLine === "number" &&
    target.line !== target.endLine
  ) {
    return `Open ${displayPath}:${target.line}-${target.endLine}`;
  }

  if (typeof target.line === "number" && typeof target.column === "number") {
    return `Open ${displayPath}:${target.line}:${target.column}`;
  }

  if (typeof target.line === "number") {
    return `Open ${displayPath}:${target.line}`;
  }

  return `Open ${displayPath}`;
}

async function showDocument(
  uri: vscode.Uri,
  line?: number,
  endLine?: number,
  column?: number,
  options: { pinned?: boolean } = {},
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
      preview: !options.pinned,
      selection: range,
    });
    editor.revealRange(
      range,
      vscode.TextEditorRevealType.InCenterIfOutsideViewport,
    );
    return;
  }

  await vscode.window.showTextDocument(document, {
    preview: !options.pinned,
  });
}
