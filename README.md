# Markdown Helpers

Markdown Helpers is a VS Code extension for reading markdown as source material instead of only prose.

It adds three initial capabilities:

- file-path links in markdown source become clickable when they resolve to a workspace or filesystem target
- fenced code blocks can be opened into unsaved editors for focused inspection or execution
- markdown preview is rendered in a dedicated extension panel with a bounded reading width

It also sets markdown editors to bounded wrapping at `96` columns by default through extension configuration defaults, so long lines stay readable without changing file contents.

## Features

### 1) Workspace discovery + preview panel

- Indexes markdown files in the open workspace.
- Watches for create/change/delete events and updates automatically.
- Adds an activity bar view with recent markdown files.
- Opens a dedicated preview panel that renders the selected markdown file as HTML.
- Keeps preview content constrained to a readable max width.

### 2) Clickable path references in markdown source

- Turns path-like references such as `/repo/file.ts:57-75`, `./notes.md`, and `docs/spec.md#L10` into clickable editor links.
- Supports workspace-root paths, document-relative paths, and absolute filesystem paths.
- Opens the file and jumps to the best available line or column.
- Adds hover previews for detected file links, including bounded whole-file previews and referenced line ranges.
- Adds hover previews for folders with clickable child entries, and folder links reveal in the explorer.

### 3) Open fenced code blocks as unsaved files

- Adds code lenses above fenced code blocks in markdown files.
- Adds the `Markdown Helpers: Open Code Block At Cursor` command for the active block.
- Opens the block in a dedicated untitled editor with a best-effort language mode.

## Commands

- `Markdown Helpers: Refresh` (`markdownHelpers.refresh`)
- `Markdown Helpers: Open Markdown Preview` (`markdownHelpers.openMarkdown`)
- `Markdown Helpers: Open Markdown File` (`markdownHelpers.openMarkdownFile`)
- `Markdown Helpers: Copy Markdown Full Path` (`markdownHelpers.copyMarkdownPath`)
- `Markdown Helpers: Reveal Preview` (`markdownHelpers.revealPreview`)
- `Markdown Helpers: Open Code Block At Cursor` (`markdownHelpers.openCodeBlockAtCursor`)
- `Markdown Helpers: Show Output` (`markdownHelpers.showOutput`)

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

Example `settings.json`:

```json
{
  "markdownHelpers.maxRecent": 100,
  "markdownHelpers.previewMaxWidth": 88,
  "markdownHelpers.extensions": [".md", ".markdown", ".mdx", ".qmd"]
}
```

## Development

```bash
pnpm install
pnpm run compile
pnpm run watch
pnpm run dev:host
```

## Extension layout

- `src/extension.ts` - activation, command wiring, provider registration
- `src/discovery.ts` - markdown discovery and watcher logic
- `src/tree.ts` - Recent Markdown activity bar tree
- `src/browserView.ts` - preview panel host and markdown rendering
- `src/editorTools.ts` - document links and fenced code block helpers
- `media/viewer.html` / `media/viewer.js` / `media/viewer.css` - preview UI

## Release Notes

### 0.0.1

- Initial release
- Recent markdown discovery with live preview
- Clickable path references in markdown source
- Fenced code block extraction into untitled editors
- Markdown wrap defaults bounded to 96 columns
