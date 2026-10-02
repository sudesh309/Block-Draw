import { textInsets } from "../geometry/shapes";
import type { BlockElement } from "../model/types";
import { fontStack } from "./fonts";

export const FONT_FAMILY =
	'Inter, "Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", Arial, sans-serif';
export const LINE_HEIGHT = 1.25;
export const DESCRIPTION_SCALE = 0.8;
/** Tag (stereotype) line above the title, relative to the title size. */
export const TAG_SCALE = 0.62;

type MeasureFn = (text: string, size: number, weight: number, font?: string) => number;

let measureImpl: MeasureFn | null = null;
const cache = new Map<string, number>();

/** Rough width estimate used when no canvas is available (tests, workers). */
function estimate(text: string, size: number, weight: number, _font?: string): number {
	let w = 0;
	for (const ch of text) {
		if (/[ilj.,:;'|!]/.test(ch)) w += 0.3;
		else if (/[mwMW@]/.test(ch)) w += 0.85;
		else if (/[A-Z0-9]/.test(ch)) w += 0.64;
		else if (ch === " ") w += 0.28;
		else if (ch.charCodeAt(0) > 0x2e80) w += 1;
		else w += 0.52;
	}
	return w * size * (weight >= 600 ? 1.06 : 1);
}

function getMeasure(): MeasureFn {
	if (measureImpl) return measureImpl;
	if (typeof document !== "undefined") {
		try {
			const ctx = document.createElement("canvas").getContext("2d");
			if (ctx) {
				measureImpl = (text, size, weight, font) => {
					ctx.font = `${weight} ${size}px ${font || FONT_FAMILY}`;
					return ctx.measureText(text).width;
				};
				return measureImpl;
			}
		} catch {
			// fall through to the estimate
		}
	}
	measureImpl = estimate;
	return measureImpl;
}

/** Overrides text measurement (tests use a deterministic estimate). */
export function setTextMeasure(fn: MeasureFn | null): void {
	measureImpl = fn;
	cache.clear();
}

export function useEstimatedTextMeasure(): void {
	setTextMeasure(estimate);
}

export function measureText(text: string, size: number, weight = 400, font?: string): number {
	const key = `${weight}|${size}|${font ?? ""}|${text}`;
	let w = cache.get(key);
	if (w === undefined) {
		w = getMeasure()(text, size, weight, font);
		if (cache.size > 5000) cache.clear();
		cache.set(key, w);
	}
	return w;
}

/** Greedy word wrap honoring explicit newlines; words longer than a line are broken. */
export function wrapText(text: string, maxWidth: number, size: number, weight = 400, font?: string): string[] {
	const lines: string[] = [];
	const width = Math.max(maxWidth, size);
	for (const paragraph of text.split(/\r?\n/)) {
		if (paragraph.trim() === "") {
			lines.push("");
			continue;
		}
		const tokens = paragraph.split(/(\s+)/).filter((t) => t.length > 0);
		let line = "";
		for (const token of tokens) {
			const candidate = line + token;
			if (measureText(candidate.trimEnd(), size, weight, font) <= width) {
				line = candidate;
				continue;
			}
			if (/^\s+$/.test(token)) {
				// whitespace that does not fit: end the line here
				lines.push(line.trimEnd());
				line = "";
				continue;
			}
			if (line.trim()) lines.push(line.trimEnd());
			line = "";
			if (measureText(token, size, weight, font) <= width) {
				line = token;
				continue;
			}
			// break an over-long word into chunks
			let chunk = "";
			for (const ch of token) {
				if (chunk && measureText(chunk + ch, size, weight, font) > width) {
					lines.push(chunk);
					chunk = "";
				}
				chunk += ch;
			}
			line = chunk;
		}
		lines.push(line.trimEnd());
	}
	return lines;
}

export interface LaidOutLine {
	text: string;
	x: number;
	/** Baseline y, relative to the block's top-left corner. */
	y: number;
	size: number;
	weight: number;
	muted: boolean;
	/** Tag line: small caps with letter spacing. */
	tag?: boolean;
}

export interface BlockTextLayout {
	lines: LaidOutLine[];
	anchor: "start" | "middle" | "end";
	/** Height needed to show all text, including the shape's own insets. */
	requiredHeight: number;
}

export function titleWeight(block: BlockElement): number {
	return block.description.trim() ? 600 : 500;
}

export function layoutBlockText(block: BlockElement): BlockTextLayout {
	const inner = textInsets(block.shape, block.width, block.height);
	const font = fontStack(block.style.fontFamily);
	const size = block.style.fontSize;
	const dsize = Math.max(8, Math.round(size * DESCRIPTION_SCALE));
	const weight = titleWeight(block);
	const tsize = Math.max(8, Math.round(size * TAG_SCALE));
	const tag = block.tag.trim().toUpperCase();
	const tagLines = tag ? wrapText(tag, inner.width, tsize, 600, font) : [];
	const tlh = tsize * LINE_HEIGHT;
	const titleLines = block.title ? wrapText(block.title, inner.width, size, weight, font) : [];
	const desc = block.description.trim();
	const descLines = desc ? wrapText(desc, inner.width, dsize, 400, font) : [];
	const lh = size * LINE_HEIGHT;
	const dlh = dsize * LINE_HEIGHT;
	const gap = titleLines.length && descLines.length ? size * 0.35 : 0;
	const tagGap = tagLines.length && (titleLines.length || descLines.length) ? size * 0.2 : 0;
	const total = tagLines.length * tlh + tagGap + titleLines.length * lh + gap + descLines.length * dlh;

	const align = block.style.textAlign;
	const anchor = align === "left" ? "start" : align === "right" ? "end" : "middle";
	const x = align === "left" ? inner.x : align === "right" ? inner.x + inner.width : inner.x + inner.width / 2;

	let top = inner.y + Math.max(0, (inner.height - total) / 2);
	const lines: LaidOutLine[] = [];
	for (const t of tagLines) {
		lines.push({ text: t, x, y: top + tlh / 2 + tsize * 0.35, size: tsize, weight: 600, muted: true, tag: true });
		top += tlh;
	}
	top += tagGap;
	for (const t of titleLines) {
		lines.push({ text: t, x, y: top + lh / 2 + size * 0.35, size, weight, muted: false });
		top += lh;
	}
	top += gap;
	for (const t of descLines) {
		lines.push({ text: t, x, y: top + dlh / 2 + dsize * 0.35, size: dsize, weight: 400, muted: true });
		top += dlh;
	}
	const extra = block.height - inner.height;
	return { lines, anchor, requiredHeight: Math.ceil(total + extra) };
}
