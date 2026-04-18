# VS Markdown Helpers

## General or common

## Improve code editor features

- When viewing in an editor, give an inline option at top to open in the fancy viewer (in addition to the button in the top toolbar)

## Improve markdown sidebar

## Improve markdown preview

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

- Revise logic around table bleed - ensure we bleed tables out if there is no section TOC visible (user can hide the TOC, tables should expand out if so)
