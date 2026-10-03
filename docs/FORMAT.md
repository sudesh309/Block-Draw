# The `.blockdraw` file format

A `.blockdraw` file is UTF-8 JSON. Block Draw writes one element per line, so a drawing kept in git diffs and merges like text:

```json
{
	"type": "block-draw",
	"version": 1,
	"elements": [
		{"id":"f1","type":"frame","x":0,"y":0,"width":600,"height":400,"title":"Checkout","description":"","style":{"fill":"transparent","stroke":"default"}},
		{"id":"cart","type":"block","x":40,"y":60,"width":160,"height":80,"title":"Cart","description":"","descriptionOpen":true,"shape":"rounded","frameId":"f1","link":null,"tag":"","comment":"","commentOpen":false,"style":{"fill":"#a5d8ff","stroke":"default","strokeWidth":2,"strokeStyle":"solid","textColor":"auto","fontSize":16,"textAlign":"center","textVAlign":"middle","threeD":false,"fontFamily":"inter"}}
	]
}
```

This page lists every field, the value used when it is missing, and the release that added it. The tables are checked against the parser by `tests/format.test.ts`, so they cannot drift from the code.

## Compatibility rules

The file format is Block Draw's public interface (see [ADR 0001](adr/0001-the-file-is-the-abi.md)):

