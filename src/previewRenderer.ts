import * as vscode from "vscode";
import matter from "gray-matter";
import MarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
import { MarkdownTocItem, RenderedMarkdownDocument } from "./types";

interface RenderMarkdownOptions {
  baseUri?: vscode.Uri;
  resolveImageSource?: (
    src: string,
    baseUri: vscode.Uri,
  ) => Promise<string | undefined>;
}

const IMG_TAG_SRC_RE = /<img\b([^>]*?)\bsrc=(['"])(.*?)\2([^>]*)>/gi;

export async function renderMarkdownDocument(
  text: string,
  options: RenderMarkdownOptions = {},
): Promise<RenderedMarkdownDocument> {
  const parsed = matter(text);
  const toc: MarkdownTocItem[] = [];
  const markdown = createMarkdownRenderer(toc);
  const bodyHtml = await rewriteImageSources(
    markdown.render(parsed.content),
    options,
  );
  const frontMatterHtml = renderFrontMatter(parsed.data);

  return {
    html: `${frontMatterHtml}${bodyHtml}`,
    toc,
  };
}

function createMarkdownRenderer(toc: MarkdownTocItem[]): MarkdownIt {
  const markdown = new MarkdownIt({
    breaks: true,
    html: true,
    linkify: true,
    typographer: true,
  });

  markdown.use(anchor, {
    level: [1, 2, 3, 4, 5, 6],
    slugify: slugifyHeading,
    tabIndex: false,
    permalink: false,
    callback: (token: any, anchorInfo: any) => {
      toc.push({
        id: anchorInfo.slug,
        level: Number.parseInt(token.tag.slice(1), 10),
        text: anchorInfo.title,
      });
    },
  });

  const defaultLinkOpen = (markdown.renderer.rules.link_open ??
    ((
      tokens: any[],
      index: number,
      options: unknown,
      _env: unknown,
      self: {
        renderToken(tokens: unknown, index: number, options: unknown): string;
      },
    ) => self.renderToken(tokens, index, options))) as (
    ...args: any[]
  ) => string;

  markdown.renderer.rules.link_open = (
    tokens: any[],
    index: number,
    options: unknown,
    env: unknown,
    self: {
      renderToken(tokens: unknown, index: number, options: unknown): string;
    },
  ) => {
    const token = tokens[index];
    const href = token.attrGet("href") ?? "";

    if (isExternalLink(href)) {
      token.attrSet("target", "_blank");
      token.attrSet("rel", "noopener noreferrer");
      token.attrJoin("class", "external-link");
      return defaultLinkOpen(tokens, index, options, env, self);
    }

    if (!href || href.startsWith("#")) {
      token.attrJoin("class", "anchor-link");
      return defaultLinkOpen(tokens, index, options, env, self);
    }

    token.attrSet("data-local-href", href);
    token.attrSet("href", "#");
    token.attrSet(
      "data-link-kind",
      isLikelyMarkdownHref(href) ? "markdown" : "file",
    );
    token.attrJoin("class", "preview-link");
    token.attrJoin(
      "class",
      isLikelyMarkdownHref(href) ? "is-markdown-link" : "is-file-link",
    );
    return defaultLinkOpen(tokens, index, options, env, self);
  };

  markdown.renderer.rules.fence = (tokens: any[], index: number) => {
    const token = tokens[index];
    const info = (token.info ?? "").trim();
    const language = info.split(/\s+/)[0] ?? "";
    const className = language
      ? ` class="language-${escapeHtmlAttribute(language)}"`
      : "";
    return `<pre><code${className}>${escapeHtml(token.content)}</code></pre>`;
  };

  return markdown;
}

function renderFrontMatter(data: unknown): string {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return "";
  }

  const entries = Object.entries(data);
  if (entries.length === 0) {
    return "";
  }

  const summary = summarizeFrontMatter(entries.map(([key]) => key));
  const rows = entries
    .map(
      ([key, value]) =>
        `<tr><th scope="row">${escapeHtml(key)}</th><td>${escapeHtml(
          formatFrontMatterValue(value),
        )}</td></tr>`,
    )
    .join("");

  return [
    '<details class="front-matter-card">',
    "<summary>",
    '<span class="front-matter-title">Front matter</span>',
    `<span class="front-matter-summary">${escapeHtml(summary)}</span>`,
    "</summary>",
    '<div class="front-matter-body">',
    `<table><tbody>${rows}</tbody></table>`,
    "</div>",
    "</details>",
  ].join("");
}

function summarizeFrontMatter(keys: string[]): string {
  if (keys.length <= 4) {
    return keys.join(", ");
  }

  const visible = keys.slice(0, 4).join(", ");
  return `${visible} +${keys.length - 4} more`;
}

function formatFrontMatterValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  return JSON.stringify(value);
}

function isExternalLink(href: string): boolean {
  return /^(https?|mailto):/i.test(href);
}

function isLikelyMarkdownHref(href: string): boolean {
  const normalized = href.split(/[?#]/, 1)[0].toLowerCase();
  return (
    !normalized ||
    normalized.endsWith(".md") ||
    normalized.endsWith(".markdown") ||
    normalized.endsWith(".mdx") ||
    normalized.endsWith(".qmd") ||
    normalized.endsWith(".prompt.md") ||
    normalized.endsWith(".instructions.md")
  );
}

function slugifyHeading(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  return slug || "section";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

async function rewriteImageSources(
  html: string,
  options: RenderMarkdownOptions,
): Promise<string> {
  if (!options.baseUri || !options.resolveImageSource) {
    return html;
  }

  const matches = [...html.matchAll(IMG_TAG_SRC_RE)];
  if (matches.length === 0) {
    return html;
  }

  const replacements = await Promise.all(
    matches.map(async (match) => {
      const [, before, quote, source, after] = match;
      const resolvedSource = await options.resolveImageSource!(
        decodeHtmlAttribute(source),
        options.baseUri!,
      );
      if (!resolvedSource) {
        return match[0];
      }

      return `<img${before}src=${quote}${escapeHtmlAttribute(
        resolvedSource,
      )}${quote}${after}>`;
    }),
  );

  let nextIndex = 0;
  let rewritten = "";
  for (const [replacementIndex, match] of matches.entries()) {
    const index = match.index ?? 0;
    rewritten += html.slice(nextIndex, index);
    rewritten += replacements[replacementIndex] ?? match[0];
    nextIndex = index + match[0].length;
  }
  rewritten += html.slice(nextIndex);
  return rewritten;
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
