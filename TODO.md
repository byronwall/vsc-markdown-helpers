# VS Markdown Helpers

## General or common

## Improve code editor features

## Improve markdown sidebar

## Improve markdown preview

- Links to markdown files should render in teh fancy preview - links to code files and other stuff should "jump out" to VS Code again. So if there is a link to a `.py` file in the markdown source, we need a click there to open the file in VS Code instead of rendering in the markdown webvierer.

New

- TOC needs to track the active header as you scroll and indicate it in the TOC with a different color or highlight or something
- Mermaid diagram viewer should also have a button to open the diagram in a new modal to see the full thing if it's really big

New new

- Need to correctly cap the max width on the markdown preview so that it doesn't stretch out to be super wide on large screens - maybe cap it at 800px or something and center it in the middle of the screen? [paste image]
- Code block styles are quite poor - need a nice light mode theme that goes with the viewer styles -- current one has dark background and very difficult to read text in some cases.
- TOC is just busted - clicking does not change the scroll and it does not respond to scroll changes -- add some console logs here so we can debug
- Mermaid modal - make it fill the entire modal space so as much room as possible is given to pan/zoom operations
