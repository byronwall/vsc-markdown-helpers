import * as path from "node:path";
import * as vscode from "vscode";
import { MarkdownDiscoveryService } from "./discovery";
import { MarkdownLogger } from "./logging";

export class RecentMarkdownTreeProvider
  implements vscode.TreeDataProvider<RecentMarkdownItem>, vscode.Disposable
{
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
    RecentMarkdownItem | undefined
  >();
  public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly discovery: MarkdownDiscoveryService,
    private readonly getMaxRecent: () => number,
    private readonly logger?: MarkdownLogger,
  ) {
    this.disposables.push(
      this.discovery.onDidChange(() => {
        this.onDidChangeTreeDataEmitter.fire(undefined);
      }),
    );
  }

  public getTreeItem(element: RecentMarkdownItem): vscode.TreeItem {
    return element;
  }

  public getChildren(
    element?: RecentMarkdownItem,
  ): Thenable<RecentMarkdownItem[]> {
    if (element) {
      return Promise.resolve([]);
    }

    const maxRecent = this.getMaxRecent();
    const snapshot = this.discovery.getSnapshot();
    const items = snapshot.files.slice(0, maxRecent).map((file) => {
      const item = new RecentMarkdownItem(
        file.relativePath,
        file.uri,
        file.mtimeMs,
        file.size,
        file.headingCount,
        file.wordCount,
      );
      item.tooltip = new vscode.MarkdownString(
        [
          `**${file.relativePath}**`,
          "",
          `Headings: ${file.headingCount.toLocaleString()}`,
          `Words: ${file.wordCount.toLocaleString()}`,
          `Updated: ${new Date(file.mtimeMs).toLocaleString()}`,
          `Size: ${formatBytes(file.size)}`,
        ].join("\n"),
      );
      return item;
    });

    this.logger?.info("Tree getChildren generated items", {
      totalDiscovered: snapshot.files.length,
      returned: items.length,
    });

    return Promise.resolve(items);
  }

  public refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  public dispose(): void {
    this.onDidChangeTreeDataEmitter.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}

export class RecentMarkdownItem extends vscode.TreeItem {
  constructor(
    public readonly relativePath: string,
    public readonly uri: vscode.Uri,
    mtimeMs: number,
    size: number,
    headingCount: number,
    wordCount: number,
  ) {
    super(path.basename(relativePath), vscode.TreeItemCollapsibleState.None);
    this.contextValue = "markdownFile";
    this.iconPath = new vscode.ThemeIcon("markdown");
    this.resourceUri = uri;
    this.command = {
      command: "markdownHelpers.openMarkdown",
      title: "Open Markdown Preview",
      arguments: [this],
    };
    this.description = `${formatAge(mtimeMs)} • ${headingCount}h • ${formatCompactCount(wordCount)}w`;
    this.tooltip = relativePath;
    this.accessibilityInformation = {
      label: `${relativePath}, ${formatBytes(size)}`,
    };
  }
}

function formatAge(mtimeMs: number): string {
  const deltaMs = Date.now() - mtimeMs;
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;

  if (deltaMs < minuteMs) {
    return "just now";
  }
  if (deltaMs < hourMs) {
    return `${Math.floor(deltaMs / minuteMs)}m ago`;
  }
  if (deltaMs < dayMs) {
    return `${Math.floor(deltaMs / hourMs)}h ago`;
  }
  return `${Math.floor(deltaMs / dayMs)}d ago`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatCompactCount(value: number): string {
  if (value < 1000) {
    return String(value);
  }
  if (value < 1000 * 1000) {
    return formatCompactUnit(value / 1000, "k");
  }
  return formatCompactUnit(value / (1000 * 1000), "M");
}

function formatCompactUnit(value: number, unit: string): string {
  const fixed = value >= 10 ? Math.round(value).toString() : value.toFixed(1);
  return `${fixed.replace(/\.0$/, "")}${unit}`;
}
