import { enhanceCodeBlocks } from "./codeBlocks.js";
import { enhanceLocalLinks } from "./localLinks.js";
import { enhanceMermaidBlocks } from "./mermaidBlocks.js";
import { enhanceTables } from "./tables.js";

export async function enhancePreview(container, tools) {
  await Promise.all([
    enhanceLocalLinks(container, tools),
    enhanceTables(container, tools),
    enhanceCodeBlocks(container, tools),
    enhanceMermaidBlocks(container, tools),
  ]);
}
