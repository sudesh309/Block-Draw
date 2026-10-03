# ADR 0003: No public driver API yet

**Status:** accepted (0.5.0)

## Context

With shapes, commands, settings and exporters described by table rows, it is tempting to let other plugins add rows: a third-party shape, a new export format. But an API that other code depends on is an interface Block Draw would have to keep stable forever, like the file format (ADR 0001), and nobody has asked for one yet.

## Decision

The tables are internal. Rows are added in this repository, through the index files, and the table types may change in any release. A public API is considered only when a second consumer actually exists, and then as its own decision record.

## Consequences

- The table types can still be improved freely, for example a shape row gaining a field, without breaking anyone.
- Other plugins keep working with drawings through the file format and the exports, which are already stable.
