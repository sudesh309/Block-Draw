import { expand, segmentCrossesBox, unionBounds, type Point } from "../../geometry/geom";
import { routeConnector, type RouteEndpoint } from "../../geometry/routing";
import { parseLink } from "../../model/links";
import { indexById } from "../../model/ops";
import {
	isBlock,
	isConnector,
	isFrame,
	type AnchorSide,
	type BlockElement,
	type Bounds,
	type ConnectorElement,
	type DrawingFile,
	type FrameElement,
	type Side,
	type StrokeStyle,
} from "../../model/types";
import { LIGHT_THEME, resolveTextColor, toHex6 } from "../../render/colors";
import { measureText } from "../../render/text";
import { readingOrder } from "../json";
import {
	cellKey,
	newSheet,
	setCell,
	TitleAllocator,
	type BorderLine,
	type BorderStyle,
	type CellModel,
	type GridRange,
	type HAlign,
	type LinkTarget,
	type SheetModel,
	type TextRun,
	type VAlign,
	type WorkbookModel,
} from "./model";

export interface WorkbookOptions {
	title: string;
	/** Canvas units represented by one grid cell. */
	cellSize: number;
	/** Pixel width/height of a grid cell in the sheet. */
	cellPixels: number;
	includeIndex: boolean;
	includeDataSheets: boolean;
	includeUnframed: boolean;
	/** Turns a vault link (`Note#Heading`) into a URL, e.g. an obsidian:// link. */
	resolveNoteUrl?: (linktext: string) => string | null;
}

export const DEFAULT_WORKBOOK_OPTIONS = {
	cellSize: 20,
	cellPixels: 20,
	includeIndex: true,
	includeDataSheets: true,
	includeUnframed: true,
};

export const SHEET_KEYS = {
	index: "index",
	unframed: "unframed",
	blocks: "blocks",
	connections: "connections",
	frame: (id: string) => `frame:${id}`,
};

/** Name of the sheet (and of the "frame" column value) for blocks that are not inside a frame. */
const UNFRAMED_TITLE = "Unframed";

const MAX_GRID_COLS = 160;
const MAX_GRID_ROWS = 400;
/** First grid row/column of the drawing area on a frame sheet. */
export const ORIGIN_ROW = 3;
export const ORIGIN_COL = 1;

const INK = "#1e1e1e";
const LINK_COLOR = "#1971c2";
const MUTED = "#868e96";
const HEADER_BG = "#f1f3f5";
const FRAME_LINE = "#adb5bd";

interface Region {
	key: string;
	title: string;
	frame: FrameElement | null;
	bounds: Bounds;
	blocks: BlockElement[];
	description: string;
}

interface GridRect {
	c0: number;
	r0: number;
	c1: number;
	r1: number;
}

interface Context {
	opts: WorkbookOptions & typeof DEFAULT_WORKBOOK_OPTIONS;
	byId: Map<string, unknown>;
	blocks: BlockElement[];
	connectors: ConnectorElement[];
	sheetTitles: Map<string, string>;
	frameTitle: (id: string | null) => string | null;
	regionOf: Map<string, string>;
}

/* ------------------------------------------------------------- helpers */

function hex(color: string | null | undefined, fallback?: string): string | undefined {
	return toHex6(color) ?? fallback;
}

function strokeHex(color: string): string {
	return !color || color === "default" ? INK : (toHex6(color) ?? INK);
}

export function borderStyleFor(width: number, style: StrokeStyle): BorderStyle {
	if (style === "dashed") return "dashed";
	if (style === "dotted") return "dotted";
	if (width >= 3.5) return "thick";
	if (width >= 1.5) return "medium";
	return "thin";
}

function linkTargetFor(block: BlockElement, ctx: Context): LinkTarget | null {
	const parsed = parseLink(block.link);
	if (!parsed) return null;
	if (parsed.kind === "frame") {
		const key = SHEET_KEYS.frame(parsed.frameId);
		return ctx.sheetTitles.has(key) ? { type: "sheet", sheetKey: key } : null;
	}
	if (parsed.kind === "url") return { type: "url", url: parsed.url };
	const url = ctx.opts.resolveNoteUrl?.(parsed.linktext);
	return url ? { type: "url", url } : null;
}

function linkLabel(block: BlockElement, ctx: Context): string | null {
	const parsed = parseLink(block.link);
	if (!parsed) return null;
	if (parsed.kind === "frame") return ctx.frameTitle(parsed.frameId) ?? "(missing frame)";
	if (parsed.kind === "note") return parsed.display;
	try {
		return new URL(parsed.url).host || parsed.url;
	} catch {
		return parsed.url;
	}
}

