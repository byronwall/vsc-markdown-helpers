# VS Markdown Helpers

## General or common

## Improve code editor features

- When viewing in an editor, give an inline option at top to open in the fancy viewer (in addition to the button in the top toolbar)

## Improve markdown sidebar

## Improve markdown preview

- [x] Add a fixed top navbar that includes a couple of triggers for useful stuff
  - [x] One of those should open the TOC as a popover on small screens, and as a sidebar on larger screens
  - [x] Another should open a pane that lists all links in teh file - this should include "real" links and any code tick or other things that are being parsed as link
  - [x] Include a popover trigger that opens a "media" view which gives all images as a carousel
  - [x] Move the file picker into that same top nav as a far left option
- [x] Links to internal headings should be clickable in the preview and should scroll to the correct location in the preview

- Need to do some structural refactors to reduce the code size in large JS files.
- Convert over to a proper component system - SolidJS
- Rendered tables need to more aggressively shrink columns to try and fit all content on screen. I see examples where a column has whitespace and requires horizontal scrolling to see neighbors.

- Seems like images render with some extra stuff before them. Looks like the blue link hover thing renders even when the image is not a link? Also renders in teh case where the image is a link. I just want to clik on teh iamge, and not see extra stuff before it.

- Syles
  - Ensure all anchor links have a hover effect which shows a nice large underline - make it modern

- Modals
  - Reduce the height of the header - get all the header bits into a singel line so there is more space for content.
- Ensure consistent padding around the conntent and margin in the viewport, right now it's not right and touches the right and bototm edges of the screen

- Images raise up like they want to open in a modal on click -- make that happen - open teh media carosuel with that image active.

- implement a color picker menu in the top nav bar -- have it open a popover that shows a lsit of theme colors - clicking should change hte theme - persist this somewhere (like user settings) so it is stable -- give around 16 themes with a decent split between dark and light colors.
- implement some basic font controls to make text relatively large or smaller - persist in user settings or somethign when changed -- show this in teh same menu as the color themes.
