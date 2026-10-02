# Block Draw for Obsidian

Draw block diagrams in Obsidian — titled blocks, connections, and frames that link to each other — then present them, or export to **Google Sheets**, **Excel**, **JSON**, **SVG** or **PNG**.

![Block Draw in Obsidian: two frames, linked blocks and the frames panel](docs/images/editor.png)

## Features

- **Canvas editor**: infinite canvas, grid and snapping, undo/redo, copy/paste, align, single-key shortcuts. Eight block shapes; elbow, straight or curved connections; frames that group blocks.
- **Linked frames**: link a block to a frame, a note, another drawing or a URL, and jump there with Ctrl/Cmd+click. Show a drawing inside a note with a `blockdraw` code block or a `[[Drawing.blockdraw#Frame]]` link.
- **Executive-ready look**: one-click themes (3D, Minimal, Futuristic, Classic), color palettes, a 3D effect for blocks and links, and ten business fonts.
- **Presentation mode**: press **P** for a full-screen slideshow, one slide per frame.
- **For architects and engineers**: dependency tracing, animated two-way flow on links, and tags such as “Service · Java”.
- **Notes**: comments and descriptions that you can show or hide.
- **Exports**: Google Sheets (one tab per frame), Excel, JSON, SVG and PNG.
- Works offline, follows your light or dark theme, and runs on desktop and mobile.

![The 3D theme: soft colors, raised tiles and links, technology tags](docs/images/theme-executive.png)

## Install

Block Draw needs Obsidian 1.5 or later.

- **Community plugins**: open **Settings → Community plugins → Browse**, search for **Block Draw** and install it.
- **Manual**: download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/sudesh309/Template-Generator/releases/latest) into `<your vault>/.obsidian/plugins/block-draw/`, then in Obsidian open **Settings → Community plugins**, turn off restricted mode if needed, click the reload button next to **Installed plugins**, and enable **Block Draw**.
- **BRAT**: add `sudesh309/Template-Generator` as a beta plugin.
- **From source**: `npm install && npm run build`, then copy the three files as above.

## Quick start

1. Click the ribbon icon or run **Block Draw: Create new drawing**. Drawings are `.blockdraw` files.
2. Double-click the canvas to add a block and type its title. Press Enter to finish.
3. Hover the block, drag a dot from its edge and release on empty space: a connected block appears, ready for its title.
4. Press **F** and drag around some blocks to put them in a frame. Name the frame right away.
5. Select a block and pick a frame in **Link** (left panel) to link them. Ctrl/Cmd+click the block to jump.
6. Open the **Export** menu (toolbar download icon, the tab's ⋯ menu, or the command palette), or press **P** to present.

Press **?** in the editor for all keyboard shortcuts.

## Google Sheets export

Exports go through an Apps Script web app that you deploy in your own Google account (works on desktop and mobile, no Google Cloud project needed), or through a Google sign-in on desktop. Set it up under **Settings → Block Draw → Google Sheets**; the steps are in the [design doc](docs/DESIGN.md#setting-up-google-sheets-export).

## Network use and privacy

Block Draw works offline. It contacts only Google, and only for the presentation fonts that its stylesheet imports (Google Fonts), and when you export to Google Sheets or test that connection (your own Apps Script web app, or Google sign-in and the Sheets API). There is no telemetry and there are no ads. Details: [network use and privacy](docs/DESIGN.md#network-use-and-privacy).

## More

- [Design and reference](docs/DESIGN.md): how each feature works, the export and file formats, and the architecture
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)

## License

[MIT](LICENSE)