function blockLabel(id: string, ctx: Context): string {
	const b = ctx.byId.get(id) as BlockElement | undefined;
	return b ? b.title.trim() || "(untitled)" : "(missing)";
}

/** Human readable list of a block's connections for notes and data sheets. */
function connectionSummary(block: BlockElement, ctx: Context): { outgoing: string[]; incoming: string[] } {
	const outgoing: string[] = [];
	const incoming: string[] = [];
	for (const c of ctx.connectors) {
		if (c.from.id === block.id) {
			const other = ctx.byId.get(c.to.id) as BlockElement;
			const where = other.frameId !== block.frameId ? ` [${ctx.frameTitle(other.frameId) ?? UNFRAMED_TITLE}]` : "";
			outgoing.push(`→ ${blockLabel(c.to.id, ctx)}${where}${c.label ? ` (${c.label})` : ""}`);
		}
		if (c.to.id === block.id) {
			const other = ctx.byId.get(c.from.id) as BlockElement;
			const where = other.frameId !== block.frameId ? ` [${ctx.frameTitle(other.frameId) ?? UNFRAMED_TITLE}]` : "";
			incoming.push(`← ${blockLabel(c.from.id, ctx)}${where}${c.label ? ` (${c.label})` : ""}`);
		}
	}
	return { outgoing, incoming };
}

/* -------------------------------------------------------------- layout */

export function buildWorkbook(file: DrawingFile, options: Partial<WorkbookOptions> & { title: string }): WorkbookModel {
	const opts = { ...DEFAULT_WORKBOOK_OPTIONS, ...options };
	const els = file.elements;
	const byId = indexById(els);
	const frames = els.filter(isFrame);
	const blocks = els.filter(isBlock);
	const connectors = els.filter(isConnector).filter((c) => isBlock(byId.get(c.from.id)) && isBlock(byId.get(c.to.id)));
	const frameTitle = (id: string | null) => {
		const f = id ? byId.get(id) : null;
		return isFrame(f) ? f.title || "Frame" : null;
	};

	const regions: Region[] = frames.map((f) => ({
		key: SHEET_KEYS.frame(f.id),
		title: f.title,
		frame: f,
		bounds: f,
		blocks: blocks.filter((b) => b.frameId === f.id),
		description: f.description,
	}));
	const loose = blocks.filter((b) => !b.frameId || !isFrame(byId.get(b.frameId)));
	if (opts.includeUnframed && loose.length) {
		const ub = expand(unionBounds(loose) as Bounds, opts.cellSize * 2);
		const snapDown = (v: number) => Math.floor(v / opts.cellSize) * opts.cellSize;
		const x = snapDown(ub.x);
		const y = snapDown(ub.y);
		regions.push({
			key: SHEET_KEYS.unframed,
			title: UNFRAMED_TITLE,
			frame: null,
			bounds: { x, y, width: ub.x + ub.width - x, height: ub.y + ub.height - y },
			blocks: loose,
			description: "Blocks that are not inside a frame",
		});
	}

	const titles = new TitleAllocator();
	const sheetTitles = new Map<string, string>();
	if (opts.includeIndex) sheetTitles.set(SHEET_KEYS.index, titles.take("Index", "Index"));
	regions.forEach((r, i) => sheetTitles.set(r.key, titles.take(r.title, `Frame ${i + 1}`)));
	if (opts.includeDataSheets) {
		sheetTitles.set(SHEET_KEYS.blocks, titles.take("Blocks", "Blocks"));
		sheetTitles.set(SHEET_KEYS.connections, titles.take("Connections", "Connections"));
	}

	const regionOf = new Map<string, string>();
	for (const r of regions) for (const b of r.blocks) regionOf.set(b.id, r.key);

	const ctx: Context = { opts, byId, blocks, connectors, sheetTitles, frameTitle, regionOf };
	const sheets: SheetModel[] = [];
	if (opts.includeIndex) sheets.push(buildIndexSheet(regions, ctx));
	for (const r of regions) sheets.push(buildRegionSheet(r, ctx));
	if (opts.includeDataSheets) {
		sheets.push(buildBlocksSheet(regions, ctx));
		sheets.push(buildConnectionsSheet(ctx));
	}
	if (sheets.length === 0) {
		// An empty drawing still produces a valid workbook.
		const s = newSheet(SHEET_KEYS.index, "Index", 10, 4);
		setCell(s, 0, 0, { value: "This drawing has no blocks yet." });
		sheets.push(s);
	}
	return { title: opts.title, sheets };
}

/* ----------------------------------------------------------- index sheet */

