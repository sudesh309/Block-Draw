/**
 * Backend-neutral spreadsheet model. The layout step turns a drawing into this model; the
 * Google Sheets request builder and the XLSX writer turn the model into their own formats.
 * Rows and columns are 0-based.
 */

export type HAlign = "left" | "center" | "right";
export type VAlign = "top" | "middle" | "bottom";
export type BorderStyle = "thin" | "medium" | "thick" | "dashed" | "dotted";

export interface BorderLine {
	style: BorderStyle;
	/** #rrggbb */
	color: string;
}

export interface CellBorders {
	top?: BorderLine;
	bottom?: BorderLine;
	left?: BorderLine;
	right?: BorderLine;
}

export interface CellStyle {
	/** Background, #rrggbb. */
	bg?: string;
	/** Text color, #rrggbb. */
	color?: string;
	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
	/** Points. */
	fontSize?: number;
	hAlign?: HAlign;
	vAlign?: VAlign;
	wrap?: boolean;
	borders?: CellBorders;
}

export type LinkTarget = { type: "sheet"; sheetKey: string } | { type: "url"; url: string };

/** Formatting for a run of characters starting at `start` (UTF-16 index) up to the next run. */
export interface TextRun {
	start: number;
	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
	color?: string;
	fontSize?: number;
}

export interface CellModel {
	value?: string | number;
	runs?: TextRun[];
	/** Link covering the whole cell. */
	link?: LinkTarget;
	note?: string;
	style?: CellStyle;
}

export interface GridRange {
	row: number;
	col: number;
	rows: number;
	cols: number;
}

export interface Outline {
	range: GridRange;
	line: BorderLine;
}

export interface SheetModel {
	/** Stable identifier used by links ("index", "frame:<id>", "blocks", ...). */
	key: string;
	title: string;
	rowCount: number;
	colCount: number;
	frozenRows: number;
	hideGridlines: boolean;
	/** #rrggbb */
	tabColor?: string;
	/** Pixels. */
	defaultColWidth: number;
	defaultRowHeight: number;
	colWidths: Map<number, number>;
	rowHeights: Map<number, number>;
	cells: Map<string, CellModel>;
	merges: GridRange[];
	/** Rectangle outlines (drawn after cells, so they win over cell borders). */
	outlines: Outline[];
	/** Range for a filter / table header row. */
	filter?: GridRange;
	/** Print setup (Excel/LibreOffice only): fit the sheet to one page wide (and tall). */
	print?: { landscape: boolean; fitHeight: boolean };
}

export interface WorkbookModel {
	title: string;
	sheets: SheetModel[];
}

export const cellKey = (row: number, col: number): string => `${row}:${col}`;

export function parseCellKey(key: string): [number, number] {
	const i = key.indexOf(":");
	return [Number(key.slice(0, i)), Number(key.slice(i + 1))];
}

export function newSheet(key: string, title: string, rowCount: number, colCount: number): SheetModel {
	return {
		key,
		title,
		rowCount,
		colCount,
		frozenRows: 0,
		hideGridlines: false,
		defaultColWidth: 100,
		defaultRowHeight: 21,
		colWidths: new Map(),
		rowHeights: new Map(),
		cells: new Map(),
		merges: [],
		outlines: [],
	};
}

/** Sets (or merges into) a cell. */
export function setCell(sheet: SheetModel, row: number, col: number, cell: CellModel): CellModel {
	const key = cellKey(row, col);
	const prev = sheet.cells.get(key);
	const next: CellModel = prev
		? { ...prev, ...cell, style: cell.style || prev.style ? { ...prev.style, ...cell.style } : undefined }
		: cell;
	if (prev?.style?.borders || cell.style?.borders) {
		next.style = { ...next.style, borders: { ...prev?.style?.borders, ...cell.style?.borders } };
	}
	sheet.cells.set(key, next);
	return next;
}

const INVALID_TITLE_CHARS = /[[\]*?/\\:]/g;

/** Sheet titles valid in both Google Sheets and Excel (max 31 chars, no []*?/\: ). */
export function sanitizeSheetTitle(raw: string, fallback: string): string {
	let t = (raw ?? "").replace(INVALID_TITLE_CHARS, " ").replace(/\s+/g, " ").trim();
	t = t.replace(/^'+|'+$/g, "").trim();
	if (!t) t = fallback;
	if (t.length > 31) t = t.slice(0, 31).trim();
	if (t.toLowerCase() === "history") t = "History (frame)";
	return t;
}

/** Makes titles unique (case-insensitive) by appending " (2)", " (3)", ... */
export class TitleAllocator {
	private used = new Set<string>();

	take(raw: string, fallback: string): string {
		const base = sanitizeSheetTitle(raw, fallback);
		let title = base;
		for (let n = 2; this.used.has(title.toLowerCase()); n++) {
			const suffix = ` (${n})`;
			title = base.slice(0, 31 - suffix.length).trimEnd() + suffix;
		}
		this.used.add(title.toLowerCase());
		return title;
	}
}

/** "A", "B", ... "Z", "AA", ... for 0-based column indexes. */
export function columnLetter(col: number): string {
	let n = col + 1;
	let s = "";
	while (n > 0) {
		const m = (n - 1) % 26;
		s = String.fromCharCode(65 + m) + s;
		n = Math.floor((n - 1) / 26);
	}
	return s;
}

export function a1(row: number, col: number): string {
	return `${columnLetter(col)}${row + 1}`;
}
