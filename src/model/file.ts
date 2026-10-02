import { newId } from "./ids";
import { FONT_IDS } from "../render/fonts";
import {
	BLOCK_SHAPES,
	DEFAULT_BLOCK_STYLE,
	DEFAULT_CONNECTOR_STYLE,
	DEFAULT_FRAME_STYLE,
	FILE_FORMAT,
	FILE_VERSION,
	type AnchorSide,
	type ArrowHead,
	type BlockElement,
	type BlockShape,
	type ConnectorElement,
	type DrawElement,
	type DrawingFile,
	type FrameElement,
	type Routing,
	type StrokeStyle,
	type TextAlign,
} from "./types";

export class DrawingParseError extends Error {}

export function createEmptyDrawing(): DrawingFile {
	return { type: FILE_FORMAT, version: FILE_VERSION, elements: [] };
}

type Raw = Record<string, unknown>;

const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
const bool = (v: unknown, d: boolean): boolean => (typeof v === "boolean" ? v : d);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], d: T): T =>
	typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : d;

const STROKE_STYLES: StrokeStyle[] = ["solid", "dashed", "dotted"];
const ROUTINGS: Routing[] = ["elbow", "straight", "curved"];
const ARROWS: ArrowHead[] = ["none", "arrow", "triangle", "dot"];
const ALIGNS: TextAlign[] = ["left", "center", "right"];
const ANCHORS: AnchorSide[] = ["auto", "top", "right", "bottom", "left"];

function normalizeBlock(raw: Raw): BlockElement {
	const s = isObj(raw.style) ? raw.style : {};
	return {
		id: str(raw.id) || newId(),
		type: "block",
		x: num(raw.x, 0),
		y: num(raw.y, 0),
		width: Math.max(1, num(raw.width, 160)),
		height: Math.max(1, num(raw.height, 80)),
		title: str(raw.title),
		description: str(raw.description),
		descriptionOpen: bool(raw.descriptionOpen, true),
		shape: oneOf<BlockShape>(raw.shape, BLOCK_SHAPES, "rounded"),
		frameId: typeof raw.frameId === "string" && raw.frameId ? raw.frameId : null,
		link: typeof raw.link === "string" && raw.link.trim() ? raw.link.trim() : null,
		tag: str(raw.tag),
		comment: str(raw.comment),
		commentOpen: bool(raw.commentOpen, false),
		style: {
			fill: str(s.fill, DEFAULT_BLOCK_STYLE.fill),
			stroke: str(s.stroke, DEFAULT_BLOCK_STYLE.stroke),
			strokeWidth: Math.max(0, num(s.strokeWidth, DEFAULT_BLOCK_STYLE.strokeWidth)),
			strokeStyle: oneOf(s.strokeStyle, STROKE_STYLES, DEFAULT_BLOCK_STYLE.strokeStyle),
			textColor: str(s.textColor, DEFAULT_BLOCK_STYLE.textColor),
			fontSize: Math.max(4, num(s.fontSize, DEFAULT_BLOCK_STYLE.fontSize)),
			textAlign: oneOf(s.textAlign, ALIGNS, DEFAULT_BLOCK_STYLE.textAlign),
			threeD: bool(s.threeD, DEFAULT_BLOCK_STYLE.threeD),
			fontFamily: oneOf(s.fontFamily, FONT_IDS, DEFAULT_BLOCK_STYLE.fontFamily),
		},
	};
}

function normalizeFrame(raw: Raw): FrameElement {
	const s = isObj(raw.style) ? raw.style : {};
	return {
		id: str(raw.id) || newId(),
		type: "frame",
		x: num(raw.x, 0),
		y: num(raw.y, 0),
		width: Math.max(1, num(raw.width, 400)),
		height: Math.max(1, num(raw.height, 300)),
		title: str(raw.title, "Frame"),
		description: str(raw.description),
		style: {
			fill: str(s.fill, DEFAULT_FRAME_STYLE.fill),
			stroke: str(s.stroke, DEFAULT_FRAME_STYLE.stroke),
		},
	};
}

