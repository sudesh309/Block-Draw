import type { BlockElement } from "../model/types";
import { resolveStroke, resolveTextColor, type RenderTheme } from "./colors";
import { fontStack } from "./fonts";
import { LINE_HEIGHT, measureText } from "./text";
import { h, type VNode } from "./vnode";

const CELL_PAD_X = 8;
const MAX_COLUMN = 260;
const MIN_COLUMN = 36;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Natural size of a table in canvas units: wide enough for its text (columns up to 260), one line per row. */
export function tableSize(table: string[][], fontSize: number): { width: number; height: number } {
	const widths = columnWidths(table, fontSize);
	return { width: widths.reduce((a, b) => a + b, 0), height: table.length * rowHeight(fontSize) };
}

function rowHeight(fontSize: number): number {
	return Math.ceil(fontSize * LINE_HEIGHT + 12);
}

function columnWidths(table: string[][], fontSize: number): number[] {
	return table[0].map((_, c) => {
		const widest = Math.max(...table.map((row, r) => measureText(row[c] ?? "", fontSize, r === 0 ? 600 : 400)));
		return Math.min(MAX_COLUMN, Math.max(MIN_COLUMN, Math.ceil(widest + 2 * CELL_PAD_X)));
	});
}

/** Cuts text with an ellipsis until it fits. */
function fit(text: string, size: number, weight: number, width: number): string {
	if (measureText(text, size, weight) <= width) return text;
	let s = text;
	while (s.length > 1 && measureText(`${s}…`, size, weight) > width) s = s.slice(0, -1);
	return `${s}…`;
}

/** What a block shows besides its shape and text: its picture and its table, if it has them. */
export function renderMedia(block: BlockElement, theme: RenderTheme): VNode[] {
	return [renderImage(block), renderTable(block, theme)].filter((n): n is VNode => n !== null);
}

/** The picture of a block, scaled to fit inside it. */
export function renderImage(block: BlockElement): VNode | null {
	if (!block.image) return null;
	return h("image", { class: "bd-image", href: block.image, x: 0, y: 0, width: r2(block.width), height: r2(block.height), preserveAspectRatio: "xMidYMid meet" });
}

/**
 * The table of a block: its columns share the block's width in proportion to their text, its rows share
 * the height, and the first row is the header. Text that does not fit is cut with an ellipsis.
 */
export function renderTable(block: BlockElement, theme: RenderTheme): VNode | null {
	const table = block.table;
	if (!table) return null;
	const { fontSize, fontFamily, strokeWidth } = block.style;
	const natural = columnWidths(table, fontSize);
	const total = natural.reduce((a, b) => a + b, 0);
	const widths = natural.map((w) => (w / total) * block.width);
	const rowH = block.height / table.length;
	const ink = resolveStroke(block.style.stroke, theme);
	const lineWidth = Math.max(0.5, Math.min(strokeWidth, 1.5));
	const textColor = resolveTextColor(block.style.textColor, block.style.fill, theme);
	const nodes: VNode[] = [h("rect", { x: 0, y: 0, width: r2(block.width), height: r2(rowH), style: `fill:${ink};fill-opacity:0.12`, "pointer-events": "none" })];
	let grid = "";
	let x = 0;
	for (const w of widths.slice(0, -1)) {
		x += w;
		grid += `M${r2(x)} 0V${r2(block.height)}`;
	}
	for (let r = 1; r < table.length; r++) grid += `M0 ${r2(r * rowH)}H${r2(block.width)}`;
	if (grid) nodes.push(h("path", { d: grid, style: `fill:none;stroke:${ink};stroke-opacity:0.5;stroke-width:${lineWidth}`, "pointer-events": "none" }));
	const texts: VNode[] = [];
	table.forEach((row, r) => {
		let left = 0;
		row.forEach((cell, c) => {
			const weight = r === 0 ? 600 : 400;
			const text = fit(cell.replace(/\s+/g, " "), fontSize, weight, widths[c] - 2 * CELL_PAD_X);
			if (text) {
				texts.push(h("tspan", { x: r2(left + CELL_PAD_X), y: r2(r * rowH + rowH / 2 + fontSize * 0.35), style: `font-size:${fontSize}px;font-weight:${weight}` }, [text]));
			}
			left += widths[c];
		});
	});
	nodes.push(h("text", { class: "bd-text bd-table-text", style: `fill:${textColor};font-family:${fontStack(fontFamily)}`, "pointer-events": "none" }, texts));
	return h("g", { class: "bd-table" }, nodes);
}
