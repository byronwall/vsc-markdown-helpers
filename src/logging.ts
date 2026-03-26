import * as vscode from "vscode";

export class MarkdownLogger implements vscode.Disposable {
  private readonly channel: vscode.OutputChannel;

  constructor() {
    this.channel = vscode.window.createOutputChannel("Markdown Helpers");
  }

  public info(message: string, meta?: unknown): void {
    this.write("INFO", message, meta);
  }

  public warn(message: string, meta?: unknown): void {
    this.write("WARN", message, meta);
  }

  public error(message: string, meta?: unknown): void {
    this.write("ERROR", message, meta);
  }

  public show(preserveFocus = false): void {
    this.channel.show(preserveFocus);
  }

  public dispose(): void {
    this.channel.dispose();
  }

  private write(
    level: "INFO" | "WARN" | "ERROR",
    message: string,
    meta?: unknown,
  ): void {
    const stamp = new Date().toISOString();
    this.channel.appendLine(`[${stamp}] [${level}] ${message}`);
    if (meta !== undefined) {
      try {
        const serialized =
          typeof meta === "string" ? meta : JSON.stringify(meta, null, 2);
        this.channel.appendLine(serialized);
      } catch {
        this.channel.appendLine(String(meta));
      }
    }
  }
}
