# Block Draw for Obsidian

Draw block diagrams in Obsidian — titled blocks, connections, and frames that link to each other — then export them as **JSON**, an **Excel workbook**, or a **Google Sheets workbook with one tab per frame**.

![Block Draw in Obsidian: two frames, linked blocks and the frames panel](docs/images/editor.png)

## Features

- **Excalidraw-style canvas**: infinite canvas with pan and zoom, grid and snapping, undo/redo, copy/paste, duplicate (Ctrl/Cmd+D or Alt+drag), align and distribute, and single-key tool shortcuts.
- **Blocks with titles**: every block has a title and an optional description. Eight shapes (rounded, rectangle, ellipse, decision, input/output, preparation, database, text only) with fill, stroke, text size and alignment. Blocks grow to fit their text.
- **Connections**: hover a block and drag one of its edge dots onto another block. Drop on empty space to create a connected block, or click a dot to add one in that direction. Elbow, straight or curved lines, arrowheads, labels, and re-attachable ends. Connections follow their blocks.
- **Frames**: group blocks into frames (F). Moving a frame moves its blocks. The frames panel lists them in export order; click to jump, double-click to rename, reorder with the arrows.
- **Links between frames**: link any block to another frame (Ctrl/Cmd+K, the link dropdown, or right-click). Ctrl/Cmd+click the block or click its corner badge to jump there; **Back** (Alt+←) returns. Blocks can also link to notes, frames in other drawings, or URLs.
- **Deep links and embeds**: `[[Checkout.blockdraw#Payment details]]` opens a drawing at a frame, and a `blockdraw` code block shows a live preview of a drawing or of one frame inside a note.
- **Exports**: Google Sheets, Excel (.xlsx), JSON (structured or raw), SVG and PNG (whole drawing or the selected frame).
- **Follows your theme** (light and dark), works on desktop and mobile (tap, double-tap, pinch to zoom).

![Dark theme with the properties panel showing a block's frame link](docs/images/editor-dark.png)

## Installation

Block Draw is not in the community plugin directory yet.

**Manual install**

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/sudesh309/Template-Generator/releases).
2. Copy them into `<your vault>/.obsidian/plugins/block-draw/`.
3. In Obsidian, open **Settings → Community plugins**, turn off restricted mode if needed, and enable **Block Draw**.

**With BRAT**: add `sudesh309/Template-Generator` as a beta plugin.

**From source**: `npm install && npm run build`, then copy the three files as above.

## Getting started