function buildIndexSheet(regions: Region[], ctx: Context): SheetModel {
	const s = newSheet(SHEET_KEYS.index, ctx.sheetTitles.get(SHEET_KEYS.index) as string, Math.max(20, regions.length + 10), 6);
	const widths = [40, 230, 70, 100, 260, 320];
	widths.forEach((w, i) => s.colWidths.set(i, w));
	const header = ["#", "Frame", "Blocks", "Connections", "Links to", "Description"];
	const line: BorderLine = { style: "thin", color: "#ced4da" };
	header.forEach((h, i) =>
		setCell(s, 0, i, { value: h, style: { bold: true, bg: HEADER_BG, borders: { bottom: line }, vAlign: "middle" } }),
	);
	s.rowHeights.set(0, 26);
	s.frozenRows = 1;
	s.print = { landscape: true, fitHeight: false };
	let row = 1;
	regions.forEach((r, i) => {
		const blockIds = new Set(r.blocks.map((b) => b.id));
		const inner = ctx.connectors.filter((c) => blockIds.has(c.from.id) && blockIds.has(c.to.id)).length;
		const linksTo = new Set<string>();
		for (const b of r.blocks) {
			const p = parseLink(b.link);
			if (p?.kind === "frame") {
				const t = ctx.frameTitle(p.frameId);
				if (t && p.frameId !== r.frame?.id) linksTo.add(t);
			}
		}
		setCell(s, row, 0, { value: r.frame ? i + 1 : "–", style: { hAlign: "center", color: MUTED } });
		setCell(s, row, 1, {
			value: ctx.sheetTitles.get(r.key),
			link: { type: "sheet", sheetKey: r.key },
			runs: [{ start: 0, underline: true, color: LINK_COLOR }],
			style: { bold: true },
		});
		setCell(s, row, 2, { value: r.blocks.length, style: { hAlign: "center" } });
		setCell(s, row, 3, { value: inner, style: { hAlign: "center" } });
		setCell(s, row, 4, { value: [...linksTo].join(", "), style: { wrap: true } });
		setCell(s, row, 5, { value: r.description, style: { wrap: true, color: "#495057" } });
		row++;
	});
	if (ctx.opts.includeDataSheets) {
		row++;
		setCell(s, row, 1, {
			value: ctx.sheetTitles.get(SHEET_KEYS.blocks),
			link: { type: "sheet", sheetKey: SHEET_KEYS.blocks },
			runs: [{ start: 0, underline: true, color: LINK_COLOR }],
		});
		setCell(s, row, 2, { value: "All blocks as a table", style: { color: MUTED, italic: true } });
		row++;
		setCell(s, row, 1, {
			value: ctx.sheetTitles.get(SHEET_KEYS.connections),
			link: { type: "sheet", sheetKey: SHEET_KEYS.connections },
			runs: [{ start: 0, underline: true, color: LINK_COLOR }],
		});
		setCell(s, row, 2, { value: "All connections as a table", style: { color: MUTED, italic: true } });
	}
	s.rowCount = Math.max(s.rowCount, row + 5);
	return s;
}

/* ----------------------------------------------------------- frame sheet */

interface Placement {
	sheet: SheetModel;
	occupied: Set<string>;
	rows: number;
	cols: number;
}

function isFree(p: Placement, row: number, col: number, rows: number, cols: number): boolean {
	if (row < 0 || col < 0 || row + rows > p.sheet.rowCount || col + cols > p.sheet.colCount) return false;
	for (let r = row; r < row + rows; r++) {
		for (let c = col; c < col + cols; c++) if (p.occupied.has(cellKey(r, c))) return false;
	}
	return true;
}

function occupy(p: Placement, row: number, col: number, rows: number, cols: number): void {
	for (let r = row; r < row + rows; r++) for (let c = col; c < col + cols; c++) p.occupied.add(cellKey(r, c));
}

function placeMerged(p: Placement, range: GridRange, cell: CellModel): boolean {
	if (!isFree(p, range.row, range.col, range.rows, range.cols)) return false;
	occupy(p, range.row, range.col, range.rows, range.cols);
	if (range.rows > 1 || range.cols > 1) p.sheet.merges.push(range);
	setCell(p.sheet, range.row, range.col, cell);
	return true;
}

/** Gap, in narrow grid columns, between the visual grid and the textual block table beside it. */
const TABLE_GAP_COLS = 2;

