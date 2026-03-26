# VS Markdown Helpers

## General or common

- Detect additional files as `md` including `.prompt.md` and `.instructions.md` and any other of the AI/agent files that end in `.md`. Right now these files do not trigger the special features

## Improve code editor features

- Change the order of icons so that my markdown preview shows up before all other buttons - I want it to always be available instead of hiding in the `...` menu

## Improve markdown sidebar

- Add an option to filter to markdown files associated with the current PR or branch against main -- basically a short list of "high relevant files"

## Improve markdown preview

- Collapse the file list as the screen gets small
- TOC should render as a sticky thing on the right side - indicate the active header while scrolling
  - TOC should include tree style lines connecting children to parents
- Links to markdown files should render in teh fancy preview - links to code files and other stuff should "jump out" to VS Code again
- It'd be nice if the title of the tab matched the file being viewed
- Render the YAML front matter as a small table of the key value pairs -- allow it to be collapsed by default and expand to visible -- when collapsed, give a terse summary of the keys that are defined, limit to 1 line displayed
- Tables do not render correctly, I see raw markdown text instead
- Render mermaid diagrams when detected in a code block. Use all the features from this repo on that front: `/Users/byronwall/repos/git-visual-files`
- do someting to get good syntax highlighting in the blocks - needs ot be language aware
- Cap the recent file list to like 100 items -- show the initial path to the file in a compact single line text block below the file `time - heading - word` line
- Prevent horizontal overflow with really long lines. Force them to break somewhere
- Need to treat line breaks as new lines - I see bunched lines in the output