1. Click the ribbon icon or run **Block Draw: Create new drawing**. Drawings are `.blockdraw` files.
2. Double-click the canvas to add a block and type its title. Press Enter to finish.
3. Hover the block, drag a dot from its edge and release on empty space: a connected block appears, ready for its title.
4. Press **F** and drag around some blocks to put them in a frame. Name the frame right away.
5. Select a block and pick a frame in **Link** (left panel) to link them. Ctrl/Cmd+click the block to jump.
6. Open the **Export** menu (toolbar download icon, the tab's ⋯ menu, or the command palette).

### Keyboard shortcuts

| Keys | Action |
| --- | --- |
| V / H (or hold Space) | Select / pan |
| B, O, D | Block, ellipse block, decision block |
| A | Connector tool |
| F | Frame tool |
| Double-click | Add a block, or edit the text under the pointer |
| Enter | Edit the selected element's text (Shift+Enter for a new line) |
| Ctrl/Cmd+K | Link the selected block |
| Ctrl/Cmd+click | Follow a block's link |
| [ and ] (or Page Up/Down) | Previous / next frame |
| Alt+← | Back to where you were before following a link |
| Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z | Undo, redo |
| Ctrl/Cmd+C / X / V / D | Copy, cut, paste, duplicate |
| Arrows (Shift = 5 steps) | Nudge |
| Shift+1 / Shift+2 / Shift+0 | Zoom to fit / to selection / 100% |
| Ctrl/Cmd+] / [ (with Shift: to front / back) | Bring forward / send backward |
| Delete | Delete the selection (a frame takes its blocks with it) |
| ? | Show all shortcuts |

## Frames and links

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

![A note with an embedded frame preview](docs/images/embed.png)

## Exporting

| Export | Where it goes |
| --- | --- |
| Google Sheets | A spreadsheet in your Google Drive (see setup below) |
| Excel workbook (.xlsx) | Next to the drawing (or the export folder from settings) |
| JSON | `<drawing>.json`, or **Copy JSON to clipboard** |
| SVG / PNG | The whole drawing, or only the selected frame |

### What the workbook looks like

The Google Sheets and Excel exports build the same workbook:

- **Index** tab: every frame with a link to its tab, block and connection counts, the frames it links to and its description.
- **One tab per frame**, drawn on a grid of small square cells: blocks are filled, outlined cells; connections are routed along cell borders with arrowheads and labels; frame titles and descriptions sit on top with a link back to the index. A block that links to a frame gets a **→ Frame name** link that jumps to that frame's tab. Hover a block for a note listing its connections.
- **Canvas** tab for blocks that are not in any frame.
- **Blocks** and **Connections** tabs with every element as a filterable row (frame, title, description, links, incoming and outgoing connections).

![A frame tab: blocks as cells, connections as borders, and a link to another frame's tab](docs/images/sheet-frame.png)

![The index tab](docs/images/sheet-index.png)

Exporting a drawing to Google Sheets again **updates the same spreadsheet**: the tabs it created are replaced, tabs you added yourself are kept. Use **Export to a new Google Sheet** to start over. Cell size, the extra tabs and this behavior can be changed in settings.

### Setting up Google Sheets export

Choose a connection method in **Settings → Block Draw → Google Sheets**.

#### Apps Script web app (recommended, works on mobile)

A tiny script in your own Google account receives the sheet data from Obsidian and writes it with the Google Sheets API. No Google Cloud project is needed.

1. In the plugin settings, click **Generate** next to *Apps Script secret*, then **Copy code**. The code is also in [`apps-script/Code.gs`](apps-script/Code.gs).
2. Open [script.google.com](https://script.google.com), create a project and replace the contents of `Code.gs` with the copied code. If you copied the file from this repository instead, set `SECRET` at the top to the secret from the settings.
3. In the editor sidebar, click **Services (+)**, choose **Google Sheets API** and click **Add**.
4. Click **Deploy → New deployment**, select the type **Web app**, set *Execute as* to **Me** and *Who has access* to **Anyone**, then **Deploy** and authorize the script.
5. Copy the web app URL (it ends in `/exec`) into *Web app address* and click **Test**.

"Anyone" is required because Obsidian cannot sign in to your Google account. The script rejects every request that does not carry your secret, and it only creates and updates spreadsheets. If you edit the script later, publish it with **Deploy → Manage deployments → Edit → Version: New version** so the URL stays the same. Some Google Workspace organizations do not allow "Anyone" access; use the Google account method there.

#### Google account (desktop only)

Calls the Google Sheets API directly after you sign in. It asks only for the `drive.file` permission: access to the spreadsheets Block Draw creates, nothing else in your Drive.

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project and enable the **Google Sheets API**.
2. Configure the OAuth consent screen (user type *External*) and add yourself as a test user. Publishing the app avoids having to sign in again every 7 days.
3. Create an **OAuth client ID** of type **Desktop app** and paste its client ID and client secret into the settings.
4. Click **Sign in with Google** and approve access in your browser.

The sign-in token is stored on this device only (in Obsidian's secret storage when available), never in the synced plugin settings.

### JSON format

The **structured** format (default) is meant for other tools: frames in order, each with its blocks in reading order and the connections inside it, block positions relative to their frame, and links resolved to frame titles.

```json
{
  "format": "block-draw/export",
  "version": 1,
  "name": "Checkout",
  "frames": [
    {
      "id": "f1",
      "order": 1,
      "title": "Checkout flow",
      "description": "Happy path and the sign-in branch",
      "bounds": { "x": 0, "y": 0, "width": 780, "height": 440 },
      "blocks": [
        {
          "id": "pay",
          "title": "Payment",
          "description": "Card, wallet or invoice",
          "shape": "rounded",
          "bounds": { "x": 580, "y": 80, "width": 160, "height": 80 },
          "link": { "type": "frame", "frameId": "f2", "frameTitle": "Payment details" },
          "outgoing": [],
          "incoming": ["c2", "c4"]
        }
      ],
      "connections": [
        {
          "id": "c2",
          "from": { "blockId": "check", "blockTitle": "Logged in?", "frameId": "f1", "frameTitle": "Checkout flow", "side": "auto" },
          "to": { "blockId": "pay", "blockTitle": "Payment", "frameId": "f1", "frameTitle": "Checkout flow", "side": "auto" },
          "label": "yes",
          "routing": "elbow"
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

(Styles, canvas positions and timestamps are included too; shortened here.) The **raw** format is the drawing file itself.

## The `.blockdraw` file

Drawings are plain JSON with one element per line, so they diff nicely in git:

```json
{
	"type": "block-draw",
	"version": 1,
	"elements": [
		{"id":"f1","type":"frame","x":0,"y":0,"width":780,"height":440,"title":"Checkout flow","description":"","style":{"fill":"transparent","stroke":"default"}},
		{"id":"pay","type":"block","x":580,"y":80,"width":160,"height":80,"title":"Payment","description":"","shape":"rounded","frameId":"f1","link":"frame:f2","style":{"fill":"#a5d8ff","stroke":"default","strokeWidth":2,"strokeStyle":"solid","textColor":"auto","fontSize":16,"textAlign":"center"}},
		{"id":"c2","type":"connector","from":{"id":"check","side":"auto"},"to":{"id":"pay","side":"auto"},"label":"yes","routing":"elbow","style":{"stroke":"default","strokeWidth":2,"strokeStyle":"solid","startArrow":"none","endArrow":"arrow"}}
	]
}
```

Block links are `frame:<frame id>`, `[[wikilink]]` or a URL. After a Google Sheets export the file also remembers the spreadsheet (`exports.googleSheet`) so the next export can update it. A file that cannot be read is shown as an error and never overwritten.

## Development

```bash
npm install
npm run dev        # rebuild main.js on change
npm run build      # type check and production build
npm run lint       # ESLint with Obsidian's recommended rules
npm test           # unit tests (model, routing, workbook layout, XLSX, Sheets requests, Apps Script bridge)
npm run test:ui    # editor tests in Chromium (set CHROMIUM_PATH if Chromium is elsewhere)
OBSIDIAN_BIN=/path/to/obsidian npm run test:e2e   # end-to-end tests in the Obsidian desktop app
```

The Google Sheets tests validate every generated request against Google's published Sheets API schema (a trimmed copy lives in `tests/fixtures`), and run the real `apps-script/Code.gs` against an in-memory Sheets service. The end-to-end tests drive the real Obsidian app: drawing, saving, frame links, exports, settings and embeds, with a local stand-in for the Apps Script web app.

Source layout:

| Folder | Contents |
| --- | --- |
| `src/model` | Elements, file format, scene operations, undo history |
| `src/geometry` | Shapes and connector routing |
| `src/render` | SVG rendering shared by the editor, embeds and exports |
| `src/editor` | The canvas editor (independent of Obsidian) |
| `src/export` | JSON, workbook layout, XLSX writer, Google Sheets requests and transports |
| `src/obsidian` | View, settings, link picker, exports, Google sign-in, embeds |
| `apps-script` | The Google Apps Script bridge |

Releases: bump the version with `npm version <x.y.z>` and push the tag; the release workflow builds the plugin and drafts a GitHub release with the three plugin files.

## License

[MIT](LICENSE)