function buildRegionSheet(region: Region, ctx: Context): SheetModel {
	const { opts } = ctx;
	const unit = Math.max(opts.cellSize, region.bounds.width / MAX_GRID_COLS, region.bounds.height / MAX_GRID_ROWS);
	const k = opts.cellPixels / unit;
	const cols = Math.max(1, Math.ceil(region.bounds.width / unit - 1e-9));
	const rows = Math.max(1, Math.ceil(region.bounds.height / unit - 1e-9));
	const headerCols = Math.max(cols, 16);
	const tableStartCol = ORIGIN_COL + headerCols + TABLE_GAP_COLS;
	const sheet = newSheet(
		region.key,
		ctx.sheetTitles.get(region.key) as string,
		Math.max(ORIGIN_ROW + rows + 3, region.blocks.length + 2),
		tableStartCol + BLOCK_TABLE_HEADERS.length,
	);
	sheet.defaultColWidth = opts.cellPixels;
	sheet.defaultRowHeight = opts.cellPixels;
	sheet.hideGridlines = true;
	sheet.print = { landscape: cols >= rows, fitHeight: true };
	sheet.rowHeights.set(0, Math.max(34, opts.cellPixels));
	sheet.rowHeights.set(1, Math.max(22, opts.cellPixels));
	const frameColor = region.frame && region.frame.style.stroke !== "default" ? hex(region.frame.style.stroke) : undefined;
	if (frameColor) sheet.tabColor = frameColor;

	const p: Placement = { sheet, occupied: new Set(), rows, cols };

	// Header: title, back link, description.
	placeMerged(p, { row: 0, col: ORIGIN_COL, rows: 1, cols: headerCols }, {
		value: region.title || sheet.title,
		style: { bold: true, fontSize: 14, vAlign: "middle" },
	});
	let navCol = ORIGIN_COL;
	if (opts.includeIndex) {
		placeMerged(p, { row: 1, col: ORIGIN_COL, rows: 1, cols: 5 }, {
			value: "← Index",
			link: { type: "sheet", sheetKey: SHEET_KEYS.index },
			runs: [{ start: 0, underline: true, color: LINK_COLOR }],
			style: { fontSize: 9, vAlign: "middle" },
		});
		navCol += 6;
	}
	const desc = region.description.trim();
	if (desc && headerCols + ORIGIN_COL - navCol > 0) {
		placeMerged(p, { row: 1, col: navCol, rows: 1, cols: headerCols + ORIGIN_COL - navCol }, {
			value: desc.replace(/\s*\n\s*/g, " · "),
			style: { italic: true, fontSize: 9, color: MUTED, vAlign: "middle" },
		});
	}

	// Drawing area: background and outline.
	const fill = region.frame ? hex(region.frame.style.fill) : undefined;
	if (fill) {
		for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) setCell(sheet, ORIGIN_ROW + r, ORIGIN_COL + c, { style: { bg: fill } });
	}
	sheet.outlines.push({
		range: { row: ORIGIN_ROW, col: ORIGIN_COL, rows, cols },
		line: { style: "thin", color: frameColor ?? FRAME_LINE },
	});

	// Blocks, topmost first so they win overlaps.
	const ox = region.bounds.x;
	const oy = region.bounds.y;
	const rects = new Map<string, GridRect>();
	const topFirst = [...region.blocks].reverse();
	for (const b of topFirst) {
		let c0 = Math.round((b.x - ox) / unit);
		let r0 = Math.round((b.y - oy) / unit);
		let c1 = Math.round((b.x + b.width - ox) / unit);
		let r1 = Math.round((b.y + b.height - oy) / unit);
		c0 = Math.min(Math.max(c0, 0), cols - 1);
		r0 = Math.min(Math.max(r0, 0), rows - 1);
		c1 = Math.min(Math.max(c1, c0 + 1), cols);
		r1 = Math.min(Math.max(r1, r0 + 1), rows);
		rects.set(b.id, { c0, r0, c1, r1 });
		const range: GridRange = { row: ORIGIN_ROW + r0, col: ORIGIN_COL + c0, rows: r1 - r0, cols: c1 - c0 };
		const { main, link, combined } = blockCells(b, k, ctx);
		// A linked block gets its own one-line link cell in its last row: spreadsheet apps then
		// keep the title's formatting, and the link is an obvious click target.
		const split = link && range.rows >= 2 && isFree(p, range.row, range.col, range.rows, range.cols);
		const placed = split
			? placeMerged(p, { ...range, rows: range.rows - 1 }, main) &&
				placeMerged(p, { ...range, row: range.row + range.rows - 1, rows: 1 }, link)
			: placeMerged(p, range, combined);
		const cell = combined;
		if (placed) {
			if (b.shape !== "text" && b.style.strokeWidth > 0) {
				sheet.outlines.push({ range, line: { style: borderStyleFor(b.style.strokeWidth, b.style.strokeStyle), color: strokeHex(b.style.stroke) } });
			}
		} else {
			// Overlapping blocks: put the text in the first free cell of its area.
			outer: for (let r = range.row; r < range.row + range.rows; r++) {
				for (let c = range.col; c < range.col + range.cols; c++) {
					if (isFree(p, r, c, 1, 1)) {
						occupy(p, r, c, 1, 1);
						setCell(sheet, r, c, { ...cell, style: { ...cell.style, wrap: false } });
						break outer;
					}
				}
			}
		}
	}

	// Connectors inside this region.
	const inRegion = new Set(region.blocks.map((b) => b.id));
	const obstacles = [...rects.values()];
	const usedEdges = new Set<string>();
	for (const c of ctx.connectors) {
		if (!inRegion.has(c.from.id) || !inRegion.has(c.to.id)) continue;
		const a = rects.get(c.from.id);
		const b = rects.get(c.to.id);
		if (!a || !b) continue;
		drawGridConnector(p, c, a, b, opts.cellPixels, obstacles, usedEdges);
	}

	addFrameBlockTable(sheet, region, ctx, tableStartCol);
	return sheet;
}