- A file written by any earlier release opens unchanged. New fields are optional and have defaults.
- A field is never renamed, removed or given a new meaning.
- Unknown top-level keys are kept when the file is saved, so data written by a newer release survives a save by an older one. Unknown keys inside an element are not kept.
- A missing value, a value of the wrong type or an out-of-range value falls back to the default below. An element that cannot be repaired is dropped (see [Repairs](#repairs-on-load)).

## Top level

| Field | Type | Default | Since | Notes |
| --- | --- | --- | --- | --- |
| `type` | string | `"block-draw"` | 0.1.0 | Any other value is refused. |
| `version` | number | `1` | 0.1.0 | Always written as 1. |
| `elements` | array | `[]` | 0.1.0 | Frames, blocks and connectors, in drawing order (later elements are drawn on top). |
| `exports.googleSheet` | object | absent | 0.1.0 | Where the drawing was last exported to Google Sheets: `spreadsheetId`, `url`, `exportedAt` (ISO time) and `sheetIds` (the tabs that export created). Exporting again updates that spreadsheet. |

## Elements

### Block

| Field | Type | Default | Since | Notes |
| --- | --- | --- | --- | --- |
| `id` | string | a new random id | 0.1.0 | Unique in the drawing. A duplicate gets a new id. |
| `type` | string | required | 0.1.0 | `"block"` |
| `x` | number | `0` | 0.1.0 | Canvas units. |
| `y` | number | `0` | 0.1.0 | |
| `width` | number | `160` | 0.1.0 | At least 1. |
| `height` | number | `80` | 0.1.0 | At least 1. |
| `title` | string | `""` | 0.1.0 | |
| `description` | string | `""` | 0.1.0 | |
| `descriptionOpen` | boolean | `true` | 0.4.3 | `false` hides the description on the canvas and in drawn exports. The text is kept and still exported as data. |
| `shape` | shape | `"rounded"` | 0.1.0 | See [value sets](#value-sets). |
| `frameId` | string or null | `null` | 0.1.0 | The frame the block belongs to. An id that matches no frame becomes `null`. |
| `link` | string or null | `null` | 0.1.0 | See [links](#links). |
| `tag` | string | `""` | 0.4.0 | Stereotype or technology shown above the title. |
| `comment` | string | `""` | 0.2.0 | |
| `commentOpen` | boolean | `false` | 0.2.0 | Whether the comment callout is shown. |
| `style.fill` | color | `"#a5d8ff"` | 0.1.0 | See [colors](#colors). |
| `style.stroke` | color | `"default"` | 0.1.0 | |
| `style.strokeWidth` | number | `2` | 0.1.0 | At least 0. |
| `style.strokeStyle` | stroke style | `"solid"` | 0.1.0 | |
| `style.textColor` | color | `"auto"` | 0.1.0 | |
| `style.fontSize` | number | `16` | 0.1.0 | At least 4. |
| `style.textAlign` | text align | `"center"` | 0.1.0 | |
| `style.textVAlign` | vertical align | `"middle"` | 0.4.4 | |
| `style.threeD` | boolean | `false` | 0.4.0 | Draws a raised tile with a shadow. |
| `style.fontFamily` | font | `"inter"` | 0.4.2 | |

### Frame

| Field | Type | Default | Since | Notes |
| --- | --- | --- | --- | --- |
| `id` | string | a new random id | 0.1.0 | |
| `type` | string | required | 0.1.0 | `"frame"` |
| `x` | number | `0` | 0.1.0 | |
| `y` | number | `0` | 0.1.0 | |
| `width` | number | `400` | 0.1.0 | At least 1. |
| `height` | number | `300` | 0.1.0 | At least 1. |
| `title` | string | `"Frame"` | 0.1.0 | |
| `description` | string | `""` | 0.1.0 | |
| `style.fill` | color | `"transparent"` | 0.1.0 | |
| `style.stroke` | color | `"default"` | 0.1.0 | |

### Connector

| Field | Type | Default | Since | Notes |
| --- | --- | --- | --- | --- |
| `id` | string | a new random id | 0.1.0 | |
| `type` | string | required | 0.1.0 | `"connector"` |
| `from.id` | string | required | 0.1.0 | Id of the block the connector starts at. |
| `from.side` | anchor side | `"auto"` | 0.1.0 | |
| `to.id` | string | required | 0.1.0 | Id of the block the connector ends at. |
| `to.side` | anchor side | `"auto"` | 0.1.0 | |
| `label` | string | `""` | 0.1.0 | |
| `routing` | routing | `"elbow"` | 0.1.0 | |
| `comment` | string | `""` | 0.2.0 | |
| `commentOpen` | boolean | `false` | 0.2.0 | |
| `style.stroke` | color | `"default"` | 0.1.0 | |
| `style.strokeWidth` | number | `2` | 0.1.0 | At least 0.5. |
| `style.strokeStyle` | stroke style | `"solid"` | 0.1.0 | |
| `style.startArrow` | arrowhead | `"none"` | 0.1.0 | |
| `style.endArrow` | arrowhead | `"arrow"` | 0.1.0 | |
| `style.threeD` | boolean | `false` | 0.4.0 | Draws the line as a raised tube. |
| `style.flow` | boolean | `false` | 0.4.0 | Animates the line in its direction; with arrowheads at both ends it runs both ways. |

## Value sets

| Value set | Used by | Values |
| --- | --- | --- |
| shape | `shape` | `rounded` `rectangle` `ellipse` `diamond` `parallelogram` `hexagon` `cylinder` `text` |
| stroke style | `style.strokeStyle` | `solid` `dashed` `dotted` |
| routing | `routing` | `elbow` `straight` `curved` |
| arrowhead | `style.startArrow` `style.endArrow` | `none` `arrow` `triangle` `dot` |
| text align | `style.textAlign` | `left` `center` `right` |
| vertical align | `style.textVAlign` | `top` `middle` `bottom` |
| anchor side | `from.side` `to.side` | `auto` `top` `right` `bottom` `left` |
| font | `style.fontFamily` | `inter` `segoe` `roboto` `arial` `calibri` `aptos` `opensans` `montserrat` `lato` `georgia` |

## Colors

A color is a CSS color (Block Draw writes `#rrggbb`) or one of three words that are resolved when the drawing is drawn:

- `transparent`: no fill or no line.
- `default`: the theme's ink, dark in light mode and light in dark mode.
- `auto` (text only): a text color that reads well on the block's fill.

## Links

A block's `link` is one of:

- `frame:<frameId>`: a frame in the same drawing.
- `[[path#subpath|alias]]`: a note or file in the vault, written as Obsidian link text. `[[Checkout.blockdraw#Payment]]` opens another drawing at a frame.
- A URL with a scheme, such as `https://…` or `mailto:…`.

## Repairs on load

- An element without an id gets a new one, and so does an element whose id is already taken.
- A connector is dropped when either end is not a block in the drawing, or when both ends are the same block.
- A `frameId` that matches no frame becomes `null`.
- An element of an unknown type is dropped.
