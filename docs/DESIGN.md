# Block Draw: design and reference

The [README](../README.md) is the short version. This document holds the detail: how each feature works, the export and file formats, how to set up Google Sheets, and how the code is put together.

**Contents**

- [Editing](#editing): [the basics](#the-basics), [keyboard shortcuts](#keyboard-shortcuts), [frames and links](#frames-and-links), [descriptions and comments](#descriptions-and-comments)
- [Look and feel](#look-and-feel): [themes, palettes and 3D](#themes-palettes-and-3d), [fonts](#fonts)
- [Presenting](#presenting)
- [For architects and engineers](#for-architects-and-engineers)
- [Exporting](#exporting): [the workbook](#what-the-workbook-looks-like), [Google Sheets setup](#setting-up-google-sheets-export), [JSON format](#json-format)
- [The `.blockdraw` file](#the-blockdraw-file)
- [Network use and privacy](#network-use-and-privacy)
- [Architecture](#architecture): [layers](#layers), [design decisions](#design-decisions), [testing](#testing)
- [Development](#development): [commands](#commands), [releasing](#releasing-a-new-version)

## Editing

### The basics

- **Canvas**: infinite canvas with pan and zoom, grid and snapping, undo/redo, copy/paste, duplicate (Ctrl/Cmd+D or Alt+drag), align and distribute, and single-key tool shortcuts.
- **Blocks with titles**: every block has a title and an optional description. Eight shapes (rounded, rectangle, ellipse, decision, input/output, preparation, database, text only) with fill, stroke, text size and alignment: left, center or right, and top, middle or bottom (the **Text** section of the properties panel). Blocks grow to fit their text.
- **Connections**: hover a block and drag one of its edge dots onto another block. Drop on empty space to create a connected block, or click a dot to add one in that direction. Elbow, straight or curved lines, arrowheads, labels, and re-attachable ends. Connections follow their blocks and are drawn above all blocks by default, so a block can be a container around other blocks (a platform with its services inside) and the links between the inner blocks stay visible and clickable.
- **Bending a link**: select a link and drag one of the small dots on it: the link then passes through the point where you drop it (on the grid when snapping is on). Drag a filled dot to move that bend, double-click it to remove it, or use **Reset route** in the panel or the context menu to let the line find its own way again. Elbow links keep their right angles, curved links stay smooth, and the bends move and copy with the link's blocks. Exports to Excel and Google Sheets lay links out on a grid and ignore bends.
- **Front and back**: **Bring to front** and **Send to back** (panel, context menu, Ctrl/Cmd+Shift+] and [) work across blocks and links. A block brought to the front is drawn above the links, so a small label block can sit on a line; a link sent to the back runs behind the blocks. Bring forward and send backward (Ctrl/Cmd+] and [) move one step among the elements of the same kind.
- **Frames**: group blocks into frames (F). Moving a frame moves its blocks. The frames panel lists them in export order; click to jump, double-click to rename, reorder with the arrows.
- **Links between frames**: link any block to another frame (Ctrl/Cmd+K, the link dropdown, or right-click). Ctrl/Cmd+click the block or click its corner badge to jump there; **Back** (Alt+←) returns. Blocks can also link to notes, frames in other drawings, or URLs.
- **Deep links and embeds**: `[[Checkout.blockdraw#Payment details]]` opens a drawing at a frame, and a `blockdraw` code block shows a live preview of a drawing or of one frame inside a note.
- **Theme and devices**: follows Obsidian's light and dark theme, and works on desktop and mobile (tap, double-tap, pinch to zoom).
- **Tablet mode**: on a phone or tablet, Obsidian opens a sidebar when a finger or pen moves quickly to the left or right, and the quick switcher when it moves down. In a drawing, that movement is drawing, so tablet mode (**Settings → Block Draw → Touch and pen**) keeps these gestures out of the drawing. To open a sidebar from a drawing, swipe in from the very edge of the screen. **Automatic** (the default) turns it on for phones and tablets; **On** and **Off** choose for yourself.

![Dark theme with the properties panel showing a block's frame link](images/editor-dark.png)

### Keyboard shortcuts

Press **?** in the editor for this list.

<!-- shortcuts:start: generated from src/editor/commands.ts by tests/commands.test.ts (UPDATE_GOLDEN=1 npm test) -->
**Draw**

| Keys | Action |
| --- | --- |
| V or 1 | Select tool |
| H | Pan tool (or hold Space and drag) |
| B or 2 | Block tool |
| R | Rectangle block tool |
| O or 3 | Ellipse block tool |
| D or 4 | Decision block tool |
| A or C or 5 | Connector tool |
| F or 6 | Frame tool |
| Double-click | Add a block, or edit the text under the pointer |
| Drag an edge dot | Connect blocks; drop on empty space to create a connected block |
| Click an edge dot | Add a connected block in that direction |

**Edit**

| Keys | Action |
| --- | --- |
| Enter | Edit the selected element's text |
| Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y | Redo |
| Ctrl/Cmd+Z | Undo |
| Ctrl/Cmd+A | Select everything |
| Ctrl/Cmd+D | Duplicate (or Alt+drag) |
| Delete or Backspace | Delete the selection (a frame takes its blocks with it) |
| ← or → or ↑ or ↓ | Nudge the selection, or pan (Shift: 5 grid steps) |
| Ctrl/Cmd+Shift+] or Ctrl/Cmd+} | Bring to front |
| Ctrl/Cmd+] | Bring forward |
| Ctrl/Cmd+Shift+[ or Ctrl/Cmd+{ | Send to back |
| Ctrl/Cmd+[ | Send backward |
| Ctrl/Cmd+C, X, V | Copy, cut and paste |
| Drag a selected line | Bend it: grab a dot on the line and drop it where the line should pass |
| Double-click a bend | Remove that bend |
| Shift+Enter | New line while editing text |

**Links and frames**

| Keys | Action |
| --- | --- |
| Ctrl/Cmd+K | Link the selected block to a frame or note |
| Ctrl/Cmd+Enter | Follow the selected block's link (with Shift: in a new tab) |
| Alt+← | Back to where you were before following a link |
| ] or Page Down | Next frame |
| [ or Page Up | Previous frame |
| Ctrl/Cmd+click | Follow a block's link |

**View**

| Keys | Action |
| --- | --- |
| Shift+1 | Zoom to fit |
| Shift+2 | Zoom to the selection |
| Shift+0 | Zoom to 100% |
| + or = | Zoom in |
| − or _ | Zoom out |
| G | Grid on or off |

**Present**

| Keys | Action |
| --- | --- |
| P | Present: an overview, then one slide per frame |
| T | Trace the selected block's upstream and downstream dependencies |
| ? | Show or hide these shortcuts |
| Esc | Cancel what you are doing, close this list, clear a trace, or deselect |
| In a presentation | ← → slides · click a block to spotlight it · ? legend · S stage · L laser · Esc ends |
<!-- shortcuts:end -->

### Frames and links

A block belongs to the frame its center is in. Deleting a frame deletes its blocks (undo brings them back).

A block's link can point to:

- **a frame in the same drawing** — following it pans and zooms to the frame; the **Back** button returns;
- **a note or file** — opens it (Ctrl/Cmd+click opens a new tab);
- **a frame in another drawing** — stored as `[[Other.blockdraw#Frame title]]`;
- **a URL** — opens in your browser.

From any note, `[[My drawing.blockdraw#Frame title]]` opens the drawing at that frame. To show a drawing inside a note, add a code block (or run **Insert preview of a drawing**):

````markdown
```blockdraw
file: Checkout.blockdraw
frame: Payment details
height: 320
```
````

![A note with an embedded frame preview](images/embed.png)

### Descriptions and comments

Both are text you add in the properties panel (a description to a block, a comment to a block or a connector), and both have a small eye button in their label row that shows or hides them on the canvas.

A block's **description** is the text under its title. It is shown by default. Click the eye (or choose **Hide description** / **Show description** in the right-click menu) to draw only the title and tag. A hidden description takes no room on the block and is left out of the canvas, embeds, SVG and PNG exports and the Excel and Sheets grid, but the text is kept: it is still in the JSON export, on the workbook's Blocks tab and in each frame's text table, and it stays editable in the panel (dimmed while hidden).

A **comment** is an aside on a block or a connector. A small badge on the canvas shows that one exists; click it (or the eye in the panel's Comment row, or **Show comment** / **Hide comment** in the right-click menu) to expand or collapse the note. The open/closed state is saved with the drawing, so a comment left open stays visible in read-only embeds and in SVG/PNG exports. **Remove comment** clears it. Comments appear in the JSON, Excel and Google Sheets exports whether open or not. While [presenting](#presenting), clicking a badge shows or hides the comment for the presentation only, without changing the drawing.

The difference: a description is part of the block's content, while a comment stays out of the way until you open it.

## Look and feel

### Themes, palettes and 3D

![The 3D theme: soft colors, raised tiles and links, technology tags](images/theme-executive.png)

**One-click themes** restyle the whole drawing — or just the selection — in a single undoable step. Right-click the empty canvas, use the **Quick theme** buttons in the properties panel, or run *Apply theme: …* from the command palette:

| Theme | Look |
| --- | --- |
| 3D | Soft board-room colors, navy lines, raised 3D blocks and links |
| Minimal | White and grey, fine lines, flat |
| Futuristic | Deep navy tiles with neon edges and glow, in 3D |
| Classic | The original pastel colors, flat |

Themes keep your color coding: blocks that shared a color before still share one afterwards. Shapes, text, links and positions are never touched. The theme also becomes the style for blocks and connectors you add next.

**Palettes**: the **Palette** row in the properties panel switches the swatches between *3D*, *Classic*, *Minimal* (neutrals with one accent) and *Futuristic* (navy and neon).

**3D effect**: set **Depth → 3D** for blocks or **Effect → 3D** for connectors in the properties panel, use **3D effect** in the right-click menu, or run *Toggle 3D effect* (selection, or the whole drawing when nothing is selected). 3D blocks are extruded tiles with a top-lit face and a calibrated soft shadow; on dark fills the sides take the block's edge color and the edge glows. 3D links get a drop shadow and a sheen. The effect is part of the drawing, so it shows in embeds and in SVG and PNG exports.

![The Futuristic theme with animated flow](images/theme-futuristic.png)

### Fonts

Choose from the **10 most used fonts in the world for business presentations** in the properties panel under **Text** (applied to block **Titles**, **Descriptions**, **Tags**, and **Links**):
- **Inter**: Modern tech & clean digital UI standard (default)
- **Segoe UI**: Microsoft corporate & enterprise standard (PowerPoint / Office)
- **Roboto**: Google & Android clean geometric standard
- **Arial / Helvetica**: Universal corporate boardroom classic
- **Calibri**: Microsoft PowerPoint & Office classic default for 16+ years
- **Aptos**: Microsoft 365 modern presentation default
- **Open Sans**: High-legibility slide decks & consulting reports
- **Montserrat**: High-impact startup pitch decks & geometric headings
- **Lato**: Warm corporate & management consulting favorite
- **Georgia**: Authoritative digital editorial & executive prestige serif

Segoe UI, Arial / Helvetica, Calibri, Aptos and Georgia are system fonts that come with Windows, macOS or Office. **Inter, Roboto, Open Sans, Montserrat and Lato** are web fonts: Block Draw uses them when they are installed on your device, and otherwise falls back to a similar system font (the picker says so under the list). To have them everywhere, turn on **Settings → Block Draw → Load web fonts from Google Fonts**. This is off by default, and while it is off Block Draw never contacts Google for fonts. When it is on, the fonts are downloaded as they are needed, the text of every open drawing is measured and wrapped again once they arrive, and SVG files you export import them too. PNG images always use the fonts installed on your device, because an image cannot load fonts.

## Presenting

![Presentation mode in Obsidian](images/presentation.png)

Press **P** (or the toolbar's screen icon, or *Present drawing* in the command palette). The drawing goes full screen with every panel hidden: first an overview of the whole drawing, then one slide per frame, in the frames panel's order, with an animated move between slides.

| Keys | Action |
| --- | --- |
| → ↓ Space Page Down | Next slide |
| ← ↑ Page Up | Previous slide |
| 1–9, Home, End | Jump to a slide |
| Click a block | Spotlight it and its dependencies with live legend; click empty space to clear |
| Click a comment badge | Show or hide that comment (the drawing is not changed) |
| Click a link badge | Jump to the linked frame's slide |
| S | Switch between your theme and a dark stage |
| L | Laser pointer on / off |
| ? | Toggle presentation guide & shortcut cheat sheet |
| Esc | Clear the spotlight, then end the presentation |

Nothing can be edited while presenting, and your view is restored afterwards.

## For architects and engineers

![Tracing the dependencies of a block](images/trace.png)

- **Dependency tracing**: select a block and press **T** (or right-click → *Trace dependencies*). Blocks it depends on glow amber (upstream, against the arrows), blocks that depend on it glow green (downstream, along the arrows), the paths between them animate, and everything else fades. The hint bar counts both sides. Cycles are handled. Esc clears it.
- **Animated flow**: set a connector's **Effect** to **Flow** and dashes march along it, on the canvas and in embedded previews (static in exported images). The dashes follow the arrowheads: toward the end when the arrow is at the end (or there is none), toward the start when the arrow is only at the start. A link with arrowheads at **both** ends is drawn as two parallel lanes whose dashes move in opposite directions. The same applies while a trace animates a link. Respects the system's reduced-motion setting.
- **Tags**: give a block a technology or role in the **Tag** field (“Service · Java”, “Queue · Kafka”, “PostgreSQL”). It is shown in small capitals above the title, like a C4 stereotype, and exported in the JSON (`tag`) and in the workbook's Blocks tab.

## Exporting

| Export | Where it goes |
| --- | --- |
| Google Sheets | A spreadsheet in your Google Drive (see setup below) |
| Excel workbook (.xlsx) | Next to the drawing (or the export folder from settings) |
| JSON | `<drawing>.json`, or **Copy JSON to clipboard** |
| SVG / PNG | The whole drawing, or only the selected frame |

### What the workbook looks like

The Google Sheets and Excel exports build the same workbook:

- **Index** tab: a table with every frame, a link to its tab, block and connection counts, the frames it links to and its description. It starts with the table: there is no title, drawing name or export date on it.
- **One tab per frame**, drawn on a grid of small square cells: blocks are filled, outlined cells; connections are routed along cell borders with arrowheads and labels; frame titles and descriptions sit on top with a link back to the index. A block that links to a frame gets a **→ Frame name** link that jumps to that frame's tab. Hover a block (or a labeled connection) for a note with its comment and connections. A block's tag is drawn above its title, as on the canvas. Beside the grid, a plain table lists the frame's blocks as text — **Block Title**, **Tag**, **LinkTo** and **LinkFrom** (its outgoing and incoming connections), **Block Description** and **Notes** (its comment) — so the frame reads without the diagram too.
- **Unframed** tab for blocks that are not in any frame, with the same textual table.
- **Blocks** and **Connections** tabs listing every element across all frames as a filterable row. Blocks: frame, block, tag, description, shape, links to, outgoing, incoming, comment. Connections: from frame, from, label, to, to frame, comment. Internal element ids, colors, sizes and line styles are never shown.

The workbook is about what the diagram says: the grid keeps the blocks' colors so a sheet still looks like the drawing, but no table lists color codes, sizes or line styles, and nothing names the drawing or the export date inside a sheet (the spreadsheet's own title is the drawing's file name).

A block whose description is hidden is drawn without it on the grid, but its description still appears in the tables.

![A frame tab: blocks as cells, connections as borders, and a link to another frame's tab](images/sheet-frame.png)

![The index tab](images/sheet-index.png)

Exporting a drawing to Google Sheets again **updates the same spreadsheet**: the tabs it created are replaced, tabs you added yourself are kept. Use **Export to a new Google Sheet** to start over. Cell size, the extra tabs and this behavior can be changed in settings.

### Setting up Google Sheets export

Choose a connection method in **Settings → Block Draw → Google Sheets**.

#### Apps Script web app (recommended, works on mobile)

A tiny script in your own Google account receives the sheet data from Obsidian and writes it with the Google Sheets API. No Google Cloud project is needed.

1. In the plugin settings, click **Generate** next to *Apps Script secret*, then **Copy code**. The code is also in [`apps-script/Code.gs`](../apps-script/Code.gs).
2. Open [script.google.com](https://script.google.com), create a project and replace the contents of `Code.gs` with the copied code. If you copied the file from this repository instead, set `SECRET` at the top to the secret from the settings.
3. In the editor sidebar, click **Services (+)**, choose **Google Sheets API** and click **Add**.
4. Click **Deploy → New deployment**, select the type **Web app**, set *Execute as* to **Me** and *Who has access* to **Anyone**, then **Deploy** and authorize the script.
5. Copy the web app URL (it ends in `/exec`) into *Web app address* and click **Test**.

"Anyone" is required because Obsidian cannot sign in to your Google account. The script rejects every request that does not carry your secret, and it only creates and updates spreadsheets. If you edit the script later, publish it with **Deploy → Manage deployments → Edit → Version: New version** so the URL stays the same. Some Google Workspace organizations do not allow "Anyone" access; use the Google account method there.

If the export or the **Test** button fails, the message says what to fix:

| Message | Cause |
| --- | --- |
| Google asked to sign in instead of running the script | The deployment's *Who has access* is not **Anyone** (for example "Anyone with Google account"). Edit the deployment, set it to **Anyone** and deploy a new version. |
| The web app address ends in "/dev" | That is the editor's test link. Use the address from **Deploy → Manage deployments**, which ends in `/exec`. |
| Google Apps Script returned an error page | Deploy the latest code as a new version, and check that the address ends in `/exec`. |
| The Apps Script web app returned an empty response | Open the address once in a browser while signed in to the account that deployed it, finish any sign-in or permission prompt, then deploy a new version. |
| The Apps Script secret does not match | The secret in the settings differs from `SECRET` in the script. |

#### Google account (desktop only)

Calls the Google Sheets API directly after you sign in. It asks only for the `drive.file` permission: access to the spreadsheets Block Draw creates, nothing else in your Drive.

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project and enable the **Google Sheets API**.
2. Configure the OAuth consent screen (user type *External*) and add yourself as a test user. Publishing the app avoids having to sign in again every 7 days.
3. Create an **OAuth client ID** of type **Desktop app** and paste its client ID and client secret into the settings.
4. Click **Sign in with Google** and approve access in your browser.

The sign-in token is stored on this device only (in Obsidian's secret storage when available), never in the synced plugin settings.

### JSON format

The **structured** format (default) is meant for other tools: frames in order, each with its blocks in reading order and the connections inside it, with links resolved to frame titles. It describes what the diagram says, not how it looks: there are no colors or other styles, no positions or sizes, no line routing, no shown/hidden flags and no drawing name or timestamp. Ids stay because connections and `outgoing` / `incoming` refer to them.

```json
{
  "format": "block-draw/export",
  "version": 2,
  "frames": [
    {
      "id": "f1",
      "order": 1,
      "title": "Checkout flow",
      "description": "Happy path and the sign-in branch",
      "blocks": [
        {
          "id": "pay",
          "title": "Payment",
          "tag": "Service",
          "description": "Card, wallet or invoice",
          "comment": "",
          "shape": "rounded",
          "link": { "type": "frame", "frameId": "f2", "frameTitle": "Payment details" },
          "outgoing": [],
          "incoming": ["c2", "c4"]
        }
      ],
      "connections": [
        {
          "id": "c2",
          "from": { "blockId": "check", "blockTitle": "Logged in?", "frameId": "f1", "frameTitle": "Checkout flow" },
          "to": { "blockId": "pay", "blockTitle": "Payment", "frameId": "f1", "frameTitle": "Checkout flow" },
          "label": "yes",
          "comment": ""
        }
      ],
      "linksTo": [{ "frameId": "f2", "title": "Payment details" }],
      "linkedFrom": [{ "frameId": "f2", "title": "Payment details" }]
    }
  ],
  "unframed": { "blocks": [], "connections": [] },
  "crossFrameConnections": [],
  "stats": { "frames": 2, "blocks": 7, "connections": 6 }
}
```

Version 1 of this format also carried styles, canvas positions, shown/hidden flags and a timestamp. The **raw** format is the drawing file itself, with everything, for anything that needs those.

## The `.blockdraw` file

Drawings are plain JSON with one element per line, so they diff nicely in git:

```json
{
	"type": "block-draw",
	"version": 1,
	"elements": [
		{"id":"f1","type":"frame","x":0,"y":0,"width":780,"height":440,"title":"Checkout flow","description":"","style":{"fill":"transparent","stroke":"default"}},
		{"id":"pay","type":"block","x":580,"y":80,"width":160,"height":80,"title":"Payment","description":"Card, wallet or invoice","descriptionOpen":true,"shape":"rounded","frameId":"f1","link":"frame:f2","tag":"Service","comment":"","commentOpen":false,"style":{"fill":"#a5d8ff","stroke":"default","strokeWidth":2,"strokeStyle":"solid","textColor":"auto","fontSize":16,"textAlign":"center","textVAlign":"middle","threeD":true,"fontFamily":"inter"}},
		{"id":"c2","type":"connector","from":{"id":"check","side":"auto"},"to":{"id":"pay","side":"auto"},"label":"yes","routing":"elbow","comment":"","commentOpen":false,"style":{"stroke":"default","strokeWidth":2,"strokeStyle":"solid","startArrow":"none","endArrow":"arrow","threeD":false,"flow":true}}
	]
}
```

Block links are `frame:<frame id>`, `[[wikilink]]` or a URL. After a Google Sheets export the file also remembers the spreadsheet (`exports.googleSheet`) so the next export can update it. A file that cannot be read is shown as an error and never overwritten.

Fields added in later versions (`tag`, `descriptionOpen`, `textVAlign`, `threeD`, `flow`, `fontFamily` and so on) have defaults, so drawings saved by older versions open unchanged. Unknown top-level keys written by newer versions are kept when the file is saved.

If you use Obsidian Sync, turn on syncing of **other file types** in its settings so `.blockdraw` files are synced too.

## Network use and privacy

Block Draw works offline: drawing, saving and the JSON, Excel, SVG and PNG exports stay on your device. It contacts nothing by default. It uses the network in these cases, and only to Google, and only when you ask for it:

- **Web fonts** (off by default): if you turn on **Load web fonts from Google Fonts** in the settings, Block Draw downloads the stylesheet of the five web fonts from Google Fonts (`fonts.googleapis.com`) and then their font files from `fonts.gstatic.com`, as text needs them. It asks again at each start while the setting is on, and nothing is requested once you turn it off. SVG files exported while it is on import the same stylesheet when they are opened. No cookies are sent by the plugin, but Google receives your IP address with each request, as for any web font.
- **Google Sheets export, Apps Script web app**: the workbook goes to the web app you deployed in your own Google account (`script.google.com`), which writes it to your Google Drive. An address on another domain is used only after you confirm it.
- **Google Sheets export, Google account** (desktop): signing in goes through `accounts.google.com` (in your browser) and `oauth2.googleapis.com`, and the workbook goes straight to the Google Sheets API (`sheets.googleapis.com`), with access limited to the spreadsheets Block Draw creates.

Only Google Sheets export needs a Google account. There is no telemetry and there are no ads, and no other servers are contacted.

This is enforced in the code, not only promised ([ADR 0005](adr/0005-one-door-to-the-network.md)): every request goes through `src/obsidian/net.ts`, over https, to a host on an allow-list built from what the settings and exporters declare. A setting's hosts are on the list only while the setting is on, so with web fonts off even a bug could not reach Google Fonts. The build fails if any other file calls `requestUrl`. The hosts, as the tables declare them:

<!-- network:start: generated from the SETTINGS and EXPORTERS tables by tests/docs.test.ts (UPDATE_GOLDEN=1 npm test) -->
| Host | Contacted |
| --- | --- |
| `fonts.googleapis.com` | while **Load web fonts from Google Fonts** is on |
| `fonts.gstatic.com` | while **Load web fonts from Google Fonts** is on |
| `sheets.googleapis.com` | when you use **Export to Google Sheets**, or when you use **Export to a new Google Sheet** |
| `oauth2.googleapis.com` | when you use **Export to Google Sheets**, or when you use **Export to a new Google Sheet** |
| `script.google.com` | when you use **Export to Google Sheets**, or when you use **Export to a new Google Sheet** |
<!-- network:end -->

Links in drawings: a block's link opens only if it is a web or mail link (`http`, `https`, `mailto`). An `obsidian://` link opens after a confirmation that shows it, and any other kind (such as `file://`) is refused with a notice, because a drawing may come from someone else. Secrets (the Apps Script secret, the OAuth client secret and the Google sign-in) are kept in each device's secret storage, never in the synced settings file ([ADR 0004](adr/0004-secrets-stay-on-the-device.md)).

## Architecture

Block Draw is a TypeScript Obsidian plugin, bundled by esbuild into a single `main.js` (plus `styles.css`). The code is layered so that everything that draws, edits and exports a diagram is independent of Obsidian; only `src/obsidian` and `src/main.ts` talk to the app. The decisions behind the structure are recorded in [docs/adr](adr/README.md).

### Layers

Each folder has a rank. A file may import only its own folder or folders with a lower rank: never upward, and never sideways (`editor` and `export` share a rank and stay apart). `scripts/check-layers.mjs` checks every import in `npm run lint`, so this table cannot quietly stop being true.

| Rank | Folder | Role |
| --- | --- | --- |
| 0 | `src/model` | Elements, the `.blockdraw` file format, scene operations, undo history, themes, dependency graph. Imports nothing. |
| 1 | `src/geometry` | Points and bounds, connector routing, polyline math, and the `SHAPES` table (one file per shape in `geometry/shapes/`) |
| 2 | `src/render` | Turns elements into a virtual SVG tree: blocks, connectors, frames, comments, text layout, colors, font stacks |
| 3 | `src/kernel` | The mechanism behind the tables: settings (defaults, validation, delta storage, secrets) and commands (key matching and formatting). Knows no particular setting or command. |
| 4 | `src/editor` | The canvas editor and its `COMMANDS` table: pointer and keyboard handling, viewport, hit-testing, clipboard, edits, panels, inline text editing, presentation |
| 4 | `src/export` | JSON, workbook layout, XLSX writer, Google Sheets requests and transports |
| 5 | `src/obsidian` | The Obsidian view, the `SETTINGS` and `EXPORTERS` tables, settings tab, link picker, the network gateway, secret storage, Google sign-in, embeds |
| 6 | `src/main.ts` | The plugin entry point: wires the tables into commands, menus, the ribbon and the network allow-list |
| | `apps-script` | The Google Apps Script bridge for Sheets export (runs in Google, not in the plugin) |

The editor's code is split by concern behind one `Editor` facade: `viewport.ts` (pan, zoom, coordinates), `hitTest.ts`, `clipboard.ts`, `contextMenu.ts`, `edits.ts` (each edit one undo step), `create.ts`, `navigation.ts` (frames and links), `commands.ts` and `keyboard.ts`. `Editor` keeps a method for each, so the rest of the code calls `editor.zoomToFit()` without knowing where it lives.

### Tables

A concept with several variants is one table with one row per variant ([ADR 0002](adr/0002-tables-over-switches.md)), and everything that lists or acts on the variants is derived from the rows:

| Table | Rows | Derived from it |
| --- | --- | --- |
| `SHAPES` (`geometry/shapes/`) | path, decoration, outline, side inset, text box, picker label | drawing, hit-testing, link anchors, text placement, the shape picker |
| `COMMANDS` (`editor/commands.ts`) | id, label, group, keys, whether it edits, what it runs | key dispatch, the help panel, tooltips, the shortcut table in this document |
| `SETTINGS` (`obsidian/settings.ts`) | key, type, default, name, description, secret, needed hosts | defaults, validation, what `data.json` stores (only changes, never secrets), the settings tab controls, the network allow-list |
| `EXPORTERS` (`obsidian/exporters.ts`) | label, icon, command, menus, needed hosts, what it runs | the export menu, the file explorer's menu, the command palette, the network allow-list |
| `PALETTES`, `DRAWING_THEMES` | colors | the palette swatches and the themes |

### Design decisions

- **Immutable elements.** Blocks, connectors and frames are plain objects; every edit produces a new object. Undo history stores snapshots of the element array that share all unchanged elements, so it is cheap, and the renderer can tell what changed with an identity check.
- **One renderer for everything.** `src/render` builds a small virtual-node tree. The editor turns it into live SVG DOM, while exports and note embeds turn the same tree into an SVG string, so a drawing looks the same everywhere. Blocks, connectors, frames, comment callouts, 3D effects and flow lanes are all produced there.
- **Keyed layers in the editor.** `SceneRenderer` keeps layers in a fixed order (frames, blocks, connectors, labels, comments, overlay). Each item declares the values it depends on and its DOM is rebuilt only when one of them changes. Connectors and their labels sit above the blocks, so a block drawn around other blocks never hides the links between them; comment callouts have their own layer above everything, so nothing is drawn over them.
- **Hit testing by geometry, not by DOM.** `Editor.hitTest(point)` (in `editor/hitTest.ts`) returns a tagged result (handle, badge, block, connector, frame). The pure helpers that decide where a badge or a label sits are shared by drawing and by interaction, which keeps them from drifting apart and lets the presenter reuse the same logic. A connector close to the pointer wins over a block, except over the two blocks it is attached to, so a link never steals clicks from its own ends.
- **Saved state versus view state.** What belongs to the drawing is in the elements and saved: positions, styles, theme, 3D, tags, `descriptionOpen`, `commentOpen`. What belongs to the view is not: selection, viewport, the dependency trace, and the comments a presenter opens or closes by clicking (`Presenter.commentOverrides`). Presenting therefore never modifies the file.
- **Text layout in one place.** `layoutBlockText` wraps and positions a block's tag, title and visible description (at the top, middle or bottom of the block, per `textVAlign`) for both the renderer and the automatic block height, using canvas text measurement with a deterministic estimate when no canvas exists (tests). Measured widths are cached; `Editor.relayout()` clears the cache and redraws when web fonts arrive and change them.
- **Web fonts without stylesheet elements.** Obsidian's review rules do not allow a plugin to attach `<link>` or `<style>` elements, and a stylesheet `@import` would load Google Fonts for everyone. `WebFontLoader` (`src/obsidian/webFonts.ts`) therefore runs only while the setting is on: it fetches Google's stylesheet through the network gateway, reads its `@font-face` rules (`parseWebFontFaces`, which accepts only the five families and single `https://fonts.gstatic.com/` sources), and adds them to each window's `document.fonts` through the FontFace API, including pop-out windows. Faces are added unloaded, so a file is downloaded only when text uses it. Turning the setting off removes them again.
- **Readable on any theme.** The editor takes its colors from Obsidian's theme variables. Where the accent colors an icon or text (the active tool, the shown eye, the selected option), it goes through `--bd-accent-ink`, which on a dark theme is the accent lightened toward white, so a dark accent color never makes an icon vanish; the eye's hidden state uses the theme's text color rather than its muted one. `tests/harness` and the Obsidian end-to-end tests check the contrast of these controls on light and dark themes with dark accents.
- **Stylesheet rules.** `styles.css` has no `!important` (specificity does the work, and the pointer cursor comes from a `data-cursor` attribute rather than an inline style), no `scrollbar-width` (Obsidian's older Chromium supports it only partly, so scrollbars use `::-webkit-scrollbar`), and nothing that loads from the network. `npm run lint` runs stylelint over `styles.css` with the community directory's checks (`stylelint.config.mjs`: no `!important`, and no CSS feature that Obsidian 1.5's Chromium, Chrome 114, lacks or only partly supports), and `tests/styles.test.ts` fails if any of that comes back, including the word `!important` in a comment.
- **Connector routing.** Elbow routes try each pair of sides and several orthogonal candidate paths and keep the cheapest (short, few bends, not crossing the blocks); curved routes are cubic Béziers; `trimRoute` shortens a route for its arrowheads. A link with `waypoints` is routed by `geometry/viaRoutes.ts` instead: a polyline through the points, right angles chosen leg by leg so that no segment doubles back over the one before it (a small dynamic program), or a chain of Bézier pieces whose tangents follow the neighbouring points. Where doubling back cannot be avoided the route keeps the waypoint as the tip of the out-and-back, so a waypoint is never lost.
- **Stacking order.** Frames are at the bottom; above them, from back to front, links with `behind`, blocks, links, and blocks with `inFront` (`model/stack.ts`). A drawing that uses neither flag looks as before. The editor renderer keeps one keyed layer per level, the SVG export emits an extra group only when it has content, and hit testing walks the levels from the top, so a click picks what is drawn on top. The flags are written only when set, and in a fixed key order, so files do not change line order when saved again. The spreadsheet exporter reuses the router on a grid through its `quantize`, `anchor` and `extraCost` options. A two-way flowing link gets two lanes by offsetting the route's polyline (`offsetPolyline`) to either side, one drawn start to end and one end to start, so the same dash animation runs both ways.
- **Tablet mode and Obsidian's swipes.** Obsidian's mobile layout recognises a swipe from the `touchmove` events that reach the window, and its exemption for pens never applies on Android: it checks `Touch.touchType`, which Chromium, the engine of Android's WebView, does not have. `TouchGuard` (`src/obsidian/touchGuard.ts`) therefore stops `touchmove` at the editor while tablet mode is on, except for a stroke that starts within 24 pixels of the left or right edge of the window. It leaves `touchstart` and `touchend` alone, because Obsidian builds its iOS long-press menu on them, and the editor itself uses pointer events, which are untouched. Obsidian's own `data-ignore-swipe` attribute would be simpler, but Obsidian 1.5 ignores it, and it would also take away the swipe from the edge. The Obsidian end-to-end tests switch Obsidian to its mobile layout and check every direction, on 1.5.3 and on current releases.
- **Editor host.** The editor never imports Obsidian. It talks to its environment through the `EditorHost` interface (menus, notices, link picker, opening links, export menu), which the Obsidian view and the browser test harness each implement.
- **Export pipeline.** `buildWorkbook()` turns a drawing into a backend-neutral `WorkbookModel`: sheets of cells with styles, merges, borders, links and notes. `writeXlsx()` serializes it to a real `.xlsx` (zip and XML written by hand with `fflate`). `src/export/gsheets/requests.ts` converts the same model to Google Sheets `batchUpdate` requests, and `exporter.ts` creates or updates the spreadsheet, replacing only the tabs a previous export created.
- **Two Sheets transports** behind one `SheetsTransport` interface: the Apps Script bridge (`AppsScriptTransport`) and the Sheets REST API with an OAuth token (`RestSheetsTransport`, PKCE loopback sign-in in `googleAuth.ts`). All HTTP goes through `obsidian/net.ts`, which uses Obsidian's `requestUrl` (no CORS restrictions, works on mobile) and checks every address against the allow-list.
- **Apps Script bridge.** `apps-script/Code.gs` always answers with JSON, even on errors, checks a shared secret and forwards `ping`, `create`, `get` and `batchUpdate` to the Sheets advanced service. Google answers a web-app POST with a redirect to a one-time content URL; `requestUrl` follows it. A reply that is not JSON therefore means Google answered before the script ran, and the transport explains the likely cause.
- **Tolerant file format, guarded like an interface.** `parseDrawing` validates and repairs what it reads: it fills defaults for fields that older files lack, drops connectors whose ends are gone and frame references that point nowhere, and keeps unknown top-level keys. [docs/FORMAT.md](FORMAT.md) lists every field, its default and the release that added it, and golden files lock the format and every export ([ADR 0001](adr/0001-the-file-is-the-abi.md)).
- **Settings as data.** Each setting is a row; `data.json` keeps only the values that differ from the defaults (so a better default reaches everyone) and keys written by newer releases. A setting that reaches the network is on only when saved as a literal `true`.
- **Budgets.** `budgets.json` caps file sizes (the large files may only shrink, new ones stay at or under 400 lines), runtime dependencies and the size of `main.js`; `npm run lint` and the build check them.

### Testing

- **Golden files** (`tests/golden`, written by `UPDATE_GOLDEN=1 npm test`) hold the exact `.blockdraw` output for a drawing that uses every field, what a 0.1.0 file becomes, the structured JSON, the workbook layout, the Excel file parts, the Google Sheets requests, every shape and a full render. Refactors must leave them byte-identical.
- **Unit tests** (`npm test`, Vitest) cover the model, geometry and routing, rendering, text layout, themes and tracing, the workbook layout and XLSX writer, the Sheets request builder (every request validated against a trimmed copy of Google's Sheets API schema in `tests/fixtures`), the real `apps-script/Code.gs`, run in a sandbox against an in-memory Sheets service, the web-font opt-in (the setting, the parser run on a real excerpt of Google's stylesheet, and `WebFontLoader` against fake windows) and the stylesheet rules.
- **Editor UI tests** (`npm run test:ui`, `tests/harness`) run the editor in Chromium with real pointer and keyboard input, through a small harness that implements `EditorHost`. They never use the network: every request to a web address is refused, and the suite fails if the editor makes one.
- **End-to-end tests** (`npm run test:e2e`, `tests/e2e`) drive the real Obsidian desktop app over the Chrome DevTools protocol: drawing, saving, frame links, nested blocks, text alignment, exports, themes, presenting, settings, the web-font opt-in, embeds, secrets kept out of `data.json` and tablet mode in Obsidian's mobile layout, with a local stand-in for the Apps Script web app that behaves like Google's (POST answered with a redirect to a content URL). The stand-in serves https with a throwaway certificate, so the export also passes the network gateway and the confirmation for an address outside Google. They pass on Obsidian 1.5.3, the oldest version the manifest allows, and on current releases.
- **CI** (`.github/workflows/ci.yml`) runs lint (ESLint, stylelint, the layer check and the budgets), unit tests, the build and the UI tests on every push, and reports known vulnerabilities in the runtime dependency. Actions are pinned to commits, and the job's token can only read the repository.

## Development

### Commands

```bash
npm install
npm run dev        # rebuild main.js on change
npm run build      # type check and production build
npm run lint       # ESLint (Obsidian's rules), stylelint on styles.css, the layer check and the budgets
npm run lint:arch  # only the layer check and the budgets
npm test           # unit tests and golden files (UPDATE_GOLDEN=1 npm test rewrites the golden files and generated doc tables)
npm run test:ui    # editor tests in Chromium (set CHROMIUM_PATH if Chromium is elsewhere)
OBSIDIAN_BIN=/path/to/obsidian npm run test:e2e   # end-to-end tests in the Obsidian desktop app (needs openssl)
```

Set `SHOTS=<dir>` to save screenshots from the UI and end-to-end tests, and `PLUGIN_DIR` to run the end-to-end tests against files downloaded from a release instead of the local build. `OBSIDIAN_BIN` is the Obsidian executable, for example from `Obsidian-x.y.z.AppImage --appimage-extract`.

### Releasing a new version

1. Add a `## x.y.z` section to `CHANGELOG.md` and commit it.
2. Run `npm version x.y.z`. It updates `package.json`, `manifest.json` and `versions.json`, commits, and creates the tag `x.y.z` (no `v`, as Obsidian requires).
3. Run `git push --follow-tags`. The release workflow checks that the tag matches the manifest, runs the tests, and publishes a GitHub release with `main.js`, `manifest.json` and `styles.css`, signed with [artifact attestations](https://docs.github.com/en/actions/security-guides/using-artifact-attestations-to-establish-provenance-for-builds), using the changelog section as release notes. Obsidian, BRAT and the community directory pick up new versions from these releases.

Instead of pushing a tag, you can push the version commit and run the **Release** workflow from the Actions tab; it tags the commit with the version from `manifest.json`.

The [Obsidian community directory](https://community.obsidian.md) scans each new release (manifest, release assets, source code and a rebuild of the source) and rates every finding as an error, a warning, a recommendation or a pass. It only notices a release at its next periodic check, so a fix is not reflected on the entry's page right after publishing. On the entry's management page, **...** → **Check for new releases** looks for the release now, **Request review** scans it now, and **Review branch** previews a scan of any branch, tag or commit without a release. The scan skips `tests`, `docs` and `*.mjs` files. It does not seem to use this repository's ESLint config (the review of 0.1.0 reported `prefer-create-el` although the config had switched that rule off), so fix findings in the code instead of overriding rules. The entry points at the repository by name, so keep that link current if the repository is renamed.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for how to report bugs and open pull requests.