/**
 * Textual table of this frame's blocks — title, tag, what it links to and from, description and
 * comment — placed beside the visual grid so the frame reads without the diagram too.
 */
const BLOCK_TABLE_HEADERS = ["Block Title", "Tag", "LinkTo", "LinkFrom", "Block Description", "Notes"];
const BLOCK_TABLE_WIDTHS = [180, 130, 220, 220, 240, 240];

function addFrameBlockTable(sheet: SheetModel, region: Region, ctx: Context, startCol: number): void {
	BLOCK_TABLE_HEADERS.forEach((h, i) => {
		setCell(sheet, 0, startCol + i, { value: h, style: { bold: true, bg: HEADER_BG, borders: { bottom: TABLE_LINE }, vAlign: "middle" } });
		sheet.colWidths.set(startCol + i, BLOCK_TABLE_WIDTHS[i]);
	});
	sheet.rowHeights.set(0, Math.max(sheet.rowHeights.get(0) ?? 0, 26));
	const ordered = readingOrder(region.blocks);
	ordered.forEach((b, i) => {
		const row = i + 1;
		const { outgoing, incoming } = connectionSummary(b, ctx);
		setCell(sheet, row, startCol, { value: b.title.trim() || "(untitled)", style: { bold: true, wrap: true, vAlign: "top" } });
		setCell(sheet, row, startCol + 1, { value: b.tag.trim(), style: { wrap: true, vAlign: "top" } });
		setCell(sheet, row, startCol + 2, { value: outgoing.join("\n"), style: { wrap: true, vAlign: "top" } });
		setCell(sheet, row, startCol + 3, { value: incoming.join("\n"), style: { wrap: true, vAlign: "top" } });
		setCell(sheet, row, startCol + 4, { value: b.description, style: { wrap: true, vAlign: "top" } });
		setCell(sheet, row, startCol + 5, { value: b.comment, style: { wrap: true, vAlign: "top" } });
		for (let c = 0; c < BLOCK_TABLE_HEADERS.length; c++) {
			setCell(sheet, row, startCol + c, { style: { borders: { bottom: { style: "thin", color: "#e9ecef" } } } });
		}
	});
	sheet.filter = { row: 0, col: startCol, rows: Math.max(1, ordered.length + 1), cols: BLOCK_TABLE_HEADERS.length };
}

/**
 * Cell content for a block: `main` (title and description) plus a separate one-line `link`
 * cell when the block links somewhere, or `combined` with everything in one cell for blocks
 * too small to split.
 */
