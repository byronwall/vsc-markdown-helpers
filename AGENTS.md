# Copilot Instructions for vsc-md-helpers

## Big picture architecture

- This is a VS Code extension with a split runtime:
  - Extension host in `src/` for discovery, commands, document links, code block helpers, and preview panel hosting.
  - Webview client in `media/` for rendered markdown preview, navigation, and preview-side code block actions.
- Main flow:
  1. `src/extension.ts` wires services, commands, providers, and configuration.
  2. `src/discovery.ts` indexes markdown files and emits snapshot updates.
  3. `src/browserView.ts` renders markdown to HTML, hosts the preview panel, and bridges webview actions back to VS Code.
  4. `src/editorTools.ts` handles file-path links in code view and fenced code block extraction.

## Critical workflows

- Install deps: `pnpm install`
- Validate extension code: `pnpm run compile`
- Dev loop: `pnpm run watch` and `pnpm run dev:host`
- Package/install locally: `pnpm run build:install`

## Project-specific patterns

- Treat markdown path references aggressively: if a path token resolves cleanly against the current file or workspace root, turn it into a link.
- Keep the wrap-width behavior non-destructive: use editor defaults and preview CSS rather than mutating document text.
- Keep preview HTML generation in the extension host so the webview stays lightweight and deterministic.
- Use `MarkdownLogger` for structured host logging instead of ad-hoc `console.log` calls.

## Webview editing conventions

- `media/viewer.css` is only an import hub.
- Put tokens in `media/viewer.tokens.css`, layout in `media/viewer.layout.css`, and UI pieces in `media/viewer.components.css`.
- Do not hand-edit generated webview bundles like `media/viewer.bundle.css` or `media/viewer.bundle.js`; update source files and regenerate them with the project build command.
- Preserve the webview template placeholders `{{CSP}}`, `{{STYLE_URI}}`, and `{{SCRIPT_URI}}`.

## Integration points to keep stable

- Commands and IDs are defined in `package.json` and implemented in `src/extension.ts`; keep them aligned.
- Webview message `type` values are the contract between `src/browserView.ts` and `media/viewer.js`.
- Fenced code block parsing is shared behavior for code lenses, editor commands, and preview actions; keep it consistent.
