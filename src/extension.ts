import * as vscode from "vscode";
import { MarkdownBrowserViewProvider } from "./browserView";
import { MarkdownDiscoveryService } from "./discovery";
import {
  MarkdownCodeBlockCodeLensProvider,
  MarkdownPathHoverProvider,
  MarkdownPathLinkProvider,
  openCodeBlockAtLine,
  resolveWorkspacePath,
} from "./editorTools";
import { MarkdownLogger } from "./logging";
import { RecentMarkdownItem, RecentMarkdownTreeProvider } from "./tree";

const MARKDOWN_SELECTOR: vscode.DocumentSelector = [
  { language: "markdown", scheme: "file" },
  { language: "markdown", scheme: "untitled" },
];

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const logger = new MarkdownLogger();
  context.subscriptions.push(logger);

  let discovery: MarkdownDiscoveryService | undefined;
  let recentMarkdownProvider: vscode.TreeDataProvider<vscode.TreeItem> =
    new PlaceholderRecentMarkdownTreeProvider();
  let treeProvider: RecentMarkdownTreeProvider | undefined;
  let browserProvider: MarkdownBrowserViewProvider | undefined;

  const codeLensProvider = new MarkdownCodeBlockCodeLensProvider();
  context.subscriptions.push(codeLensProvider);

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

  const getConfiguredExtensions = (): string[] => {
    const configured = vscode.workspace
      .getConfiguration("markdownHelpers")
      .get<string[]>("extensions", [".md", ".markdown", ".mdx"]);
    return Array.isArray(configured)
      ? configured
      : [".md", ".markdown", ".mdx"];
  };

  const getMaxRecent = (): number => {
    const value = vscode.workspace
      .getConfiguration("markdownHelpers")
      .get<number>("maxRecent", 60);
    return Number.isFinite(value) ? Math.max(5, value) : 60;
  };

  const getPreviewMaxWidth = (): number => {
    const value = vscode.workspace
      .getConfiguration("markdownHelpers")
      .get<number>("previewMaxWidth", 96);
    return Number.isFinite(value) ? Math.max(48, value) : 96;
  };

  if (workspaceFolder) {
    try {
      discovery = new MarkdownDiscoveryService(
        workspaceFolder.uri,
        getConfiguredExtensions,
        logger,
      );
      await discovery.start();

      treeProvider = new RecentMarkdownTreeProvider(
        discovery,
        getMaxRecent,
        logger,
      );
      browserProvider = new MarkdownBrowserViewProvider(
        context.extensionUri,
        discovery,
        getPreviewMaxWidth,
        logger,
      );

      context.subscriptions.push(discovery, treeProvider, browserProvider);
      recentMarkdownProvider = treeProvider;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Workspace initialization failed", { message });
      vscode.window.showErrorMessage(
        `Markdown Helpers failed to initialize: ${message}. Check Output -> Markdown Helpers.`,
      );
    }
  }

  context.subscriptions.push(
    vscode.languages.registerDocumentLinkProvider(
      MARKDOWN_SELECTOR,
      new MarkdownPathLinkProvider(),
    ),
    vscode.languages.registerHoverProvider(
      MARKDOWN_SELECTOR,
      new MarkdownPathHoverProvider(),
    ),
    vscode.languages.registerCodeLensProvider(
      MARKDOWN_SELECTOR,
      codeLensProvider,
    ),
    vscode.window.registerTreeDataProvider(
      "markdownHelpers.recentMarkdown",
      recentMarkdownProvider,
    ),
    vscode.commands.registerCommand("markdownHelpers.refresh", async () => {
      if (!discovery) {
        vscode.window.showWarningMessage(
          "Markdown Helpers refresh requires an open workspace folder.",
        );
        return;
      }
      await discovery.refresh();
      treeProvider?.refresh();
      codeLensProvider.refresh();
      await browserProvider?.refreshCurrentView();
    }),
    vscode.commands.registerCommand(
      "markdownHelpers.revealPreview",
      async () => {
        if (!browserProvider) {
          vscode.window.showWarningMessage(
            "Markdown Helpers preview requires an open workspace folder.",
          );
          return;
        }
        await browserProvider.revealPanel();
      },
    ),
    vscode.commands.registerCommand("markdownHelpers.showOutput", () => {
      logger.show();
    }),
    vscode.commands.registerCommand(
      "markdownHelpers.openMarkdownFile",
      async (target?: RecentMarkdownItem | vscode.Uri | string) => {
        const uri = await resolveUri(target, discovery);
        if (!uri) {
          return;
        }
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document, { preview: false });
      },
    ),
    vscode.commands.registerCommand(
      "markdownHelpers.copyMarkdownPath",
      async (target?: RecentMarkdownItem | vscode.Uri | string) => {
        const uri = await resolveUri(target, discovery);
        if (!uri) {
          return;
        }
        await vscode.env.clipboard.writeText(uri.fsPath);
        vscode.window.setStatusBarMessage(`Copied path: ${uri.fsPath}`, 2500);
      },
    ),
    vscode.commands.registerCommand(
      "markdownHelpers.openMarkdown",
      async (target?: RecentMarkdownItem | vscode.Uri | string) => {
        if (!discovery || !browserProvider) {
          vscode.window.showWarningMessage(
            "Markdown Helpers preview requires an open workspace folder.",
          );
          return;
        }
        const relativePath = await resolveRelativePath(target, discovery);
        if (!relativePath) {
          return;
        }
        await browserProvider.revealAndOpenByRelativePath(relativePath);
      },
    ),
    vscode.commands.registerCommand(
      "markdownHelpers.openLocation",
      async (target?: {
        path?: string;
        line?: number;
        endLine?: number;
        column?: number;
      }) => {
        if (!target?.path) {
          return;
        }
        const resolved = await resolveWorkspacePath(
          `${target.path}${formatLocationSuffix(target.line, target.endLine, target.column)}`,
        );
        if (!resolved) {
          return;
        }
        await showLocation(
          resolved.uri,
          resolved.kind,
          resolved.line,
          resolved.endLine,
          resolved.column,
        );
      },
    ),
    vscode.commands.registerCommand(
      "markdownHelpers.openCodeBlock",
      async (documentUri?: vscode.Uri, startLine?: number) => {
        if (!documentUri || typeof startLine !== "number") {
          return;
        }
        const document = await vscode.workspace.openTextDocument(documentUri);
        await openCodeBlockAtLine(document, startLine);
      },
    ),
    vscode.commands.registerCommand(
      "markdownHelpers.openCodeBlockAtCursor",
      async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== "markdown") {
          return;
        }
        const opened = await openCodeBlockAtLine(
          editor.document,
          editor.selection.active.line,
        );
        if (!opened) {
          vscode.window.showInformationMessage(
            "No fenced code block found at the current cursor position.",
          );
        }
      },
    ),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (!discovery) {
        return;
      }
      if (event.affectsConfiguration("markdownHelpers.extensions")) {
        await discovery.refresh();
      }
      if (event.affectsConfiguration("markdownHelpers.maxRecent")) {
        treeProvider?.refresh();
      }
      if (event.affectsConfiguration("markdownHelpers.previewMaxWidth")) {
        await browserProvider?.refreshCurrentView();
      }
      if (
        event.affectsConfiguration("markdownHelpers.extensions") ||
        event.affectsConfiguration("markdownHelpers.maxRecent")
      ) {
        codeLensProvider.refresh();
      }
    }),
  );
}