function blockCells(b: BlockElement, k: number, ctx: Context): { main: CellModel; link: CellModel | null; combined: CellModel } {
	const titlePt = Math.max(6, Math.min(36, Math.round(b.style.fontSize * k * 0.75)));
	const smallPt = Math.max(6, Math.round(titlePt * 0.85));
	const title = b.title.trim();
	const tag = b.tag.trim();
	// The grid mirrors the drawing, so a hidden description is left out here; the tables keep it.
	const desc = b.descriptionOpen ? b.description.trim() : "";
	const target = linkTargetFor(b, ctx);
	const targetLabel = b.link ? linkLabel(b, ctx) : null;
	const color = hex(resolveTextColor(b.style.textColor, b.style.fill, LIGHT_THEME), INK) as string;
	const bg = hex(b.style.fill);
	const hAlign: HAlign = b.style.textAlign;
	const vAlign: VAlign = b.style.textVAlign;

	const { outgoing, incoming } = connectionSummary(b, ctx);
	const noteLines: string[] = [];
	if (b.comment.trim()) noteLines.push(`Comment: ${b.comment.trim()}`);
	if (targetLabel) noteLines.push(`Link: ${targetLabel}`);
	if (outgoing.length) noteLines.push(`Outgoing:\n${outgoing.join("\n")}`);
	if (incoming.length) noteLines.push(`Incoming:\n${incoming.join("\n")}`);
	const note = noteLines.length ? `${title || "Block"}\n\n${noteLines.join("\n\n")}` : undefined;

	const textCell = (withLinkLine: boolean): CellModel => {
		const runs: TextRun[] = [];
		let text = "";
		const push = (part: string, run: Omit<TextRun, "start">) => {
			if (text) text += "\n";
			runs.push({ start: text.length, ...run });
			text += part;
		};
		const titleBold = !!desc || !!targetLabel;
		if (tag) push(tag, { italic: true, fontSize: smallPt, color });
		if (title) push(title, { bold: titleBold, underline: withLinkLine && !!target, fontSize: titlePt, color });
		if (desc) push(desc, { fontSize: smallPt, color });
		if (withLinkLine && targetLabel) push(`→ ${targetLabel}`, { italic: true, fontSize: smallPt, color: target ? LINK_COLOR : MUTED });
		const linked = withLinkLine && !!target;
		return {
			value: text,
			runs: runs.length > 1 || linked || titleBold ? runs : undefined,
			link: linked ? target : undefined,
			note,
			style: { bg, color, fontSize: titlePt, hAlign, vAlign, wrap: true },
		};
	};

	const link: CellModel | null =
		target && targetLabel
			? {
					value: `→ ${targetLabel}`,
					link: target,
					runs: [{ start: 0, italic: true, underline: true, color: LINK_COLOR, fontSize: smallPt }],
					style: { bg, color: LINK_COLOR, fontSize: smallPt, hAlign, vAlign: "top", wrap: false },
				}
			: null;
	return { main: textCell(!link), link, combined: textCell(true) };
}

/** Integer anchor in the middle of a side of a grid rectangle. */
function gridAnchor(ep: RouteEndpoint, side: Side): Point {
	const { x, y, width, height } = ep.bounds;
	const mx = x + Math.floor(width / 2);
	const my = y + Math.floor(height / 2);
	if (side === "top") return { x: mx, y };
	if (side === "bottom") return { x: mx, y: y + height };
	if (side === "left") return { x, y: my };
	return { x: x + width, y: my };
}

function glyphFor(kind: string, dir: Point): string {
	// ► and ◄ instead of ▶/◀, which many fonts draw as color emoji.
	if (kind === "dot") return "●";
	if (dir.x > 0) return "►";
	if (dir.x < 0) return "◄";
	if (dir.y > 0) return "▼";
	return "▲";
}

const rectBounds = (r: GridRect): Bounds => ({ x: r.c0, y: r.r0, width: r.c1 - r.c0, height: r.r1 - r.r0 });

/** Unit edges already drawn on a sheet ("h:x:y" / "v:x:y" in grid coordinates). */
function unitEdges(points: Point[]): string[] {
	const out: string[] = [];
	for (let i = 1; i < points.length; i++) {
		const s = points[i - 1];
		const e = points[i];
		if (s.y === e.y) for (let x = Math.min(s.x, e.x); x < Math.max(s.x, e.x); x++) out.push(`h:${x}:${s.y}`);
		else if (s.x === e.x) for (let y = Math.min(s.y, e.y); y < Math.max(s.y, e.y); y++) out.push(`v:${s.x}:${y}`);
	}
	return out;
}

