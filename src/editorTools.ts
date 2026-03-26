import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { CodeBlockMatch, FileLocationTarget } from "./types";

const LANGUAGE_ALIASES = new Map<string, string>([
  ["bash", "shellscript"],
  ["c++", "cpp"],
  ["cs", "csharp"],
  ["docker", "dockerfile"],
  ["js", "javascript"],
  ["md", "markdown"],
  ["mts", "typescript"],
  ["mjs", "javascript"],
  ["jsx", "javascriptreact"],
  ["py", "python"],
  ["rb", "ruby"],
  ["sh", "shellscript"],
  ["shell", "shellscript"],
  ["ts", "typescript"],
  ["tsx", "typescriptreact"],
  ["cts", "typescript"],
  ["cjs", "javascript"],
  ["yml", "yaml"],
]);

const PATH_TOKEN_RE =
  /(^|[\s([{'"`])((?:file:\/\/\/|~\/|\.\.\/|\.\/|\/)?[A-Za-z0-9_@.~-]+(?:\/[A-Za-z0-9_@.,+=~-]+)+(?:\/)?(?:(?::\d+(?::\d+)?(?:-\d+)?)|(?:#L\d+(?:C\d+)?(?:-L?\d+)?)|(?:#\S+))?)(?=$|[\s)\]}'"`.,;!?])/gm;

const WHOLE_FILE_PREVIEW_LINES = 18;
const REFERENCED_FILE_PREVIEW_LINES = 24;
const MAX_DIRECTORY_PREVIEW_ENTRIES = 20;

interface PathTokenMatch {
  rawValue: string;
  range: vscode.Range;
}

interface PreviewSelection {
  startLine: number;
  endLine: number;
  truncated: boolean;
  note?: string;
}

export class MarkdownPathLinkProvider implements vscode.DocumentLinkProvider {
  public async provideDocumentLinks(
    document: vscode.TextDocument,
  ): Promise<vscode.DocumentLink[]> {
    const links: vscode.DocumentLink[] = [];

    for (const match of getPathTokenMatches(document)) {
      const { rawValue, range } = match;
      const target = await resolveWorkspacePath(rawValue, document.uri);
      if (!target) {
        continue;
      }

      const args = encodeURIComponent(
        JSON.stringify([toCommandTarget(target)]),
      );
      const link = new vscode.DocumentLink(
        range,
        vscode.Uri.parse(`command:markdownHelpers.openLocation?${args}`),
      );
      link.tooltip = formatLinkTooltip(target);
      links.push(link);
    }

    return links;
  }
}

export class MarkdownPathHoverProvider implements vscode.HoverProvider {
  public async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Hover | undefined> {
    const match = getPathTokenMatches(document).find((candidate) =>
      candidate.range.contains(position),
    );
    if (!match) {
      return undefined;
    }

    const target = await resolveWorkspacePath(match.rawValue, document.uri);
    if (!target) {
      return undefined;
    }

    const contents = await buildHoverContents(target);
    if (contents.length === 0) {
      return undefined;
    }

    return new vscode.Hover(contents, match.range);
  }
}

export class MarkdownCodeBlockCodeLensProvider
  implements vscode.CodeLensProvider
{
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses = this.onDidChangeEmitter.event;

  public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    return parseFencedCodeBlocks(document).map((block) => {
      const range = new vscode.Range(block.startLine, 0, block.startLine, 0);
      return new vscode.CodeLens(range, {
        command: "markdownHelpers.openCodeBlock",
        title: "$(code)",
        arguments: [document.uri, block.startLine],
      });
    });
  }

  public refresh(): void {
    this.onDidChangeEmitter.fire();
  }

  public dispose(): void {
    this.onDidChangeEmitter.dispose();
  }
}

export function parseFencedCodeBlocks(
  document: vscode.TextDocument,
): CodeBlockMatch[] {
  const blocks: CodeBlockMatch[] = [];
  let current:
    | { fence: string; language: string | undefined; startLine: number }
    | undefined;

  for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex += 1) {
    const text = document.lineAt(lineIndex).text;
    const openerMatch = text.match(/^(`{3,}|~{3,})\s*([^\s`~]+)?.*$/);

    if (!current && openerMatch) {
      current = {
        fence: openerMatch[1],
        language: openerMatch[2]?.trim(),
        startLine: lineIndex,
      };
      continue;
    }

    if (!current) {
      continue;
    }

    const closingPattern = new RegExp(`^${escapeFence(current.fence)}\\s*$`);
    if (!closingPattern.test(text)) {
      continue;
    }

    const contentLines: string[] = [];
    for (
      let contentLine = current.startLine + 1;
      contentLine < lineIndex;
      contentLine += 1
    ) {
      contentLines.push(document.lineAt(contentLine).text);
    }

    blocks.push({
      language: current.language,
      content: contentLines.join("\n"),
      startLine: current.startLine,
      endLine: lineIndex,
    });
    current = undefined;
  }

  return blocks;
}

export async function openCodeBlockAtLine(
  document: vscode.TextDocument,
  line: number,
): Promise<boolean> {
  const block = parseFencedCodeBlocks(document).find(
    (candidate) => line >= candidate.startLine && line <= candidate.endLine,
  );

  if (!block) {
    return false;
  }

  await openUntitledCodeDocument(block.content, block.language, document.uri);
  return true;
}

export async function openUntitledCodeDocument(
  content: string,
  languageHint?: string,
  sourceUri?: vscode.Uri,
): Promise<void> {
  const language = normalizeLanguageId(languageHint);
  const document = await vscode.workspace.openTextDocument({
    language,
    content,
  });
  await vscode.window.showTextDocument(document, {
    preview: false,
  });

  if (sourceUri) {
    vscode.window.setStatusBarMessage(
      `Opened code block from ${path.basename(sourceUri.fsPath)}`,
      2500,
    );
  }
}

export async function resolveWorkspacePath(
  rawTarget: string,
  contextUri?: vscode.Uri,
): Promise<FileLocationTarget | undefined> {
  const parsed = parseTarget(rawTarget);
  if (!parsed) {
    return undefined;
  }

  if (parsed.anchor && !parsed.path) {
    return undefined;
  }

  if (parsed.path.startsWith("file:///")) {
    const uri = vscode.Uri.parse(parsed.path);
    const stat = await statPath(uri);
    if (stat) {
      return toResolvedTarget(uri, parsed, stat.type);
    }
  }

  const candidateUris = buildCandidateUris(parsed.path, contextUri);
  for (const uri of candidateUris) {
    const stat = await statPath(uri);
    if (stat) {
      return toResolvedTarget(uri, parsed, stat.type);
    }
  }

  return undefined;
}

function buildCandidateUris(
  rawPath: string,
  contextUri?: vscode.Uri,
): vscode.Uri[] {
  const normalizedPath = expandHome(rawPath);
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  const candidates = new Map<string, vscode.Uri>();

  if (path.isAbsolute(normalizedPath)) {
    const absoluteUri = vscode.Uri.file(normalizedPath);
    candidates.set(absoluteUri.fsPath, absoluteUri);

    const workspaceRelative = normalizedPath.replace(/^\/+/, "");
    for (const folder of workspaceFolders) {
      const rootedUri = vscode.Uri.file(
        path.join(folder.uri.fsPath, workspaceRelative),
      );
      candidates.set(rootedUri.fsPath, rootedUri);
    }
  } else {
    if (contextUri?.scheme === "file") {
      const relativeUri = vscode.Uri.file(
        path.resolve(path.dirname(contextUri.fsPath), normalizedPath),
      );
      candidates.set(relativeUri.fsPath, relativeUri);
    }

    for (const folder of workspaceFolders) {
      const rootedUri = vscode.Uri.file(
        path.join(folder.uri.fsPath, normalizedPath),
      );
      candidates.set(rootedUri.fsPath, rootedUri);
    }
  }

  return [...candidates.values()];
}

async function statPath(uri: vscode.Uri): Promise<vscode.FileStat | undefined> {
  try {
    return await vscode.workspace.fs.stat(uri);
  } catch {
    return undefined;
  }
}

function parseTarget(rawTarget: string):
  | {
      path: string;
      line?: number;
      endLine?: number;
      column?: number;
      anchor?: string;
    }
  | undefined {
  const trimmed = rawTarget.trim().replace(/^`|`$/g, "");
  if (!trimmed) {
    return undefined;
  }

  const hashLineMatch = trimmed.match(/^(.*)#L(\d+)(?:C(\d+))?(?:-L?(\d+))?$/i);
  if (hashLineMatch) {
    return {
      path: hashLineMatch[1],
      line: Number.parseInt(hashLineMatch[2], 10),
      endLine: hashLineMatch[4]
        ? Number.parseInt(hashLineMatch[4], 10)
        : undefined,
      column: hashLineMatch[3]
        ? Number.parseInt(hashLineMatch[3], 10)
        : undefined,
    };
  }

  const colonMatch = trimmed.match(/^(.*?):(\d+)(?::(\d+))?(?:-(\d+))?$/);
  if (colonMatch && !colonMatch[1].endsWith("://")) {
    return {
      path: colonMatch[1],
      line: Number.parseInt(colonMatch[2], 10),
      endLine: colonMatch[4] ? Number.parseInt(colonMatch[4], 10) : undefined,
      column: colonMatch[3] ? Number.parseInt(colonMatch[3], 10) : undefined,
    };
  }

  const anchorIndex = trimmed.indexOf("#");
  if (anchorIndex > 0) {
    return {
      path: trimmed.slice(0, anchorIndex),
      anchor: trimmed.slice(anchorIndex + 1),
    };
  }

  return {
    path: trimmed,
  };
}

function escapeFence(fence: string): string {
  return fence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatLinkTooltip(target: FileLocationTarget): string {
  if (target.kind === "directory") {
    return `Reveal ${target.uri.fsPath} in explorer`;
  }
  if (target.line && target.endLine && target.line !== target.endLine) {
    return `Open ${target.uri.fsPath}:${target.line}-${target.endLine}`;
  }
  if (target.line && target.column) {
    return `Open ${target.uri.fsPath}:${target.line}:${target.column}`;
  }
  if (target.line) {
    return `Open ${target.uri.fsPath}:${target.line}`;
  }
  return `Open ${target.uri.fsPath}`;
}

function expandHome(candidatePath: string): string {
  if (!candidatePath.startsWith("~/")) {
    return candidatePath;
  }
  return path.join(os.homedir(), candidatePath.slice(2));
}

function normalizeLanguageId(languageHint?: string): string {
  const normalized = languageHint
    ?.trim()
    .toLowerCase()
    .replace(/^\./, "")
    .split(/\s+/)[0];
  if (!normalized) {
    return "plaintext";
  }
  return LANGUAGE_ALIASES.get(normalized) ?? normalized;
}

function isLikelyUrl(value: string): boolean {
  return /^(https?|mailto):/i.test(value);
}

function getPathTokenMatches(document: vscode.TextDocument): PathTokenMatch[] {
  const text = document.getText();
  const matches: PathTokenMatch[] = [];

  for (const match of text.matchAll(PATH_TOKEN_RE)) {
    const rawValue = match[2];
    if (!rawValue || isLikelyUrl(rawValue)) {
      continue;
    }

    const startOffset = (match.index ?? 0) + match[1].length;
    const endOffset = startOffset + rawValue.length;
    matches.push({
      rawValue,
      range: new vscode.Range(
        document.positionAt(startOffset),
        document.positionAt(endOffset),
      ),
    });
  }

  return matches;
}

function toResolvedTarget(
  uri: vscode.Uri,
  parsed: {
    path: string;
    line?: number;
    endLine?: number;
    column?: number;
    anchor?: string;
  },
  fileType: vscode.FileType,
): FileLocationTarget | undefined {
  const kind = getTargetKind(fileType);
  if (!kind) {
    return undefined;
  }

  if (kind === "directory") {
    return {
      uri,
      kind,
    };
  }

  return {
    uri,
    kind,
    line: parsed.line,
    endLine: parsed.endLine,
    column: parsed.column,
  };
}

function getTargetKind(
  fileType: vscode.FileType,
): FileLocationTarget["kind"] | undefined {
  if ((fileType & vscode.FileType.Directory) !== 0) {
    return "directory";
  }
  if ((fileType & vscode.FileType.File) !== 0) {
    return "file";
  }
  return undefined;
}

async function buildHoverContents(
  target: FileLocationTarget,
): Promise<vscode.MarkdownString[]> {
  if (target.kind === "file") {
    return buildFileHoverContents(target);
  }

  const summary = createTrustedMarkdown();
  summary.appendMarkdown(
    `**Folder:** [${escapeMarkdownLabel(getDisplayPath(target.uri))}](${createOpenLocationCommandUri(target)})`,
  );

  const details = await createDirectoryHoverDetails(target);
  return details ? [summary, details] : [summary];
}

async function buildFileHoverContents(
  target: FileLocationTarget,
): Promise<vscode.MarkdownString[]> {
  try {
    const document = await vscode.workspace.openTextDocument(target.uri);
    const preview = selectPreviewRange(document, target);
    const summary = createTrustedMarkdown();

    if (preview.note) {
      summary.appendMarkdown(
        `Warning: ${escapeMarkdownLabel(preview.note)}\n\n`,
      );
    }

    summary.appendMarkdown(
      `**File:** [${escapeMarkdownLabel(getDisplayPath(target.uri))}](${createOpenLocationCommandUri(target)})`,
    );

    const location = formatHoverLocation(target, preview);
    if (location) {
      summary.appendMarkdown(`  \n_${location}_`);
    }

    const details = createFileHoverDetails(document, target, preview);
    return details ? [summary, details] : [summary];
  } catch (error) {
    const summary = createTrustedMarkdown();
    summary.appendMarkdown(
      `**File:** [${escapeMarkdownLabel(getDisplayPath(target.uri))}](${createOpenLocationCommandUri(target)})`,
    );

    const details = new vscode.MarkdownString();
    const message = error instanceof Error ? error.message : String(error);
    details.appendMarkdown(
      `_Preview unavailable: ${escapeMarkdownLabel(message)}_`,
    );
    return [summary, details];
  }
}

function createFileHoverDetails(
  document: vscode.TextDocument,
  target: FileLocationTarget,
  preview: PreviewSelection,
): vscode.MarkdownString | undefined {
  if (document.lineCount === 0) {
    const empty = new vscode.MarkdownString();
    empty.appendMarkdown("_Empty file._");
    return empty;
  }

  const lines: string[] = [];
  for (
    let lineIndex = preview.startLine;
    lineIndex <= preview.endLine;
    lineIndex += 1
  ) {
    lines.push(document.lineAt(lineIndex).text);
  }

  const details = new vscode.MarkdownString();
  details.appendCodeblock(lines.join("\n"), getLanguageIdForUri(target.uri));

  if (preview.truncated) {
    const remaining = document.lineCount - (preview.endLine + 1);
    details.appendMarkdown(
      `\n\n_Showing ${preview.endLine - preview.startLine + 1} lines.${remaining > 0 ? ` ${remaining} more lines not shown.` : ""}_`,
    );
  } else if (
    target.line === undefined &&
    document.lineCount > preview.endLine + 1
  ) {
    details.appendMarkdown(
      `\n\n_Showing first ${preview.endLine - preview.startLine + 1} lines of ${document.lineCount}._`,
    );
  }

  return details;
}

async function createDirectoryHoverDetails(
  target: FileLocationTarget,
): Promise<vscode.MarkdownString> {
  const details = createTrustedMarkdown();

  try {
    const entries = await vscode.workspace.fs.readDirectory(target.uri);
    const sortedEntries = [...entries].sort(compareDirectoryEntries);
    const visibleEntries = sortedEntries.slice(
      0,
      MAX_DIRECTORY_PREVIEW_ENTRIES,
    );

    if (visibleEntries.length === 0) {
      details.appendMarkdown("_Folder is empty._");
      return details;
    }

    details.appendMarkdown("**Entries**\n\n");
    for (const [name, fileType] of visibleEntries) {
      const childUri = vscode.Uri.joinPath(target.uri, name);
      const isDirectory = (fileType & vscode.FileType.Directory) !== 0;
      const childTarget: FileLocationTarget = {
        uri: childUri,
        kind: isDirectory ? "directory" : "file",
      };
      const label = isDirectory ? `${name}/` : name;
      details.appendMarkdown(
        `- [${escapeMarkdownLabel(label)}](${createOpenLocationCommandUri(childTarget)})\n`,
      );
    }

    if (sortedEntries.length > visibleEntries.length) {
      details.appendMarkdown(
        `\n_Showing first ${visibleEntries.length} of ${sortedEntries.length} entries._`,
      );
    }

    return details;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    details.appendMarkdown(
      `_Folder preview unavailable: ${escapeMarkdownLabel(message)}_`,
    );
    return details;
  }
}

function createTrustedMarkdown(): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString();
  markdown.isTrusted = { enabledCommands: ["markdownHelpers.openLocation"] };
  return markdown;
}

function createOpenLocationCommandUri(target: FileLocationTarget): vscode.Uri {
  const args = encodeURIComponent(JSON.stringify([toCommandTarget(target)]));
  return vscode.Uri.parse(`command:markdownHelpers.openLocation?${args}`);
}

function toCommandTarget(target: FileLocationTarget): {
  path: string;
  line?: number;
  endLine?: number;
  column?: number;
} {
  return {
    path: target.uri.fsPath,
    line: target.line,
    endLine: target.endLine,
    column: target.column,
  };
}

function getDisplayPath(uri: vscode.Uri): string {
  const relativePath = vscode.workspace.asRelativePath(uri, false);
  return relativePath || uri.fsPath;
}

function formatHoverLocation(
  target: FileLocationTarget,
  preview?: PreviewSelection,
): string | undefined {
  const displayStartLine = preview ? preview.startLine + 1 : target.line;
  const displayEndLine = preview ? preview.endLine + 1 : target.endLine;

  if (
    typeof displayStartLine === "number" &&
    typeof displayEndLine === "number" &&
    displayStartLine !== displayEndLine
  ) {
    return `Showing lines ${displayStartLine}-${displayEndLine}`;
  }
  if (typeof displayStartLine === "number" && target.column) {
    return `Showing line ${displayStartLine}, column ${target.column}`;
  }
  if (typeof displayStartLine === "number") {
    return `Showing line ${displayStartLine}`;
  }
  return undefined;
}

function selectPreviewRange(
  document: vscode.TextDocument,
  target: FileLocationTarget,
): PreviewSelection {
  if (document.lineCount === 0) {
    return {
      startLine: 0,
      endLine: 0,
      truncated: false,
      note:
        typeof target.line === "number"
          ? formatMissingLineNote(target, 0, 0)
          : undefined,
    };
  }

  if (typeof target.line !== "number") {
    const endLine = Math.min(document.lineCount, WHOLE_FILE_PREVIEW_LINES) - 1;
    return {
      startLine: 0,
      endLine,
      truncated: document.lineCount > WHOLE_FILE_PREVIEW_LINES,
    };
  }

  const requestedStartLine = Math.floor(target.line);
  const requestedEndLineNumber = Math.floor(
    Math.max(target.endLine ?? target.line, target.line),
  );
  const startLine = clampLineIndex(requestedStartLine, document.lineCount);
  const requestedEndLine = clampLineIndex(
    requestedEndLineNumber,
    document.lineCount,
  );
  const maxEndLine = Math.min(
    requestedEndLine,
    startLine + REFERENCED_FILE_PREVIEW_LINES - 1,
  );
  const note =
    requestedStartLine !== startLine + 1 ||
    requestedEndLineNumber !== requestedEndLine + 1
      ? formatMissingLineNote(target, startLine + 1, requestedEndLine + 1)
      : undefined;

  return {
    startLine,
    endLine: maxEndLine,
    truncated: requestedEndLine > maxEndLine,
    note,
  };
}

function clampLineIndex(lineNumber: number, lineCount: number): number {
  return Math.min(Math.max(Math.floor(lineNumber) - 1, 0), lineCount - 1);
}

function getLanguageIdForUri(uri: vscode.Uri): string {
  const extension = path.extname(uri.fsPath).replace(/^\./, "");
  return normalizeLanguageId(extension || "plaintext");
}

function compareDirectoryEntries(
  left: [string, vscode.FileType],
  right: [string, vscode.FileType],
): number {
  const leftIsDirectory = (left[1] & vscode.FileType.Directory) !== 0;
  const rightIsDirectory = (right[1] & vscode.FileType.Directory) !== 0;

  if (leftIsDirectory !== rightIsDirectory) {
    return leftIsDirectory ? -1 : 1;
  }

  return left[0].localeCompare(right[0]);
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/([\\\[\]()])/g, "\\$1");
}

function formatMissingLineNote(
  target: FileLocationTarget,
  closestStartLine: number,
  closestEndLine: number,
): string {
  if (typeof target.line !== "number") {
    return "Referenced line could not be resolved.";
  }

  if (closestStartLine <= 0 || closestEndLine <= 0) {
    return typeof target.endLine === "number" && target.endLine !== target.line
      ? `Requested lines ${target.line}-${target.endLine} are outside this file; the file is empty.`
      : `Requested line ${target.line} is outside this file; the file is empty.`;
  }

  if (typeof target.endLine === "number" && target.endLine !== target.line) {
    return `Requested lines ${target.line}-${target.endLine} are outside this file; showing closest available lines ${closestStartLine}-${closestEndLine}.`;
  }

  return `Requested line ${target.line} is outside this file; showing closest available line ${closestStartLine}.`;
}
