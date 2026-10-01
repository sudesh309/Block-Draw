import type {
	BorderLine,
	CellModel,
	GridRange,
	LinkTarget,
	SheetModel,
	TextRun,
	WorkbookModel,
} from "../workbook/model";
import { parseCellKey } from "../workbook/model";

/**
 * Turns a {@link WorkbookModel} into Google Sheets API v4 `spreadsheets.batchUpdate` requests.
 * Sheet ids are chosen up front so cells can link to other tabs with `#gid=<id>`.
 */

export type SheetsRequest = Record<string, unknown>;

interface RgbColor {
	red: number;
	green: number;
	blue: number;
}

export function rgb(hex: string): RgbColor {
	const h = hex.replace("#", "");
	const n = (i: number) => Math.round((parseInt(h.slice(i, i + 2), 16) / 255) * 1000) / 1000;
	return { red: n(0), green: n(2), blue: n(4) };
}

const colorStyle = (hex: string) => ({ rgbColor: rgb(hex) });

const BORDER_STYLES: Record<BorderLine["style"], string> = {
	thin: "SOLID",
	medium: "SOLID_MEDIUM",
	thick: "SOLID_THICK",
	dashed: "DASHED",
	dotted: "DOTTED",
};

const H_ALIGN = { left: "LEFT", center: "CENTER", right: "RIGHT" } as const;
const V_ALIGN = { top: "TOP", middle: "MIDDLE", bottom: "BOTTOM" } as const;

export const CELL_FIELDS = "userEnteredValue,userEnteredFormat,textFormatRuns,note";
const ROWS_PER_UPDATE = 150;

