# Markdown Helpers

Markdown Helpers is a VS Code extension for treating markdown as working source material instead of only static prose.

It combines workspace discovery, a dedicated preview panel, editor-side path intelligence, fenced code block extraction, and readable wrapping defaults into one workflow. The extension is designed for markdown-heavy repos where documents contain file references, runnable snippets, diagrams, and operational notes that need to stay connected to the rest of the workspace.

Out of the box it provides:

- live discovery of markdown files across the workspace, including markdown-like extensions you configure
- a dedicated preview panel with a file picker, outline, bounded reading width, and richer interactions than the built-in preview
- clickable local file and folder references in markdown source and preview, including line, column, and range targets
- hover previews for resolved file and folder links in the editor and preview
- fenced code block actions that open snippets into untitled editors for inspection or execution
- preview enhancements for code blocks, tables, Mermaid diagrams, front matter, and local path tokens inside rendered content
- default bounded wrapping for markdown editors at `96` columns without rewriting file contents

Source-side helpers apply to markdown-like files by configured suffix as well, so files such as `.prompt.md` and `.instructions.md` are supported even when VS Code does not assign them the `markdown` language mode.

## Features

### 1) Workspace discovery and recent markdown browser

- Indexes markdown files in the open workspace using the configured markdown extensions.
- Watches for create, change, and delete events so the file list stays current without manual rescans.
- Excludes common heavy or generated directories such as `node_modules`, `.git`, `.venv`, and `out`.
- Adds a dedicated activity bar container with a `Recent Markdown` tree.
- Sorts recent files by modification time and shows metadata such as heading count, word count, size, and last update time.
- Supports inline tree actions to open a markdown file or copy its full filesystem path.
- Supports a refresh action from the tree title bar.
- Can filter the recent-files tree to either all discovered markdown files or only markdown files changed relative to a configured git base ref.
- The changed-files mode includes branch diff results plus local staged, unstaged, and untracked markdown changes.
- When a pull request context is available, the comparison target can follow that PR base automatically.

### 2) Dedicated markdown preview panel

- Opens rendered markdown in a dedicated extension panel instead of replacing the source editor.
- Includes a workspace file picker inside the panel with client-side filtering by name or path.
- Includes a refresh action in the panel and an `Open text file` action to jump back to the source document.
- Keeps preview content constrained to a readable width using the `markdownHelpers.previewMaxWidth` setting.
- Builds a live outline from headings and keeps the active section synchronized as you scroll.
- Renders YAML front matter into a collapsible summary card instead of leaving it as raw fence content.
- Preserves standard markdown rendering while classifying local workspace links separately from external URLs.
- Resolves local markdown links, file links, and folder links relative to the current document before opening them.
- Opens markdown targets back inside the dedicated preview when appropriate, while still allowing jumps into the text editor for precise locations.
- Reveals folder targets in the Explorer when a link resolves to a directory.
- Requests host-side hover previews for local links, so preview interactions stay consistent with editor hovers.
- Detects raw path tokens in rendered text and turns them into interactive local links even when they were not written as markdown links.

### 3) Rich preview treatment for code blocks, tables, and diagrams

- Adds syntax highlighting to rendered code blocks.
- Wraps code blocks in a preview card with language and line-count metadata.
- Collapses long code blocks by default and lets you expand or collapse them in place.
- Adds actions to copy a code block, open a larger modal view, or open the block into an untitled editor.
- Treats Mermaid fences as rendered diagrams rather than plain source code.
- Supports Mermaid source toggling, copy actions, and opening Mermaid source into an untitled editor.
- Opens Mermaid diagrams into an immersive modal with pan and zoom controls for large diagrams.
- Wraps rendered tables in a scrollable frame with a table tools action.
- Table tools support row filtering, sortable columns, show-all and hide-all column controls, fit-columns behavior, and manual column resizing.

### 4) Clickable path references in markdown source

