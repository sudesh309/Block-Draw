# ADR 0001: The file is the ABI

**Status:** accepted (0.5.0)

## Context

People keep `.blockdraw` files in their vaults for years, sync them between devices that run different releases, and keep some in git. The exports (structured JSON, the Excel and Google Sheets workbooks, SVG) are read by other tools and by people. Nothing the plugin does internally matters to them; the files do.

## Decision

The `.blockdraw` format and the export outputs are Block Draw's public interface, and they are guarded like one:

- A field is never renamed, removed or given a new meaning. New fields are optional and have a default, so every older file opens unchanged.
- `docs/FORMAT.md` lists every field, its default and the release that added it. `tests/format.test.ts` checks the tables against the parser.
- Golden files in `tests/golden/` hold the exact output for a drawing that uses every field, a file written by 0.1.0, every export and the renderer. A change to any of them shows up in the diff of the patch that caused it, and has to be intended (`UPDATE_GOLDEN=1 npm test` rewrites them).

## Consequences

- Refactors are provable: moving code must leave every golden file byte-identical.
- Removing a field takes a new file format version and a migration, which is deliberately expensive.
- The structured JSON export has its own `version` (2 since 0.4.6). Its shape follows the same rules.