export function deactivate(): void {
  // no-op
}

async function resolveRelativePath(
  target: RecentMarkdownItem | vscode.Uri | string | undefined,
  discovery: MarkdownDiscoveryService,
): Promise<string | undefined> {
  if (!target) {
    const activeDocument = vscode.window.activeTextEditor?.document;
    if (activeDocument?.languageId === "markdown") {
      return discovery.resolveRelativePath(activeDocument.uri);
    }
    return undefined;
  }

  if (typeof target === "string") {
    return target;
  }

  if (target instanceof vscode.Uri) {
    return discovery.resolveRelativePath(target);
  }

  return target.relativePath;
}

async function resolveUri(
  target: RecentMarkdownItem | vscode.Uri | string | undefined,
  discovery?: MarkdownDiscoveryService,
): Promise<vscode.Uri | undefined> {
  if (!target) {
    const activeDocument = vscode.window.activeTextEditor?.document;
    if (activeDocument?.languageId === "markdown") {
      return activeDocument.uri;
    }
    return undefined;
  }

  if (target instanceof vscode.Uri) {
    return target;
  }

  if (typeof target === "string") {
    if (!discovery) {
      return undefined;
    }
    const relativePath = await resolveRelativePath(target, discovery);
    if (!relativePath) {
      return undefined;
    }
    return discovery.getByRelativePath(relativePath)?.uri;
  }

  return target.uri;
}

async function showLocation(
  uri: vscode.Uri,
  kind: "file" | "directory",
  line?: number,
  endLine?: number,
  column?: number,
): Promise<void> {
  if (kind === "directory") {
    await vscode.commands.executeCommand("revealInExplorer", uri);
    return;
  }

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
      preview: false,
      selection: range,
    });
    editor.revealRange(
      range,
      vscode.TextEditorRevealType.InCenterIfOutsideViewport,
    );
    return;
  }
  await vscode.window.showTextDocument(document, { preview: false });
}

function formatLocationSuffix(
  line?: number,
  endLine?: number,
  column?: number,
): string {
  if (typeof line !== "number") {
    return "";
  }
  if (typeof endLine === "number" && endLine > line) {
    return `:${line}-${endLine}`;
  }
  if (typeof column !== "number") {
    return `:${line}`;
  }
  return `:${line}:${column}`;
}

class PlaceholderRecentMarkdownTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly item = new vscode.TreeItem(
    "Open a workspace folder to load markdown files.",
    vscode.TreeItemCollapsibleState.None,
  );

  public getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  public getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
    return Promise.resolve(element ? [] : [this.item]);
  }
}