/** Deterministic positive 31-bit id for a sheet key, avoiding ids in `used`. */
export function stableSheetId(key: string, used: Set<number>): number {
	let h = 2166136261;
	for (let i = 0; i < key.length; i++) {
		h ^= key.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	let id = ((h >>> 0) % 1999999999) + 1;
	while (used.has(id)) id = (id % 1999999999) + 1;
	used.add(id);
	return id;
}

export function assignSheetIds(model: WorkbookModel, reserved: Iterable<number> = []): Map<string, number> {
	const used = new Set(reserved);
	const ids = new Map<string, number>();
	for (const s of model.sheets) ids.set(s.key, stableSheetId(s.key, used));
	return ids;
}

function gridRange(sheetId: number, g: GridRange) {
	return {
		sheetId,
		startRowIndex: g.row,
		endRowIndex: g.row + g.rows,
		startColumnIndex: g.col,
		endColumnIndex: g.col + g.cols,
	};
}

function border(line: BorderLine | undefined) {
	return line ? { style: BORDER_STYLES[line.style], colorStyle: colorStyle(line.color) } : undefined;
}

function linkUri(link: LinkTarget, sheetIds: Map<string, number>): string | null {
	if (link.type === "url") return link.url;
	const id = sheetIds.get(link.sheetKey);
	return id === undefined ? null : `#gid=${id}`;
}

function textFormat(run: Partial<TextRun>, link: string | null): Record<string, unknown> {
	const f: Record<string, unknown> = {};
	if (run.bold !== undefined) f.bold = run.bold;
	if (run.italic !== undefined) f.italic = run.italic;
	if (run.underline !== undefined) f.underline = run.underline;
	if (run.fontSize !== undefined) f.fontSize = run.fontSize;
	if (run.color) f.foregroundColorStyle = colorStyle(run.color);
	if (link) f.link = { uri: link };
	return f;
}

export function cellData(cell: CellModel | undefined, sheetIds: Map<string, number>): Record<string, unknown> {
	if (!cell) return {};
	const data: Record<string, unknown> = {};
	if (typeof cell.value === "number") data.userEnteredValue = { numberValue: cell.value };
	else if (typeof cell.value === "string" && cell.value !== "") data.userEnteredValue = { stringValue: cell.value };

	const st = cell.style;
	if (st) {
		const fmt: Record<string, unknown> = {};
		if (st.bg) fmt.backgroundColorStyle = colorStyle(st.bg);
		const tf = textFormat(st, null);
		if (Object.keys(tf).length) fmt.textFormat = tf;
		if (st.hAlign) fmt.horizontalAlignment = H_ALIGN[st.hAlign];
		if (st.vAlign) fmt.verticalAlignment = V_ALIGN[st.vAlign];
		if (st.wrap === true) fmt.wrapStrategy = "WRAP";
		else if (st.wrap === false) fmt.wrapStrategy = "CLIP";
		if (st.borders) {
			const b: Record<string, unknown> = {};
			for (const side of ["top", "bottom", "left", "right"] as const) {
				const v = border(st.borders[side]);
				if (v) b[side] = v;
			}
			if (Object.keys(b).length) fmt.borders = b;
		}
		if (Object.keys(fmt).length) data.userEnteredFormat = fmt;
	}

	const text = typeof cell.value === "string" ? cell.value : "";
	const uri = cell.link ? linkUri(cell.link, sheetIds) : null;
	if (text && (cell.runs?.length || uri)) {
		const runs = (cell.runs?.length ? cell.runs : [{ start: 0 }]).filter((r) => r.start < text.length);
		if (uri && runs[0]?.start !== 0) runs.unshift({ start: 0 });
		// A link must cover the whole text to act as the cell's link, so every run carries it.
		data.textFormatRuns = runs.map((r) => ({ startIndex: r.start, format: textFormat(r, uri) }));
	}
	if (cell.note) data.note = cell.note;
	return data;
}

/** Contiguous runs of equal sizes → updateDimensionProperties requests. */
function dimensionRequests(
	sheetId: number,
	dimension: "ROWS" | "COLUMNS",
	count: number,
	defaultSize: number,
	overrides: Map<number, number>,
): SheetsRequest[] {
	const sizes: number[] = [];
	for (let i = 0; i < count; i++) sizes.push(Math.round(overrides.get(i) ?? defaultSize));
	const out: SheetsRequest[] = [];
	let start = 0;
	for (let i = 1; i <= count; i++) {
		if (i === count || sizes[i] !== sizes[start]) {
			out.push({
				updateDimensionProperties: {
					range: { sheetId, dimension, startIndex: start, endIndex: i },
					properties: { pixelSize: sizes[start] },
					fields: "pixelSize",
				},
			});
			start = i;
		}
	}
	return out;
}

export function addSheetRequest(sheet: SheetModel, sheetId: number, index: number): SheetsRequest {
	const properties: Record<string, unknown> = {
		sheetId,
		title: sheet.title,
		index,
		gridProperties: {
			rowCount: sheet.rowCount,
			columnCount: sheet.colCount,
			frozenRowCount: sheet.frozenRows,
			hideGridlines: sheet.hideGridlines,
		},
	};
	if (sheet.tabColor) properties.tabColorStyle = colorStyle(sheet.tabColor);
	return { addSheet: { properties } };
}

/** All requests that fill one (already added) sheet. */
export function sheetContentRequests(sheet: SheetModel, sheetIds: Map<string, number>): SheetsRequest[] {
	const sheetId = sheetIds.get(sheet.key) as number;
	const out: SheetsRequest[] = [
		...dimensionRequests(sheetId, "COLUMNS", sheet.colCount, sheet.defaultColWidth, sheet.colWidths),
		...dimensionRequests(sheetId, "ROWS", sheet.rowCount, sheet.defaultRowHeight, sheet.rowHeights),
	];

	// Cell values and formats, written row by row in chunks.
	let maxRow = -1;
	let maxCol = -1;
	for (const key of sheet.cells.keys()) {
		const [r, c] = parseCellKey(key);
		maxRow = Math.max(maxRow, r);
		maxCol = Math.max(maxCol, c);
	}
	for (let start = 0; start <= maxRow; start += ROWS_PER_UPDATE) {
		const end = Math.min(maxRow, start + ROWS_PER_UPDATE - 1);
		const rows: Record<string, unknown>[] = [];
		for (let r = start; r <= end; r++) {
			const values: Record<string, unknown>[] = [];
			let last = -1;
			for (let c = 0; c <= maxCol; c++) if (sheet.cells.has(`${r}:${c}`)) last = c;
			for (let c = 0; c <= last; c++) values.push(cellData(sheet.cells.get(`${r}:${c}`), sheetIds));
			rows.push(values.length ? { values } : {});
		}
		out.push({
			updateCells: {
				start: { sheetId, rowIndex: start, columnIndex: 0 },
				rows,
				fields: CELL_FIELDS,
			},
		});
	}

	for (const m of sheet.merges) out.push({ mergeCells: { range: gridRange(sheetId, m), mergeType: "MERGE_ALL" } });
	for (const o of sheet.outlines) {
		const b = border(o.line);
		out.push({ updateBorders: { range: gridRange(sheetId, o.range), top: b, bottom: b, left: b, right: b } });
	}
	if (sheet.filter) out.push({ setBasicFilter: { filter: { range: gridRange(sheetId, sheet.filter) } } });
	return out;
}

/** addSheet for every sheet (in order, starting at `startIndex`) followed by their content. */
export function buildSheetsRequests(model: WorkbookModel, sheetIds: Map<string, number>, startIndex = 0): SheetsRequest[] {
	const adds = model.sheets.map((s, i) => addSheetRequest(s, sheetIds.get(s.key) as number, startIndex + i));
	const content = model.sheets.flatMap((s) => sheetContentRequests(s, sheetIds));
	return [...adds, ...content];
}

/** Splits requests into batches that stay well below API payload limits, keeping their order. */
export function chunkRequests(requests: SheetsRequest[], maxBytes = 1_500_000, maxCount = 400): SheetsRequest[][] {
	const batches: SheetsRequest[][] = [];
	let current: SheetsRequest[] = [];
	let size = 0;
	for (const r of requests) {
		const bytes = JSON.stringify(r).length;
		if (current.length && (size + bytes > maxBytes || current.length >= maxCount)) {
			batches.push(current);
			current = [];
			size = 0;
		}
		current.push(r);
		size += bytes;
	}
	if (current.length) batches.push(current);
	return batches;
}
