# Changelog

## 0.3.0

- The Excel and Google Sheets exports no longer show internal element ids anywhere (the "ID" column on the Blocks and Connections tabs is gone).
- Each frame's sheet now has a plain-text table beside its grid listing its blocks — Block Title, LinkTo, LinkFrom, Block Description and Notes — so the frame's content reads without the diagram. The Canvas tab (unframed blocks) gets the same table.

## 0.2.0

- Comments: add a note to any block or connector from the properties panel. A badge on the canvas shows it exists; click the badge, the panel's Shown/Hidden toggle, or the right-click menu's Show/Hide comment to expand or collapse it. The open/closed state is saved with the drawing, so an expanded comment stays visible in read-only embeds and in SVG/PNG exports.
- Comments are included in the JSON export (`comment`/`commentOpen` on blocks and connections), as a "Comment" column in the Excel and Google Sheets exports, and as part of the hover note on a frame's grid sheet.

## 0.1.1

- Releases now ship exactly `main.js`, `manifest.json` and `styles.css`, signed with GitHub artifact attestations, and nothing else.
- Removed two unnecessary `!important` rules in the stylesheet.
- No functional changes to the plugin itself.

## 0.1.0

First release.

- Canvas editor for block diagrams: titled blocks in eight shapes, connections (elbow, straight or curved, with labels and arrowheads), frames, grid and snapping, undo/redo, copy/paste, align and distribute, keyboard shortcuts, touch and pinch-zoom.
- Links between frames: link a block to a frame, a frame in another drawing, a note or a URL. Ctrl/Cmd+click follows the link and Alt+← goes back. `[[Drawing.blockdraw#Frame]]` opens a drawing at a frame.
- Google Sheets export: one tab per frame with clickable links between tabs, plus index, blocks and connections tabs. Exporting again updates the same spreadsheet. Works through an Apps Script web app you deploy (desktop and mobile) or by signing in with a Google account (desktop).
- Excel (.xlsx), JSON, SVG and PNG exports of the whole drawing or the selected frame.
- `blockdraw` code blocks show a live preview of a drawing, or of one frame, inside a note.
- Follows the light and dark themes. Requires Obsidian 1.5 or later.
