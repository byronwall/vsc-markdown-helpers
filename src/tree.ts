import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { MarkdownDiscoveryService } from "./discovery";
import { MarkdownLogger } from "./logging";

const execFileAsync = promisify(execFile);

export type RecentMarkdownFilterMode = "all" | "changedSinceBase";

export interface RecentMarkdownViewState {
  description?: string;
  message?: string;
  badgeValue?: number;
  badgeTooltip?: string;
}

interface ComparisonTarget {
  baseRef: string;
  description: string;
  emptyMessage: string;
  badgeTooltip: string;
}

export class RecentMarkdownTreeProvider
  implements vscode.TreeDataProvider<RecentMarkdownItem>, vscode.Disposable
{
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
    RecentMarkdownItem | undefined
  >();
  public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly workspaceRoot: vscode.Uri,
    private readonly discovery: MarkdownDiscoveryService,
    private readonly getMaxRecent: () => number,
    private readonly getFilterMode: () => RecentMarkdownFilterMode,
    private readonly getBaseRef: () => string,
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

  public async getChildren(
    element?: RecentMarkdownItem,
  ): Promise<RecentMarkdownItem[]> {
    if (element) {
      return [];
    }

    const maxRecent = this.getMaxRecent();
    const snapshot = this.discovery.getSnapshot();
    const { files: filteredFiles } = await this.resolveFilteredFiles(
      snapshot.files,
    );
    const items = filteredFiles.slice(0, maxRecent).map((file) => {
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
      totalFiltered: filteredFiles.length,
      filterMode: this.getFilterMode(),
      returned: items.length,
    });

    return items;
  }

  public async getViewState(): Promise<RecentMarkdownViewState> {
    const snapshot = this.discovery.getSnapshot();
    const { state } = await this.resolveFilteredFiles(snapshot.files);
    return state;
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

  private async resolveFilteredFiles(
    files: readonly {
      relativePath: string;
      uri: vscode.Uri;
      mtimeMs: number;
      size: number;
      headingCount: number;
      wordCount: number;
    }[],
  ): Promise<{ files: typeof files; state: RecentMarkdownViewState }> {
    if (this.getFilterMode() !== "changedSinceBase") {
      return {
        files,
        state: {
          description: undefined,
          message: undefined,
          badgeValue: undefined,
          badgeTooltip: undefined,
        },
      };
    }

    const comparisonTarget = await resolveComparisonTarget(
      this.workspaceRoot,
      this.getBaseRef(),
      this.logger,
    );
    const changedPaths = await getChangedMarkdownPaths(
      this.workspaceRoot,
      comparisonTarget.baseRef,
      this.logger,
    );
    if (!changedPaths) {
      return {
        files,
        state: {
          description: comparisonTarget.description,
          message: "Unable to resolve git changes. Showing all markdown files.",
          badgeValue: files.length,
          badgeTooltip: comparisonTarget.badgeTooltip,
        },
      };
    }

    const filteredFiles = files.filter((file) => changedPaths.has(file.relativePath));
    return {
      files: filteredFiles,
      state: {
        description: comparisonTarget.description,
        message: filteredFiles.length === 0 ? comparisonTarget.emptyMessage : undefined,
        badgeValue: filteredFiles.length,
        badgeTooltip: comparisonTarget.badgeTooltip,
      },
    };
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
      title: "$(preview)",
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

async function getChangedMarkdownPaths(
  workspaceRoot: vscode.Uri,
  baseRef: string,
  logger?: MarkdownLogger,
): Promise<Set<string> | undefined> {
  try {
    const changedPaths = new Set<string>();
    const revisionRanges = [`${baseRef}...HEAD`, baseRef];

    for (const revisionRange of revisionRanges) {
      const stdout = await runGitCommand(workspaceRoot, [
        "diff",
        "--name-only",
        "--diff-filter=ACMRTUXB",
        revisionRange,
        "--",
      ]);
      if (stdout !== undefined) {
        addPathsFromGitOutput(changedPaths, stdout);
        break;
      }
    }

    const staged = await runGitCommand(workspaceRoot, [
      "diff",
      "--cached",
      "--name-only",
      "--diff-filter=ACMRTUXB",
      "--",
    ]);
    if (staged !== undefined) {
      addPathsFromGitOutput(changedPaths, staged);
    }

    const unstaged = await runGitCommand(workspaceRoot, [
      "diff",
      "--name-only",
      "--diff-filter=ACMRTUXB",
      "--",
    ]);
    if (unstaged !== undefined) {
      addPathsFromGitOutput(changedPaths, unstaged);
    }

    const untracked = await runGitCommand(workspaceRoot, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "--",
    ]);
    if (untracked !== undefined) {
      addPathsFromGitOutput(changedPaths, untracked);
    }

    return changedPaths;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger?.warn("Unable to compute changed markdown filter", {
      workspaceRoot: workspaceRoot.fsPath,
      baseRef,
      message,
    });
    return undefined;
  }
}

async function resolveComparisonTarget(
  workspaceRoot: vscode.Uri,
  fallbackBaseRef: string,
  logger?: MarkdownLogger,
): Promise<ComparisonTarget> {
  const pullRequest = await getActivePullRequest(workspaceRoot, logger);
  if (pullRequest?.baseRefName) {
    return {
      baseRef: pullRequest.baseRefName,
      description: `PR #${pullRequest.number} vs ${pullRequest.baseRefName}`,
      emptyMessage: `No markdown files changed in active PR #${pullRequest.number} against ${pullRequest.baseRefName}.`,
      badgeTooltip: `Markdown files changed in active PR #${pullRequest.number} against ${pullRequest.baseRefName}`,
    };
  }

  const baseRef = fallbackBaseRef.trim() || "main";
  return {
    baseRef,
    description: `Changed vs ${baseRef}`,
    emptyMessage: `No markdown files changed against ${baseRef}.`,
    badgeTooltip: `Markdown files changed against ${baseRef}`,
  };
}

async function getActivePullRequest(
  workspaceRoot: vscode.Uri,
  logger?: MarkdownLogger,
): Promise<{ number: number; baseRefName: string } | undefined> {
  try {
    const currentBranch = await runGitCommand(workspaceRoot, [
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ]);
    const branchName = currentBranch?.trim();
    if (!branchName) {
      return undefined;
    }

    const { stdout } = await execFileAsync(
      "gh",
      ["pr", "view", "--json", "number,state,baseRefName,headRefName"],
      { cwd: workspaceRoot.fsPath },
    );
    const parsed = JSON.parse(stdout) as {
      number?: number;
      state?: string;
      baseRefName?: string;
      headRefName?: string;
    };

    if (
      parsed.state !== "OPEN" ||
      !parsed.baseRefName ||
      (parsed.headRefName && parsed.headRefName !== branchName)
    ) {
      return undefined;
    }

    return {
      number: parsed.number ?? 0,
      baseRefName: parsed.baseRefName,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger?.info("No active pull request detected for current branch", {
      workspaceRoot: workspaceRoot.fsPath,
      message,
    });
    return undefined;
  }
}

async function runGitCommand(
  workspaceRoot: vscode.Uri,
  args: string[],
): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", [
      "-C",
      workspaceRoot.fsPath,
      ...args,
    ]);
    return stdout;
  } catch {
    return undefined;
  }
}

function addPathsFromGitOutput(target: Set<string>, stdout: string): void {
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    target.add(trimmed);
  }
}