function drawGridConnector(
	p: Placement,
	c: ConnectorElement,
	a: GridRect,
	b: GridRect,
	cellPixels: number,
	obstacles: GridRect[],
	usedEdges: Set<string>,
): void {
	const ep = (r: GridRect, side: AnchorSide): RouteEndpoint => ({ bounds: rectBounds(r), shape: "rectangle", side });
	const others = obstacles.filter((o) => o !== a && o !== b).map(rectBounds);
	const route = routeConnector("elbow", ep(a, c.from.side), ep(b, c.to.side), {
		stub: 1,
		quantize: (v) => Math.round(v),
		anchor: gridAnchor,
		// Lines are drawn with cell borders, so going through another block hides the line and
		// sharing an edge with another connector makes the two indistinguishable.
		extraCost: (pts) => {
			let cost = 0;
			for (let i = 1; i < pts.length; i++) {
				for (const o of others) if (segmentCrossesBox(pts[i - 1], pts[i], o)) cost += 400;
			}
			for (const e of unitEdges(pts.map((pt) => ({ x: Math.round(pt.x), y: Math.round(pt.y) })))) if (usedEdges.has(e)) cost += 30;
			return cost;
		},
	});
	for (const e of unitEdges(route.points.map((pt) => ({ x: Math.round(pt.x), y: Math.round(pt.y) })))) usedEdges.add(e);
	const pts = route.points.map((pt) => ({ x: Math.round(pt.x) + ORIGIN_COL, y: Math.round(pt.y) + ORIGIN_ROW }));
	if (pts.length < 2) return;
	const color = strokeHex(c.style.stroke);
	const line: BorderLine = { style: borderStyleFor(c.style.strokeWidth, c.style.strokeStyle), color };
	const glyphPt = Math.max(6, Math.round(cellPixels * 0.5));

	const placeArrow = (tip: Point, dir: Point, kind: string) => {
		if (kind === "none") return;
		const glyph = glyphFor(kind, dir);
		let range: GridRange;
		let single: [number, number];
		let hAlign: HAlign = "center";
		let vAlign: VAlign = "middle";
		if (dir.x > 0) {
			range = { row: tip.y - 1, col: tip.x - 1, rows: 2, cols: 1 };
			single = [tip.y, tip.x - 1];
			hAlign = "right";
		} else if (dir.x < 0) {
			range = { row: tip.y - 1, col: tip.x, rows: 2, cols: 1 };
			single = [tip.y, tip.x];
			hAlign = "left";
		} else if (dir.y > 0) {
			range = { row: tip.y - 1, col: tip.x - 1, rows: 1, cols: 2 };
			single = [tip.y - 1, tip.x];
			vAlign = "bottom";
		} else {
			range = { row: tip.y, col: tip.x - 1, rows: 1, cols: 2 };
			single = [tip.y, tip.x];
			vAlign = "top";
		}
		const cell: CellModel = { value: glyph, style: { color, fontSize: glyphPt, hAlign, vAlign, wrap: false } };
		if (!placeMerged(p, range, cell) && isFree(p, single[0], single[1], 1, 1)) {
			occupy(p, single[0], single[1], 1, 1);
			setCell(p.sheet, single[0], single[1], cell);
		}
	};
	const n = route.points.length;
	const tipEnd = pts[n - 1];
	const tipStart = pts[0];
	placeArrow(tipEnd, route.endDir, c.style.endArrow);
	placeArrow(tipStart, route.startDir, c.style.startArrow);

	if (c.label.trim()) placeLabel(p, pts, c.label.trim(), color, cellPixels, c.comment.trim() || undefined);

	// Line: one border per unit edge, on a free cell next to the edge.
	const edge = (candidates: [number, number, "top" | "bottom" | "left" | "right"][]) => {
		for (const [r, col, side] of candidates) {
			if (r < 0 || col < 0 || r >= p.sheet.rowCount || col >= p.sheet.colCount) continue;
			if (p.occupied.has(cellKey(r, col))) continue;
			setCell(p.sheet, r, col, { style: { borders: { [side]: line } } });
			return;
		}
	};
	for (let i = 1; i < pts.length; i++) {
		const s = pts[i - 1];
		const e = pts[i];
		if (s.y === e.y) {
			for (let x = Math.min(s.x, e.x); x < Math.max(s.x, e.x); x++) {
				edge([
					[s.y, x, "top"],
					[s.y - 1, x, "bottom"],
				]);
			}
		} else if (s.x === e.x) {
			for (let y = Math.min(s.y, e.y); y < Math.max(s.y, e.y); y++) {
				edge([
					[y, s.x, "left"],
					[y, s.x - 1, "right"],
				]);
			}
		}
	}
}

function placeLabel(p: Placement, pts: Point[], text: string, color: string, cellPixels: number, note?: string): void {
	// Longest segment hosts the label, centered on the line (merged cells hide the line under it).
	let best = 1;
	let bestLen = -1;
	for (let i = 1; i < pts.length; i++) {
		const len = Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y);
		if (len > bestLen) {
			bestLen = len;
			best = i;
		}
	}
	const s = pts[best - 1];
	const e = pts[best];
	const firstLine = text.split(/\r?\n/)[0];
	const widthCells = Math.max(2, Math.min(14, Math.ceil((measureText(firstLine, 12) + 10) / cellPixels)));
	const cell: CellModel = {
		value: text.replace(/\s*\n\s*/g, " "),
		note: note ? `Comment: ${note}` : undefined,
		style: { color, fontSize: 9, hAlign: "center", vAlign: "middle", wrap: false, bg: "#ffffff" },
	};
	const tries = [0, 1, -1, 2, -2, 3, -3];
	if (s.y === e.y) {
		const mid = Math.round((s.x + e.x) / 2);
		for (const t of tries) {
			const range = { row: s.y - 1, col: mid - Math.floor(widthCells / 2) + t, rows: 2, cols: widthCells };
			if (placeMerged(p, range, cell)) return;
		}
	} else {
		const mid = Math.round((s.y + e.y) / 2);
		const half = Math.ceil(widthCells / 2);
		for (const t of tries) {
			const range = { row: mid + t, col: s.x - half, rows: 1, cols: half * 2 };
			if (placeMerged(p, range, cell)) return;
		}
	}
}

/* ------------------------------------------------------------ data sheets */

