# Changelog

## 0.6.0

- **Bend a link.** Select a link and drag one of the small dots on it: the link now passes through the point where you drop it. Add as many bends as you need, drag a filled dot to move a bend, double-click it to remove it, or press **Reset route** (in the panel or the right-click menu) to let the line find its own way again. Elbow links keep their right angles, curved links stay smooth, and the bends move and copy together with the blocks. Each change is one undo step. Double-clicking the middle of a link still edits its label.
- **Bring to front and Send to back work across blocks and links.** They used to reorder blocks only among blocks and links only among links, and every link stayed above every block, so a label block sitting on a line could not be brought in front of it, and a link could not be sent behind a block. Now **Bring to front** puts a block above the links, and **Send to back** puts a link behind the blocks (and the other way round). Nothing changes in drawings that do not use them: links are still above blocks, so a container block never hides the links inside it.
- The new bends and layers are saved in the drawing file (`waypoints` on links, `behind` on links, `inFront` on blocks; see [docs/FORMAT.md](docs/FORMAT.md)) and are drawn in PNG and SVG exports, embedded drawings and presentations. They are written only when used, so drawings that do not use them are saved exactly as before, and older versions of Block Draw open the new files (without the bends and layers). Excel and Google Sheets exports lay links out on a grid and ignore them.

## 0.5.0

What you may notice:

