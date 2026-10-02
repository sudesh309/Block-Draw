import { serializeDrawing } from "../model/file";
import { parseLink } from "../model/links";
import { indexById } from "../model/ops";
import {
	isBlock,
	isConnector,
	isFrame,
	type BlockElement,
	type ConnectorElement,
	type DrawingFile,
	type FrameElement,
} from "../model/types";

/** Position and size on the canvas; only used to put blocks in reading order, never exported. */
interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

export type ExportLink =
	| { type: "frame"; frameId: string; frameTitle: string | null }
	| { type: "note"; target: string; display: string }
	| { type: "url"; url: string };

/*
 * The structured export describes what the diagram says, not how it looks: no colors, line or font
 * styles, positions, sizes, routing, shown/hidden flags or drawing name. The raw format is the drawing
 * file itself for anything that needs those.
 */

export interface ExportBlock {
	id: string;
	title: string;
	/** Stereotype / technology tag shown above the title (empty when none). */
	tag: string;
	description: string;
	comment: string;
	shape: string;
	link: ExportLink | null;
	/** Ids of connections leaving / entering this block. */
	outgoing: string[];
	incoming: string[];
}

export interface ExportConnectionEnd {
	blockId: string;
	blockTitle: string;
	frameId: string | null;
	frameTitle: string | null;
}

export interface ExportConnection {
	id: string;
	from: ExportConnectionEnd;
	to: ExportConnectionEnd;
	label: string;
	comment: string;
}

export interface ExportFrame {
	id: string;
	order: number;
	title: string;
	description: string;
	blocks: ExportBlock[];
	/** Connections whose two ends are inside this frame. */
	connections: ExportConnection[];
	/** Frames that blocks in this frame link to. */
	linksTo: { frameId: string; title: string }[];
	/** Frames containing blocks that link to this frame. */
	linkedFrom: { frameId: string; title: string }[];
}

export interface StructuredExport {
	format: "block-draw/export";
	version: 2;
	frames: ExportFrame[];
	/** Blocks that are not inside any frame. */
	unframed: { blocks: ExportBlock[]; connections: ExportConnection[] };
	/** Connections between blocks in different frames (or between a frame and the unframed blocks). */
	crossFrameConnections: ExportConnection[];
	stats: { frames: number; blocks: number; connections: number };
}

/** Reading order: top to bottom, then left to right (rows grouped within half a block). */
export function readingOrder<T extends Box>(items: T[]): T[] {
	return [...items].sort((a, b) => {
		const rowTolerance = Math.min(a.height, b.height) / 2;
		if (Math.abs(a.y - b.y) > rowTolerance) return a.y - b.y;
		return a.x - b.x;
	});
}

export function exportStructuredJson(file: DrawingFile): StructuredExport {
	const els = file.elements;
	const byId = indexById(els);
	const frames = els.filter(isFrame);
	const blocks = els.filter(isBlock);
	const connectors = els.filter(isConnector);
	const frameTitle = (id: string | null) => {
		const f = id ? byId.get(id) : null;
		return isFrame(f) ? f.title : null;
	};

	const outgoing = new Map<string, string[]>();
	const incoming = new Map<string, string[]>();
	for (const c of connectors) {
		if (!outgoing.has(c.from.id)) outgoing.set(c.from.id, []);
		if (!incoming.has(c.to.id)) incoming.set(c.to.id, []);
		outgoing.get(c.from.id)?.push(c.id);
		incoming.get(c.to.id)?.push(c.id);
	}

	const exportBlock = (b: BlockElement): ExportBlock => {
		const parsed = parseLink(b.link);
		let link: ExportLink | null = null;
		if (parsed?.kind === "frame") link = { type: "frame", frameId: parsed.frameId, frameTitle: frameTitle(parsed.frameId) };
		else if (parsed?.kind === "note") link = { type: "note", target: parsed.linktext, display: parsed.display };
		else if (parsed?.kind === "url") link = { type: "url", url: parsed.url };
		return {
			id: b.id,
			title: b.title,
			tag: b.tag,
			description: b.description,
			comment: b.comment,
			shape: b.shape,
			link,
			outgoing: outgoing.get(b.id) ?? [],
			incoming: incoming.get(b.id) ?? [],
		};
	};

	const end = (id: string): ExportConnectionEnd => {
		const b = byId.get(id) as BlockElement;
		return { blockId: id, blockTitle: b.title, frameId: b.frameId, frameTitle: frameTitle(b.frameId) };
	};

	const exportConnection = (c: ConnectorElement): ExportConnection => ({
		id: c.id,
		from: end(c.from.id),
		to: end(c.to.id),
		label: c.label,
		comment: c.comment,
	});

	const frameOf = (blockId: string) => (byId.get(blockId) as BlockElement).frameId;
	const valid = connectors.filter((c) => isBlock(byId.get(c.from.id)) && isBlock(byId.get(c.to.id)));

	const exportFrames: ExportFrame[] = frames.map((f: FrameElement, i) => {
		const own = readingOrder(blocks.filter((b) => b.frameId === f.id));
		const linksTo = new Map<string, string>();
		for (const b of own) {
			const target = parseLink(b.link);
			if (target?.kind === "frame" && target.frameId !== f.id) {
				const title = frameTitle(target.frameId);
				if (title !== null) linksTo.set(target.frameId, title);
			}
		}
		const linkedFrom = new Map<string, string>();
		for (const b of blocks) {
			const target = parseLink(b.link);
			if (target?.kind === "frame" && target.frameId === f.id && b.frameId && b.frameId !== f.id) {
				linkedFrom.set(b.frameId, frameTitle(b.frameId) ?? "");
			}
		}
		return {
			id: f.id,
			order: i + 1,
			title: f.title,
			description: f.description,
			blocks: own.map(exportBlock),
			connections: valid.filter((c) => frameOf(c.from.id) === f.id && frameOf(c.to.id) === f.id).map(exportConnection),
			linksTo: [...linksTo].map(([frameId, title]) => ({ frameId, title })),
			linkedFrom: [...linkedFrom].map(([frameId, title]) => ({ frameId, title })),
		};
	});

	const loose = readingOrder(blocks.filter((b) => !b.frameId));
	return {
		format: "block-draw/export",
		version: 2,
		frames: exportFrames,
		unframed: {
			blocks: loose.map(exportBlock),
			connections: valid.filter((c) => !frameOf(c.from.id) && !frameOf(c.to.id)).map(exportConnection),
		},
		crossFrameConnections: valid.filter((c) => frameOf(c.from.id) !== frameOf(c.to.id)).map(exportConnection),
		stats: { frames: frames.length, blocks: blocks.length, connections: valid.length },
	};
}

export type JsonExportFormat = "structured" | "raw";

export function exportJsonText(file: DrawingFile, format: JsonExportFormat): string {
	if (format === "raw") return serializeDrawing(file);
	return JSON.stringify(exportStructuredJson(file), null, 2) + "\n";
}