- Detects local targets from inline markdown links, reference-style link definitions, and raw path tokens written directly in the document.
- Supports workspace-relative paths, document-relative paths, absolute filesystem paths, home-directory paths such as `~/notes.md`, and `file:///` URIs.
- Supports line, column, and range suffixes such as `docs/spec.md:14`, `src/file.ts:10:5`, and `README.md#L12-L18`.
- Supports anchor-style markdown targets and resolves common markdown-friendly forms such as extensionless paths and README fallbacks where possible.
- Opens files at the best matching line, column, or line range.
- Reveals directories in the Explorer when the target is a folder.
- Adds hover previews for resolved file targets, including bounded content previews and referenced line ranges when available.
- Adds hover previews for directories with clickable child entries.

### 5) Fenced code block extraction in the editor

- Adds code lenses above fenced code blocks in markdown-like documents.
- Provides the `Markdown Helpers: Open Code Block At Cursor` command for the fenced block under the active cursor.
- Opens the extracted block into a dedicated untitled editor.
- Applies a best-effort language mode from the fence info string, with sensible alias normalization before falling back to plaintext.
- Works consistently across editor commands, code lenses, and preview-side `Open code block` actions.

### 6) Markdown-like file support and editor defaults

- Applies document links, hovers, and code lenses to configured markdown extensions rather than only documents already in markdown language mode.
- Defaults markdown editors to bounded wrapping with `editor.wordWrap = bounded` and `editor.wordWrapColumn = 96`.
- Keeps wrap-width behavior non-destructive by using editor configuration and preview layout instead of mutating document text.

## Commands

- `Markdown Helpers: Refresh` (`markdownHelpers.refresh`)
- `Markdown Helpers: Open Markdown Preview` (`markdownHelpers.openMarkdown`)
- `Markdown Helpers: Open Markdown File` (`markdownHelpers.openMarkdownFile`)
- `Markdown Helpers: Copy Markdown Full Path` (`markdownHelpers.copyMarkdownPath`)
- `Markdown Helpers: Reveal Preview` (`markdownHelpers.revealPreview`)
- `Markdown Helpers: Open Code Block At Cursor` (`markdownHelpers.openCodeBlockAtCursor`)
- `Markdown Helpers: Show Output` (`markdownHelpers.showOutput`)

Additional inline actions are exposed through the Recent Markdown tree, editor code lenses, editor title button, and preview UI. The recent-files filter toggle is available from the tree title area.

## Settings

### `markdownHelpers.maxRecent`

- Type: `number`
- Default: `60`

### `markdownHelpers.extensions`

- Type: `string[]`
- Default: `[".md", ".markdown", ".mdx"]`

### `markdownHelpers.previewMaxWidth`

- Type: `number`
- Default: `96`

### `markdownHelpers.recentFilesFilter`

- Type: `"all" | "changedSinceBase"`
- Default: `"all"`

### `markdownHelpers.recentFilesBaseRef`

- Type: `string`
- Default: `"main"`

Example `settings.json`:

```json
{
  "markdownHelpers.maxRecent": 100,
  "markdownHelpers.previewMaxWidth": 88,
  "markdownHelpers.extensions": [".md", ".markdown", ".mdx", ".qmd"],
  "markdownHelpers.recentFilesFilter": "changedSinceBase",
  "markdownHelpers.recentFilesBaseRef": "origin/main"
}
```

## Development

```bash
pnpm install
pnpm run compile
pnpm run watch
pnpm run dev:host
```

## Publishing

```bash
pnpm install
pnpm run package:vsix
```

For Marketplace publishing:

1. Create or verify the `byronwall` publisher in the Visual Studio Marketplace.
2. Run `vsce login byronwall` with a PAT that has `Marketplace (Manage)` scope.
3. Publish with either `pnpm run publish:patch`, `pnpm run publish:minor`, or upload the generated VSIX manually.

The repository now includes the standard Marketplace presentation files: `README.md`, `CHANGELOG.md`, `SUPPORT.md`, and a packaged PNG icon.

## Extension layout

- `src/extension.ts` - activation, command wiring, provider registration
- `src/discovery.ts` - markdown discovery and watcher logic
- `src/tree.ts` - Recent Markdown activity bar tree
- `src/browserView.ts` - preview panel host and markdown rendering
- `src/editorTools.ts` - document links and fenced code block helpers
- `media/viewer.html` - preview HTML template
- `media/src/` - preview source JS and CSS
- `media/dist/` - generated preview bundles

## Release Notes

See `CHANGELOG.md` for versioned release notes.
