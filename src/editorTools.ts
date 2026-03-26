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
  ["jsx", "javascriptreact"],
  ["py", "python"],
  ["rb", "ruby"],
  ["sh", "shellscript"],
  ["shell", "shellscript"],
  ["ts", "typescript"],
  ["tsx", "typescriptreact"],
  ["yml", "yaml"],
]);

const PATH_TOKEN_RE =
  /(^|[\s([{'"`])((?:file:\/\/\/|~\/|\.\.\/|\.\/|\/)?[A-Za-z0-9_@.~-]+(?:\/[A-Za-z0-9_@.,+=~-]+)+\.[A-Za-z0-9_-]+(?:(?::\d+(?::\d+)?(?:-\d+)?)|(?:#L\d+(?:C\d+)?)|(?:#\S+))?)(?=$|[\s)\]}'"`.,;!?])/gm;

export class MarkdownPathLinkProvider implements vscode.DocumentLinkProvider {
  public async provideDocumentLinks(
    document: vscode.TextDocument,
  ): Promise<vscode.DocumentLink[]> {
    const text = document.getText();
    const links: vscode.DocumentLink[] = [];

    for (const match of text.matchAll(PATH_TOKEN_RE)) {
      const rawValue = match[2];
      if (!rawValue || isLikelyUrl(rawValue)) {
        continue;
      }

      const startOffset = (match.index ?? 0) + match[1].length;
      const endOffset = startOffset + rawValue.length;
      const range = new vscode.Range(
        document.positionAt(startOffset),
        document.positionAt(endOffset),
      );

      const target = await resolveWorkspacePath(rawValue, document.uri);
      if (!target) {
        continue;
      }

      const args = encodeURIComponent(
        JSON.stringify([
          {
            path: target.uri.fsPath,
            line: target.line,
            column: target.column,
          },
        ]),
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

export class MarkdownCodeBlockCodeLensProvider
  implements vscode.CodeLensProvider
{
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses = this.onDidChangeEmitter.event;

  public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    return parseFencedCodeBlocks(document).map((block) => {
      const range = new vscode.Range(block.startLine, 0, block.startLine, 0);
      const title = block.language
        ? `Open ${block.language} block in untitled editor`
        : "Open code block in untitled editor";
      return new vscode.CodeLens(range, {
        command: "markdownHelpers.openCodeBlock",
        title,
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
    if (await pathExists(uri)) {
      return {
        uri,
        line: parsed.line,
        column: parsed.column,
      };
    }
  }

  const candidateUris = buildCandidateUris(parsed.path, contextUri);
  for (const uri of candidateUris) {
    if (await pathExists(uri)) {
      return {
        uri,
        line: parsed.line,
        column: parsed.column,
      };
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

async function pathExists(uri: vscode.Uri): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return (stat.type & vscode.FileType.File) !== 0;
  } catch {
    return false;
  }
}

function parseTarget(
  rawTarget: string,
):
  | { path: string; line?: number; column?: number; anchor?: string }
  | undefined {
  const trimmed = rawTarget.trim().replace(/^`|`$/g, "");
  if (!trimmed) {
    return undefined;
  }

  const hashLineMatch = trimmed.match(/^(.*)#L(\d+)(?:C(\d+))?$/i);
  if (hashLineMatch) {
    return {
      path: hashLineMatch[1],
      line: Number.parseInt(hashLineMatch[2], 10),
      column: hashLineMatch[3]
        ? Number.parseInt(hashLineMatch[3], 10)
        : undefined,
    };
  }

  const colonMatch = trimmed.match(/^(.*?):(\d+)(?::(\d+))?(?:-\d+)?$/);
  if (colonMatch && !colonMatch[1].endsWith("://")) {
    return {
      path: colonMatch[1],
      line: Number.parseInt(colonMatch[2], 10),
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
  const normalized = languageHint?.trim().toLowerCase().split(/\s+/)[0];
  if (!normalized) {
    return "plaintext";
  }
  return LANGUAGE_ALIASES.get(normalized) ?? normalized;
}

function isLikelyUrl(value: string): boolean {
  return /^(https?|mailto):/i.test(value);
}
