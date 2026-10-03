# ADR 0002: Tables over switches

**Status:** accepted (0.5.0)

## Context

Up to 0.4.6 one idea was spread over many files. A hexagon was named on six lines in three files, three of them separate `switch (shape)` ladders. The `webFonts` setting appeared on 18 lines in 8 files. An export kind was a union, a 7-case switch and a hand-written menu in three places, and a keyboard shortcut was typed into the key handler, the help panel and the docs. Adding one more of anything meant finding every place, and missing one compiled fine.

`PALETTES` and `DRAWING_THEMES` were the exception: plain lists of rows, where a new palette is one more row.

## Decision

A concept with several variants is one table with one row per variant, and the code around it works the same for every row:

| Table | Home | Row |
| --- | --- | --- |
| `SHAPES` | `geometry/shapes/`, one file per shape | outline path, decoration, hit and link outline, side inset, text box, picker label |
| `SETTINGS` | rows in `obsidian/settings.ts`, mechanism in `kernel/settings.ts` | key, type, default, name, description, whether it is secret, what it needs (network) |
| `COMMANDS` | `kernel/commands.ts` | id, label, keys, when it applies, what it runs |
| `EXPORTERS` | `obsidian/exporters.ts` | id, label, icon, what it needs, what it runs |
| `PALETTES`, `DRAWING_THEMES` | `render/colors.ts`, `model/themes.ts` | already tables |

The mechanism (how a table is read, validated and turned into UI) is written once. A row holds policy only. The places that list rows are explicit index files: easy to grep, review and order, with no discovery magic.

## Consequences

- Adding a shape is a new file in `geometry/shapes/`, one line in its index and the id in `BLOCK_SHAPES` (because the file format must know it). TypeScript refuses to build until all three agree.
- The settings tab, the help panel, menus, tooltips and the docs tables are derived from the rows, so they cannot disagree with the code.
- A table is only worth it for a real family of variants. A property schema for the file parser and the side panel (a sixth table) is deliberately left for later, after these have paid off.
