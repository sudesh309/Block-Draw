# Changelog

## 0.1.0

First release.

- Canvas editor for block diagrams: titled blocks in eight shapes, connections (elbow, straight or curved, with labels and arrowheads), frames, grid and snapping, undo/redo, copy/paste, align and distribute, keyboard shortcuts, touch and pinch-zoom.
- Links between frames: link a block to a frame, a frame in another drawing, a note or a URL. Ctrl/Cmd+click follows the link and Alt+← goes back. `[[Drawing.blockdraw#Frame]]` opens a drawing at a frame.
- Google Sheets export: one tab per frame with clickable links between tabs, plus index, blocks and connections tabs. Exporting again updates the same spreadsheet. Works through an Apps Script web app you deploy (desktop and mobile) or by signing in with a Google account (desktop).
- Excel (.xlsx), JSON, SVG and PNG exports of the whole drawing or the selected frame.
- `blockdraw` code blocks show a live preview of a drawing, or of one frame, inside a note.
- Follows the light and dark themes. Requires Obsidian 1.5 or later.
