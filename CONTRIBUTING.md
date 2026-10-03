# Contributing to Block Draw

Issues and pull requests are welcome.

## Setup

```bash
npm install
npm run dev   # rebuilds main.js on change; load the vault it's symlinked/copied into and reload Obsidian
```

The [Development](docs/DESIGN.md#development) section of the design doc lists every script (lint, unit tests, editor UI tests, end-to-end tests in real Obsidian), and its [Architecture](docs/DESIGN.md#architecture) section explains how the code is laid out. The decisions behind it are in [docs/adr](docs/adr/README.md).

## Before opening a pull request

```bash
npm run lint    # ESLint, stylelint, the layer check and the budgets
npm test
npm run build
```

Keep changes focused and add or update tests for behavior you change. For anything beyond a small fix, open an issue first to discuss the approach.

## How the code stays maintainable

- **Layers.** Each folder in `src/` has a rank: `model` 0, `geometry` 1, `render` 2, `kernel` 3, `editor` and `export` 4, `obsidian` 5, `main.ts` 6. A file may import only its own folder or lower ranks, only `obsidian/` and `main.ts` may import the `obsidian` package, and only `obsidian/net.ts` may call `requestUrl`. `scripts/check-layers.mjs` enforces this in `npm run lint`.
- **Tables, not switch statements.** A concept with several variants (shapes, commands, settings, exporters) is one table with one row per variant ([ADR 0002](docs/adr/0002-tables-over-switches.md)). Add a row; do not add a case to a switch elsewhere.
- **The file format is the interface.** `tests/golden/` holds the exact output for the file format, every export and the renderer. A refactor must leave them byte-identical. After an intended change, run `UPDATE_GOLDEN=1 npm test` and review the diff of the golden files like code. `docs/FORMAT.md` lists every field; `tests/format.test.ts` checks it against the parser.
- **Budgets.** `budgets.json` holds numbers that only move on purpose: the six files over 400 lines may not grow (lower a number when its file shrinks), new files stay at or under 400 lines, one runtime dependency, and `main.js` under 250,000 bytes. Raising a number needs the reason in the commit message.
- **How a change travels.** One logical change per commit, and every commit builds and passes the tests, so `git bisect` always works. Move code in one commit and edit it in the next, so blame stays useful. The commit message says why; the diff already says what.

## Recipes

Each recipe is backed by tests that check the table it adds to, so a missed step fails `npm test` or the build.

- **A shape.** Add the id to `BLOCK_SHAPES` in `src/model/types.ts` (the file format must know it), create `src/geometry/shapes/<id>.ts` with its row (label, path, outline, text box), and list it in `src/geometry/shapes/index.ts`. TypeScript refuses to build until the three agree. Add the id to the value sets in `docs/FORMAT.md`, then `UPDATE_GOLDEN=1 npm test` writes its golden SVG.
- **A keyboard shortcut.** Add a row to `COMMANDS` in `src/editor/commands.ts`: id, label, group, keys and what it runs. The key handler, the help panel, tooltips that use `shortcut(id)` and the shortcut table in `docs/DESIGN.md` (rewritten by `UPDATE_GOLDEN=1 npm test`) follow from it. Rows are matched in order, so put a Shift variant before its plain key.
- **A setting.** Add a row to `SETTINGS` in `src/obsidian/settings.ts` and the field to `BlockDrawSettings`, then place the row in the settings tab with `this.row("<key>")`. The default, validation, what is saved in `data.json` and the control come from the row. A setting that reaches the network lists its hosts in `needs` and must default to off; a secret uses `type: "secret"` and never goes into `data.json`.
- **An export format.** Write the export in `src/export/` (pure, no Obsidian) and add a row to `EXPORTERS` in `src/obsidian/exporters.ts`: label, icon, command, menus, the hosts it connects to in `needs`, and what it runs. Menus, the command palette and the network allow-list follow from it. Never change an existing command id: people bind hotkeys to them.

## Reporting a bug

Include your Obsidian version, platform (desktop/mobile, OS), and the steps to reproduce. If it's related to Google Sheets export, note which connection method you're using (Apps Script web app or Google account). Never include your Apps Script secret, OAuth client secret or any access or refresh token.

## Security

Please report security issues privately; see [SECURITY.md](SECURITY.md).
