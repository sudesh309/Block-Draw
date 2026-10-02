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

export interface ExportBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

export type ExportLink =
	| { type: "frame"; frameId: string; frameTitle: string | null }
	| { type: "note"; target: string; display: string }
	| { type: "url"; url: string };

export interface ExportBlock {
	id: string;
	title: string;
	/** Stereotype / technology tag shown above the title (empty when none). */
	tag: string;
	description: string;
	/** False when the description is hidden on the canvas (it is still exported). */
	descriptionOpen: boolean;
	comment: string;
	commentOpen: boolean;
	shape: string;
	/** Position relative to the frame's top-left corner (canvas coordinates for unframed blocks). */
	bounds: ExportBounds;
	/** Absolute canvas position. */
	canvasBounds: ExportBounds;
	style: BlockElement["style"];
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
	side: string;
}

export interface ExportConnection {
	id: string;
	from: ExportConnectionEnd;
	to: ExportConnectionEnd;
	label: string;
	comment: string;
	commentOpen: boolean;
	routing: string;
	style: ConnectorElement["style"];
}

export interface ExportFrame {
	id: string;
	order: number;
	title: string;
	description: string;
	bounds: ExportBounds;
	style: FrameElement["style"];
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
	version: 1;
	name: string;
	exportedAt: string;
	frames: ExportFrame[];
	/** Blocks that are not inside any frame. */
	unframed: { blocks: ExportBlock[]; connections: ExportConnection[] };
	/** Connections between blocks in different frames (or between a frame and the canvas). */
	crossFrameConnections: ExportConnection[];
	stats: { frames: number; blocks: number; connections: number };
}

const round = (n: number) => Math.round(n * 100) / 100;

function bounds(b: ExportBounds, origin?: { x: number; y: number }): ExportBounds {
	return {
		x: round(b.x - (origin?.x ?? 0)),
		y: round(b.y - (origin?.y ?? 0)),
		width: round(b.width),
		height: round(b.height),
	};
}

/** Reading order: top to bottom, then left to right (rows grouped within half a block). */
export function readingOrder<T extends ExportBounds>(items: T[]): T[] {
	return [...items].sort((a, b) => {
		const rowTolerance = Math.min(a.height, b.height) / 2;
		if (Math.abs(a.y - b.y) > rowTolerance) return a.y - b.y;
		return a.x - b.x;
	});
}

export function exportStructuredJson(file: DrawingFile, opts: { name: string; now?: Date }): StructuredExport {
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

	const exportBlock = (b: BlockElement, origin?: FrameElement): ExportBlock => {
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
			descriptionOpen: b.descriptionOpen,
			comment: b.comment,
			commentOpen: b.commentOpen,
			shape: b.shape,
			bounds: bounds(b, origin),
			canvasBounds: bounds(b),
			style: { ...b.style },
			link,
			outgoing: outgoing.get(b.id) ?? [],
			incoming: incoming.get(b.id) ?? [],
		};
	};

	const end = (id: string, side: string): ExportConnectionEnd => {
		const b = byId.get(id) as BlockElement;
		return { blockId: id, blockTitle: b.title, frameId: b.frameId, frameTitle: frameTitle(b.frameId), side };
	};

	const exportConnection = (c: ConnectorElement): ExportConnection => ({
		id: c.id,
		from: end(c.from.id, c.from.side),
		to: end(c.to.id, c.to.side),
		label: c.label,
		comment: c.comment,
		commentOpen: c.commentOpen,
		routing: c.routing,
		style: { ...c.style },
	});

	const frameOf = (blockId: string) => (byId.get(blockId) as BlockElement).frameId;
	const valid = connectors.filter((c) => isBlock(byId.get(c.from.id)) && isBlock(byId.get(c.to.id)));

	const exportFrames: ExportFrame[] = frames.map((f, i) => {
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
			bounds: bounds(f),
			style: { ...f.style },
			blocks: own.map((b) => exportBlock(b, f)),
			connections: valid.filter((c) => frameOf(c.from.id) === f.id && frameOf(c.to.id) === f.id).map(exportConnection),
			linksTo: [...linksTo].map(([frameId, title]) => ({ frameId, title })),
			linkedFrom: [...linkedFrom].map(([frameId, title]) => ({ frameId, title })),
		};
	});

	const loose = readingOrder(blocks.filter((b) => !b.frameId));
	return {
		format: "block-draw/export",
		version: 1,
		name: opts.name,
		exportedAt: (opts.now ?? new Date()).toISOString(),
		frames: exportFrames,
		unframed: {
			blocks: loose.map((b) => exportBlock(b)),
			connections: valid.filter((c) => !frameOf(c.from.id) && !frameOf(c.to.id)).map(exportConnection),
		},
		crossFrameConnections: valid.filter((c) => frameOf(c.from.id) !== frameOf(c.to.id)).map(exportConnection),
		stats: { frames: frames.length, blocks: blocks.length, connections: valid.length },
	};
}

export type JsonExportFormat = "structured" | "raw";

export function exportJsonText(file: DrawingFile, format: JsonExportFormat, name: string): string {
	if (format === "raw") return serializeDrawing(file);
	return JSON.stringify(exportStructuredJson(file, { name }), null, 2) + "\n";
}
