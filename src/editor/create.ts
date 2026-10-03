import type { Point } from "../geometry/geom";
import { newId } from "../model/ids";
import { assignFrames, refreshFrameMembership } from "../model/ops";
import {
	DEFAULT_BLOCK_SIZE,
	isBlock,
	type AnchorSide,
	type BlockElement,
	type BlockShape,
	type Bounds,
	type ConnectorElement,
	type DrawElement,
	type FrameElement,
	type Side,
} from "../model/types";
import { contentBounds } from "../render/scene";
import type { Editor } from "./Editor";

/** Creating elements: blocks, frames and connectors, with the current style. */

export function makeBlock(ed: Editor, bounds: Bounds, patch: Partial<BlockElement> = {}): BlockElement {
	return {
		id: newId(),
		type: "block",
		x: bounds.x,
		y: bounds.y,
		width: Math.max(20, bounds.width),
		height: Math.max(20, bounds.height),
		title: "",
		description: "",
		descriptionOpen: true,
		shape: ed.toolShape,
		frameId: null,
		link: null,
		tag: "",
		comment: "",
		commentOpen: false,
		style: { ...ed.current.block },
		...patch,
	};
}

/** Adds a default-size block centered on `p` and starts editing its title. */
export function addBlockAt(ed: Editor, p: Point, opts: { shape?: BlockShape; edit?: boolean } = {}): BlockElement {
	const shape = opts.shape ?? (ed.tool === "block" ? ed.toolShape : ed.current.shape);
	const { width, height } = DEFAULT_BLOCK_SIZE;
	const topLeft = ed.snapPoint({ x: p.x - width / 2, y: p.y - height / 2 });
	const block = ed.makeBlock({ x: topLeft.x, y: topLeft.y, width, height }, { shape });
	ed.insertBlocks([block]);
	if (opts.edit !== false) ed.textEditor.start(block.id);
	return ed.byId.get(block.id) as BlockElement;
}

export function insertBlocks(ed: Editor, blocks: BlockElement[], extra: DrawElement[] = []): void {
	const next = assignFrames([...ed.elements, ...blocks, ...extra], blocks.map((b) => b.id));
	ed.commit(next, { selection: blocks.map((b) => b.id) });
}

export function addFrame(ed: Editor, bounds: Bounds, opts: { edit?: boolean } = {}): FrameElement {
	const n = ed.frames().length + 1;
	let title = `Frame ${n}`;
	const titles = new Set(ed.frames().map((f) => f.title.toLowerCase()));
	for (let i = n; titles.has(title.toLowerCase()); i++) title = `Frame ${i + 1}`;
	const frame: FrameElement = {
		id: newId(),
		type: "frame",
		...bounds,
		title,
		description: "",
		style: { ...ed.current.frame },
	};
	// Frames go below existing frames' content in the array but after other frames.
	const next = refreshFrameMembership([...ed.elements, frame], frame.id);
	ed.commit(next, { selection: [frame.id] });
	if (opts.edit) ed.textEditor.start(frame.id);
	return frame;
}

/** Adds a frame to the right of all existing content and navigates to it. */
export function addFrameAfterContent(ed: Editor): FrameElement {
	const b = contentBounds(ed.elements);
	const size = ed.viewSize();
	const width = Math.max(480, Math.round((size.width * 0.6) / ed.vp.zoom / 20) * 20);
	const height = Math.max(320, Math.round((size.height * 0.6) / ed.vp.zoom / 20) * 20);
	const x = b ? ed.snapValue(b.x + b.width + 80) : 0;
	const y = b ? ed.snapValue(b.y + 40) : 0;
	const frame = ed.addFrame({ x, y, width, height });
	ed.navigateToFrame(frame.id, { remember: false, select: true });
	return frame;
}

export function connect(ed: Editor, fromId: string, toId: string, opts: { fromSide?: AnchorSide; toSide?: AnchorSide; select?: boolean } = {}): ConnectorElement | null {
	if (fromId === toId) return null;
	const conn: ConnectorElement = {
		id: newId(),
		type: "connector",
		from: { id: fromId, side: opts.fromSide ?? "auto" },
		to: { id: toId, side: opts.toSide ?? "auto" },
		label: "",
		routing: ed.current.routing,
		comment: "",
		commentOpen: false,
		style: { ...ed.current.connector },
	};
	ed.commit([...ed.elements, conn], { selection: opts.select ? [conn.id] : ed.selection });
	return conn;
}

/**
 * Creates a new block next to `fromId` (in direction `side`, or at `at`) connected to it,
 * then starts editing its title. Mirrors draw.io's quick-connect.
 */
export function createConnectedBlock(ed: Editor, fromId: string, side: Side | null, at?: Point): BlockElement | null {
	const from = ed.byId.get(fromId);
	if (!isBlock(from)) return null;
	const gap = 80;
	let x: number;
	let y: number;
	if (at) {
		x = at.x - from.width / 2;
		y = at.y - from.height / 2;
	} else {
		const s = side ?? "right";
		x = s === "right" ? from.x + from.width + gap : s === "left" ? from.x - from.width - gap : from.x;
		y = s === "bottom" ? from.y + from.height + gap : s === "top" ? from.y - from.height - gap : from.y;
	}
	const pos = ed.snapPoint({ x, y });
	const block: BlockElement = {
		...ed.makeBlock({ x: pos.x, y: pos.y, width: from.width, height: from.height }),
		shape: from.shape,
		style: { ...from.style },
	};
	const conn: ConnectorElement = {
		id: newId(),
		type: "connector",
		from: { id: from.id, side: "auto" },
		to: { id: block.id, side: "auto" },
		label: "",
		routing: ed.current.routing,
		comment: "",
		commentOpen: false,
		style: { ...ed.current.connector },
	};
	ed.insertBlocks([block], [conn]);
	ed.textEditor.start(block.id);
	return block;
}