function normalizeConnector(raw: Raw): ConnectorElement | null {
	const from = isObj(raw.from) ? raw.from : null;
	const to = isObj(raw.to) ? raw.to : null;
	if (!from || !to || typeof from.id !== "string" || typeof to.id !== "string") return null;
	const s = isObj(raw.style) ? raw.style : {};
	return {
		id: str(raw.id) || newId(),
		type: "connector",
		from: { id: from.id, side: oneOf(from.side, ANCHORS, "auto") },
		to: { id: to.id, side: oneOf(to.side, ANCHORS, "auto") },
		label: str(raw.label),
		routing: oneOf(raw.routing, ROUTINGS, "elbow"),
		comment: str(raw.comment),
		commentOpen: bool(raw.commentOpen, false),
		style: {
			stroke: str(s.stroke, DEFAULT_CONNECTOR_STYLE.stroke),
			strokeWidth: Math.max(0.5, num(s.strokeWidth, DEFAULT_CONNECTOR_STYLE.strokeWidth)),
			strokeStyle: oneOf(s.strokeStyle, STROKE_STYLES, DEFAULT_CONNECTOR_STYLE.strokeStyle),
			startArrow: oneOf(s.startArrow, ARROWS, DEFAULT_CONNECTOR_STYLE.startArrow),
			endArrow: oneOf(s.endArrow, ARROWS, DEFAULT_CONNECTOR_STYLE.endArrow),
			threeD: bool(s.threeD, DEFAULT_CONNECTOR_STYLE.threeD),
			flow: bool(s.flow, DEFAULT_CONNECTOR_STYLE.flow),
		},
	};
}

/**
 * Validates and repairs a list of raw elements: fills in defaults, drops duplicates,
 * connectors with missing ends, and frame references that point nowhere.
 */
export function normalizeElements(rawList: unknown[]): DrawElement[] {
	const out: DrawElement[] = [];
	const seen = new Set<string>();
	for (const raw of rawList) {
		if (!isObj(raw)) continue;
		let el: DrawElement | null = null;
		if (raw.type === "block") el = normalizeBlock(raw);
		else if (raw.type === "frame") el = normalizeFrame(raw);
		else if (raw.type === "connector") el = normalizeConnector(raw);
		if (!el) continue;
		if (seen.has(el.id)) el = { ...el, id: newId() };
		seen.add(el.id);
		out.push(el);
	}
	const frames = new Set(out.filter((e) => e.type === "frame").map((e) => e.id));
	const blocks = new Set(out.filter((e) => e.type === "block").map((e) => e.id));
	return out
		.filter((el) => el.type !== "connector" || (blocks.has(el.from.id) && blocks.has(el.to.id) && el.from.id !== el.to.id))
		.map((el) => (el.type === "block" && el.frameId && !frames.has(el.frameId) ? { ...el, frameId: null } : el));
}

export function parseDrawing(text: string): DrawingFile {
	if (!text || !text.trim()) return createEmptyDrawing();
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch (e) {
		throw new DrawingParseError(`This file is not valid JSON: ${(e as Error).message}`);
	}
	if (!isObj(data)) throw new DrawingParseError("This file does not contain a Block Draw drawing.");
	if (data.type !== undefined && data.type !== FILE_FORMAT) {
		throw new DrawingParseError(`Unsupported drawing type ${JSON.stringify(data.type)}.`);
	}
	const elements = Array.isArray(data.elements) ? normalizeElements(data.elements) : [];
	return { ...data, type: FILE_FORMAT, version: FILE_VERSION, elements };
}

/**
 * Serializes with one element per line: compact, yet diff-friendly for vaults kept in git.
 */
export function serializeDrawing(file: DrawingFile): string {
	const { elements, ...rest } = file;
	const head = { ...rest, type: FILE_FORMAT, version: FILE_VERSION };
	const lines: string[] = ["{"];
	for (const [key, value] of Object.entries(head)) {
		if (value === undefined) continue;
		lines.push(`\t${JSON.stringify(key)}: ${JSON.stringify(value)},`);
	}
	if (elements.length === 0) {
		lines.push('\t"elements": []');
	} else {
		lines.push('\t"elements": [');
		elements.forEach((el, i) => {
			lines.push(`\t\t${JSON.stringify(el)}${i < elements.length - 1 ? "," : ""}`);
		});
		lines.push("\t]");
	}
	lines.push("}");
	return lines.join("\n") + "\n";
}