- **Secrets stay on your device.** The Apps Script secret and the OAuth client secret are no longer saved in the plugin's settings file (`data.json`), which syncs with your vault. On the first start of 0.5.0 they move into Obsidian's secret storage on that device (this vault's local storage before Obsidian 1.11.4), where the Google sign-in already was. On your other devices, enter them once in **Settings → Block Draw → Google Sheets**; a device that still finds them in its copy of `data.json` moves them the same way.
- **Links open safely.** A block's link to a web page or an email address opens as before. An `obsidian://` link now asks first and shows where it goes, and other kinds of links (such as `file://`) are no longer opened, because a drawing can come from someone else. Links are kept in the file as written.
- **A checked Apps Script address.** The web app address must start with `https://`, and an address outside `script.google.com` is used only after you confirm it.
- **The settings file keeps only what you changed**, so a default that improves in a later release reaches you even if you saved your settings before.
- **Ctrl/Cmd+Enter follows the selected block's link.** It was meant to, but never worked.
- The keyboard shortcuts list (press **?**) is grouped by task and lists every shortcut.
- The structured JSON export is much faster on large drawings: it slowed down sharply beyond a few thousand blocks.
- The description of **Blocks outside frames** says the tab is called Unframed.

Inside (drawings and exports are unchanged):

- The file format and every export are locked by golden files, and [docs/FORMAT.md](docs/FORMAT.md) lists every field with the release that added it.
- Shapes, keyboard shortcuts, settings and exports are each one table with one row per item. Menus, the help panel, the settings tab, tooltips and the docs are built from the rows.
- Every network request goes through one gateway that allows only https, and only to the hosts the features declare (a setting's hosts only while it is on).
- The editor's largest file is split by concern, from 1401 to 727 lines.
- `npm run lint` also checks which folders may import which, and size budgets. CI pins its actions to commits, limits its token and audits the runtime dependency, and Dependabot proposes updates. See [SECURITY.md](SECURITY.md) and the decision records in [docs/adr](docs/adr/README.md).

## 0.4.6

- The JSON, Excel and Google Sheets exports leave out what is not about the diagram. JSON (format version 2): no colors or other styles, no positions or sizes, no line routing or anchor sides, no shown/hidden flags, and no drawing name or timestamp. Excel and Google Sheets: the Blocks table no longer has Fill and Size columns, the Connections table no longer has a Line column, and the Index sheet no longer starts with the drawing's name and an export-date line. The sheet for blocks that are not in a frame is now called **Unframed** instead of Canvas. The raw JSON format is unchanged: it is still the drawing file.
- Tags are in every table: a Tag column next to the title in each frame's text table (and the tag above the title in the drawn block), and next to Block in the Blocks table. They were already in the JSON.
- A more compact side panel. The wide Hidden / Shown buttons for a block's description and comment are now a small eye button in the label row (the field is dimmed while hidden). Short option rows (palette, depth, text size and alignment, line type, arrowheads and so on) are one joined control, the section labels and dividers are tidier, and color swatches wrap into even rows so the custom color picker no longer sits alone.

## 0.4.5

- No change in how Block Draw works. This release tidies what the community directory's automated review looks at: the message shown when the web fonts cannot be downloaded no longer starts with the plugin name, the web font loader uses async/await, and the project's lint now also runs the directory's stylesheet checks (no `!important`, no CSS that Obsidian 1.5 does not support).

## 0.4.4

- Text alignment: a block's text can now sit at the **top**, **middle** or **bottom** of the block (a new row under **Text** in the properties panel), as well as left, center or right. Existing drawings keep their text in the middle.
- Blocks inside another block: the links between them are now drawn above the container, so they stay visible, and they can be selected. A link never takes clicks away from the two blocks it connects.
- Web fonts are now opt-in. Block Draw used to load Inter, Roboto, Open Sans, Montserrat and Lato from Google Fonts whenever Obsidian started, and again for every note embed. It now contacts Google for fonts only if you turn on **Load web fonts from Google Fonts** in **Settings → Block Draw** (off by default). Without it the fonts installed on your device are used, and the font picker says so. SVG exports import the fonts only when the setting is on, and text is measured and wrapped again once the fonts have arrived.
- Fixes for the Obsidian plugin review: no `!important` in the stylesheet, Obsidian's `createEl` instead of `document.createElement`, scrollbars styled without `scrollbar-width` and `scrollbar-color` (Obsidian 1.4 only partly supports them), and no `moment` call.
- Docs: a shorter README that lists the current features, with the detail in `docs/DESIGN.md`.

## 0.4.3

- Presentation mode: clicking a comment badge now shows or hides that comment. It only changes what is on screen, so the drawing file is never modified, and the saved open/closed state is back when you leave the presentation.
- Block descriptions can be shown or hidden, like comments: a **Hidden / Shown** switch above the Description field in the properties panel, and **Hide description** / **Show description** in a block's right-click menu. A hidden description is not drawn (canvas, embeds, SVG and PNG exports, or the Excel and Google Sheets grid) and does not count towards the block's height, but the text is kept: it is still in the JSON export (`descriptionOpen`), the Blocks tab and each frame's text table.
- Animated **Flow** on a link with arrowheads at both ends now runs both ways: the link is drawn as two parallel lanes whose dashes move in opposite directions (also while a dependency trace animates it). A link with an arrowhead only at its start now flows toward that arrowhead instead of away from it.

## 0.4.2

- Added the **10 most used fonts in the world for business presentations** (Inter, Segoe UI, Roboto, Arial / Helvetica, Calibri, Aptos, Open Sans, Montserrat, Lato, Georgia) with cross-platform fallback stacks.
- Typography styling applies to block **Titles**, **Descriptions**, **Tags**, and **Links**.
- Added a Font Family dropdown in the properties panel under the **Text** section with font names and business role descriptions.
- Dynamic font-aware text measurement and auto-fit block heights.
- Live typography preview in the in-place text editor while editing.
- Embedded font stylesheet in standalone SVG exports.
- Maintained 100% backward compatibility with existing drawings defaulting safely to Inter.

## 0.4.1

- Renamed the **Executive 3D** theme to **3D** across themes, context menus, and documentation while maintaining backward-compatible "executive" aliases.
- Added a matching **3D** color palette for quick color picking.
- Calibrated 3D block shadows: tightened extrusion projection, capped max depth, and significantly reduced drop shadow spread and blur footprint.
- Presentation mode: added a real-time floating spotlight legend displaying the root focus block, upstream dependencies (amber badge), downstream dependencies (emerald badge), and a clear button.
- Presentation mode: added an on-screen Presentation Guide & shortcut cheat sheet (`?` key or bottom bar button).
- Softened trace glows and drop shadow filters in CSS to eliminate visual noise.
- Preserved scroll position in the properties panel when editing properties or switching themes/palettes.
- Documented keyboard shortcuts (`G`, `R`, `C`, `?`) in the help dialog.

## 0.4.0

- Themes: one-click **Executive 3D**, **Minimal**, **Futuristic** and **Classic** looks for the whole drawing or the selection (right-click the canvas, the properties panel's Quick theme buttons, or the command palette). Color-coded groups stay grouped, and it is one undo step.
- Palettes: the properties panel's swatches can switch between Classic, Minimal and Futuristic colors.
- 3D effect for blocks (raised tiles with a top-lit face and soft shadow; neon sides and glow on dark fills) and for links (shadow and sheen). Toggle it in the properties panel, the right-click menu, or with the *Toggle 3D effect* command. Shown in embeds and SVG/PNG exports.
- Presentation mode (P): full screen, an overview slide then one slide per frame, laser pointer, light or dark stage, click a block to spotlight it. Read-only, and the view is restored afterwards.
- Dependency tracing (T): highlights everything upstream and downstream of the selected block and fades the rest.
- Animated flow on connectors, to show the direction data moves.
- Tags: a technology or role shown above a block's title, exported in JSON (`tag`) and as a Tag column on the workbook's Blocks tab.

## 0.3.1

- Google Sheets export: when the Apps Script web app replies with something other than JSON — most often because its deployment's "Who has access" isn't set to "Anyone", or the web app address is the editor's `/dev` test link instead of the deployed `/exec` one — the error now says exactly what's wrong and how to fix it, instead of just "did not return JSON (HTTP 200)".

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