const TABLE_LINE: BorderLine = { style: "thin", color: "#ced4da" };

function tableHeader(s: SheetModel, headers: string[], widths: number[]): void {
	headers.forEach((h, i) => {
		setCell(s, 0, i, { value: h, style: { bold: true, bg: HEADER_BG, borders: { bottom: TABLE_LINE }, vAlign: "middle" } });
		s.colWidths.set(i, widths[i]);
	});
	s.frozenRows = 1;
	s.rowHeights.set(0, 26);
	s.print = { landscape: true, fitHeight: false };
}

function sheetLink(ctx: Context, key: string | undefined, label: string): CellModel {
	if (!key || !ctx.sheetTitles.has(key)) return { value: label };
	return { value: label, link: { type: "sheet", sheetKey: key }, runs: [{ start: 0, underline: true, color: LINK_COLOR }] };
}

function buildBlocksSheet(regions: Region[], ctx: Context): SheetModel {
	const ordered: BlockElement[] = [];
	for (const r of regions) ordered.push(...readingOrder(r.blocks));
	for (const b of ctx.blocks) if (!ctx.regionOf.has(b.id)) ordered.push(b);
	const columns = ["Frame", "Block", "Tag", "Description", "Shape", "Links to", "Outgoing", "Incoming", "Comment"];
	const s = newSheet(SHEET_KEYS.blocks, ctx.sheetTitles.get(SHEET_KEYS.blocks) as string, ordered.length + 6, columns.length);
	tableHeader(s, columns, [160, 200, 140, 260, 90, 180, 220, 220, 240]);
	ordered.forEach((b, i) => {
		const row = i + 1;
		const regionKey = ctx.regionOf.get(b.id);
		const regionTitle = regionKey ? (ctx.sheetTitles.get(regionKey) ?? "") : "";
		setCell(s, row, 0, sheetLink(ctx, regionKey, regionTitle));
		setCell(s, row, 1, { value: b.title, style: { bold: true, wrap: true } });
		setCell(s, row, 2, { value: b.tag.trim(), style: { wrap: true } });
		setCell(s, row, 3, { value: b.description, style: { wrap: true } });
		setCell(s, row, 4, { value: b.shape });
		const label = b.link ? linkLabel(b, ctx) : null;
		const target = linkTargetFor(b, ctx);
		if (label) {
			setCell(s, row, 5, target ? { value: label, link: target, runs: [{ start: 0, underline: true, color: LINK_COLOR }] } : { value: label });
		}
		const { outgoing, incoming } = connectionSummary(b, ctx);
		setCell(s, row, 6, { value: outgoing.join("\n"), style: { wrap: true } });
		setCell(s, row, 7, { value: incoming.join("\n"), style: { wrap: true } });
		setCell(s, row, 8, { value: b.comment, style: { wrap: true } });
		for (let c = 0; c < columns.length; c++) {
			setCell(s, row, c, { style: { vAlign: "top", borders: { bottom: { style: "thin", color: "#e9ecef" } } } });
		}
	});
	s.filter = { row: 0, col: 0, rows: Math.max(1, ordered.length + 1), cols: columns.length };
	return s;
}

function buildConnectionsSheet(ctx: Context): SheetModel {
	const columns = ["From frame", "From", "Label", "To", "To frame", "Comment"];
	const s = newSheet(SHEET_KEYS.connections, ctx.sheetTitles.get(SHEET_KEYS.connections) as string, ctx.connectors.length + 6, columns.length);
	tableHeader(s, columns, [160, 200, 140, 200, 160, 240]);
	ctx.connectors.forEach((c, i) => {
		const row = i + 1;
		const fromKey = ctx.regionOf.get(c.from.id);
		const toKey = ctx.regionOf.get(c.to.id);
		setCell(s, row, 0, sheetLink(ctx, fromKey, fromKey ? (ctx.sheetTitles.get(fromKey) ?? "") : ""));
		setCell(s, row, 1, { value: blockLabel(c.from.id, ctx), style: { bold: true } });
		setCell(s, row, 2, { value: c.label, style: { italic: true } });
		setCell(s, row, 3, { value: blockLabel(c.to.id, ctx), style: { bold: true } });
		setCell(s, row, 4, sheetLink(ctx, toKey, toKey ? (ctx.sheetTitles.get(toKey) ?? "") : ""));
		setCell(s, row, 5, { value: c.comment, style: { wrap: true } });
		for (let col = 0; col < columns.length; col++) setCell(s, row, col, { style: { borders: { bottom: { style: "thin", color: "#e9ecef" } } } });
	});
	s.filter = { row: 0, col: 0, rows: Math.max(1, ctx.connectors.length + 1), cols: columns.length };
	return s;
}
