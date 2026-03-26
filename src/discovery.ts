import * as path from "node:path";
import * as vscode from "vscode";
import { MarkdownLogger } from "./logging";
import {
  isMarkdownLikeFilePath,
  normalizeMarkdownExtensions,
} from "./markdownFiles";
import { DiscoverySnapshot, MarkdownFileEntry } from "./types";

const HARD_EXCLUDED_SEGMENTS = new Set([
  "node_modules",
  ".venv",
  ".git",
  "out",
]);

export class MarkdownDiscoveryService implements vscode.Disposable {
  private readonly onDidChangeEmitter =
    new vscode.EventEmitter<DiscoverySnapshot>();
  public readonly onDidChange = this.onDidChangeEmitter.event;

  private readonly files = new Map<string, MarkdownFileEntry>();
  private readonly watcherDisposables: vscode.Disposable[] = [];

  constructor(
    private readonly workspaceRoot: vscode.Uri,
    private readonly getExtensions: () => string[],
    private readonly logger?: MarkdownLogger,
  ) {}

  public async start(): Promise<void> {
    this.logger?.info("Discovery start", {
      workspaceRoot: this.workspaceRoot.fsPath,
    });
    await this.refresh();
    this.startWatcher();
  }

  public async refresh(): Promise<void> {
    const extensions = normalizeExtensions(this.getExtensions());
    const includePattern = buildIncludeGlob(extensions);
    const excludePattern = "**/{node_modules,.venv,.git,out}/**";

    this.logger?.info("Discovery refresh begin", {
      workspaceRoot: this.workspaceRoot.fsPath,
      extensions,
      includePattern,
      excludePattern,
    });

    const uris = await vscode.workspace.findFiles(
      new vscode.RelativePattern(this.workspaceRoot, includePattern),
      new vscode.RelativePattern(this.workspaceRoot, excludePattern),
    );

    this.files.clear();
    await Promise.all(
      uris.map(async (uri) => {
        if (containsHardExcludedSegment(uri.fsPath)) {
          return;
        }
        const entry = await this.createEntry(uri.fsPath);
        if (entry) {
          this.files.set(entry.relativePath, entry);
        }
      }),
    );

    this.fireChange();
  }

  public getSnapshot(): DiscoverySnapshot {
    const files = [...this.files.values()].sort((left, right) => {
      if (right.mtimeMs !== left.mtimeMs) {
        return right.mtimeMs - left.mtimeMs;
      }
      return left.relativePath.localeCompare(right.relativePath);
    });

    return {
      files,
      generatedAt: Date.now(),
    };
  }

  public getByRelativePath(
    relativePath: string,
  ): MarkdownFileEntry | undefined {
    return this.files.get(toPosix(relativePath));
  }

  public async resolveRelativePath(
    uri: vscode.Uri,
  ): Promise<string | undefined> {
    const relativePath = this.getWorkspaceRelativePath(uri);
    if (!relativePath) {
      return undefined;
    }

    if (
      !matchesExtension(uri.fsPath, normalizeExtensions(this.getExtensions()))
    ) {
      return undefined;
    }

    if (!this.files.has(relativePath)) {
      const entry = await this.createEntry(uri.fsPath);
      if (!entry) {
        return undefined;
      }
      this.files.set(entry.relativePath, entry);
      this.fireChange();
    }

    return relativePath;
  }

  public getWorkspaceRelativePath(uri: vscode.Uri): string | undefined {
    const rootPath = this.workspaceRoot.fsPath;
    if (!uri.fsPath.startsWith(rootPath)) {
      return undefined;
    }

    const relativePath = toPosix(path.relative(rootPath, uri.fsPath));
    if (!relativePath || relativePath.startsWith("..")) {
      return undefined;
    }

    return relativePath;
  }

  private startWatcher(): void {
    const extensions = normalizeExtensions(this.getExtensions());
    const includePattern = buildIncludeGlob(extensions);
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this.workspaceRoot, includePattern),
      false,
      false,
      false,
    );

    const onAddOrChange = async (uri: vscode.Uri): Promise<void> => {
      if (containsHardExcludedSegment(uri.fsPath)) {
        return;
      }
      if (!matchesExtension(uri.fsPath, extensions)) {
        return;
      }
      const entry = await this.createEntry(uri.fsPath);
      if (!entry) {
        return;
      }
      this.files.set(entry.relativePath, entry);
      this.fireChange();
    };

    const onDelete = (uri: vscode.Uri): void => {
      const relativePath = toPosix(
        path.relative(this.workspaceRoot.fsPath, uri.fsPath),
      );
      if (this.files.delete(relativePath)) {
        this.fireChange();
      }
    };

    this.watcherDisposables.push(
      watcher,
      watcher.onDidCreate(onAddOrChange),
      watcher.onDidChange(onAddOrChange),
      watcher.onDidDelete(onDelete),
    );
  }

  private async createEntry(
    absolutePath: string,
  ): Promise<MarkdownFileEntry | undefined> {
    try {
      if (
        !matchesExtension(
          absolutePath,
          normalizeExtensions(this.getExtensions()),
        )
      ) {
        return undefined;
      }

      const uri = vscode.Uri.file(absolutePath);
      const stat = await vscode.workspace.fs.stat(uri);
      if ((stat.type & vscode.FileType.File) === 0) {
        return undefined;
      }

      const relativePath = this.getWorkspaceRelativePath(uri);
      if (!relativePath) {
        return undefined;
      }

      const metrics = await collectMarkdownMetrics(uri);
      return {
        uri,
        relativePath,
        mtimeMs: stat.mtime,
        size: stat.size,
        headingCount: metrics.headingCount,
        wordCount: metrics.wordCount,
      };
    } catch {
      return undefined;
    }
  }

  private fireChange(): void {
    this.logger?.info("Discovery snapshot emitted", {
      fileCount: this.files.size,
    });
    this.onDidChangeEmitter.fire(this.getSnapshot());
  }

  public dispose(): void {
    this.onDidChangeEmitter.dispose();
    for (const disposable of this.watcherDisposables) {
      disposable.dispose();
    }
  }
}

function buildIncludeGlob(extensions: string[]): string {
  const cleaned = extensions.map((extension) => extension.replace(/^\./, ""));
  return cleaned.length > 1
    ? `**/*.{${cleaned.join(",")}}`
    : `**/*.${cleaned[0] ?? "md"}`;
}

function normalizeExtensions(rawExtensions: string[]): string[] {
  return normalizeMarkdownExtensions(rawExtensions);
}

function matchesExtension(filePath: string, extensions: string[]): boolean {
  return isMarkdownLikeFilePath(filePath, extensions);
}

function containsHardExcludedSegment(candidatePath: string): boolean {
  const segments = toPosix(candidatePath).split("/");
  return segments.some((segment) => HARD_EXCLUDED_SEGMENTS.has(segment));
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

async function collectMarkdownMetrics(
  uri: vscode.Uri,
): Promise<{ headingCount: number; wordCount: number }> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = new TextDecoder("utf-8").decode(bytes);
    const headingCount = (text.match(/^#{1,6}\s+/gm) ?? []).length;
    const wordCount = text
      .split(/\s+/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0).length;
    return {
      headingCount,
      wordCount,
    };
  } catch {
    return {
      headingCount: 0,
      wordCount: 0,
    };
  }
}
