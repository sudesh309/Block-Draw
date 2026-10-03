import { unionBounds } from "../geometry/geom";
import {
	assignFrames,
	cloneElements,
	collectForCopy,
	deleteElements,
	expandMoveSet,
	insertClones,
	reorderElements,
	translateElements,
	updateElements,
	type ElementPatch,
	type ZOrderMode,
} from "../model/ops";
import {
	isBlock,
	isBox,
	isConnector,
	type BlockElement,
	type BlockShape,
	type BlockStyle,
	type Bounds,
	type ConnectorElement,
	type ConnectorStyle,
	type FrameElement,
	type FrameStyle,
	type Routing,
} from "../model/types";
import { applyDrawingTheme, drawingThemeById, type DrawingThemeId } from "../model/themes";
import { shortcut } from "./commands";
import type { Editor } from "./Editor";

/** Edits to the selection (delete, duplicate, move, order, align, distribute, styles, themes); each is one undo step. */

export function deleteSelection(ed: Editor): void {
	if (!ed.selection.size) return;
	ed.commit(deleteElements(ed.elements, ed.selection), { selection: [] });
}

export function duplicateSelection(ed: Editor): void {
	if (!ed.selection.size) return;
	const picked = collectForCopy(ed.elements, ed.selection);
	if (!picked.length) return;
	const offset = ed.options.gridSize || 20;
	const { elements, idMap } = cloneElements(picked, offset, offset);
	const next = insertClones(ed.elements, elements, new Set(elements.map((e) => e.id)));
	const newSel = [...ed.selection].map((id) => idMap.get(id)).filter((id): id is string => !!id);
	ed.commit(next, { selection: newSel });
}

export function nudge(ed: Editor, dx: number, dy: number): void {
	const ids = [...ed.selection];
	if (!ids.length) return;
	const moveSet = expandMoveSet(ed.elements, ids);
	if (!moveSet.size) return;
	let next = translateElements(ed.elements, moveSet, dx, dy);
	const direct = ids.filter((id) => {
		const e = ed.byId.get(id);
		return isBlock(e) && !(e.frameId && moveSet.has(e.frameId) && ed.selection.has(e.frameId));
	});
	next = assignFrames(next, direct);
	ed.commit(next);
}

export function reorderSelection(ed: Editor, mode: ZOrderMode): void {
	if (!ed.selection.size) return;
	ed.commit(reorderElements(ed.elements, ed.selection, mode));
}

/** Applies a block style change to the selected blocks and remembers it for new blocks. */
export function applyBlockStyle(ed: Editor, patch: Partial<BlockStyle>): void {
	ed.current.block = { ...ed.current.block, ...patch };
	const patches = new Map<string, ElementPatch>();
	for (const b of ed.selectedBlocks()) patches.set(b.id, { style: { ...b.style, ...patch } });
	if (patches.size) ed.commit(updateElements(ed.elements, patches));
	else ed.requestRender();
}

export function applyShape(ed: Editor, shape: BlockShape): void {
	ed.current.shape = shape;
	if (ed.tool === "block") ed.toolShape = shape;
	const patches = new Map<string, ElementPatch>();
	for (const b of ed.selectedBlocks()) patches.set(b.id, { shape });
	if (patches.size) ed.commit(updateElements(ed.elements, patches));
	else ed.requestRender();
}

export function applyConnectorStyle(ed: Editor, patch: Partial<ConnectorStyle>): void {
	ed.current.connector = { ...ed.current.connector, ...patch };
	const patches = new Map<string, ElementPatch>();
	for (const c of ed.selectedConnectors()) patches.set(c.id, { style: { ...c.style, ...patch } });
	if (patches.size) ed.commit(updateElements(ed.elements, patches));
	else ed.requestRender();
}

export function applyRouting(ed: Editor, routing: Routing): void {
	ed.current.routing = routing;
	const patches = new Map<string, ElementPatch>();
	for (const c of ed.selectedConnectors()) patches.set(c.id, { routing });
	if (patches.size) ed.commit(updateElements(ed.elements, patches));
	else ed.requestRender();
}

export function applyFrameStyle(ed: Editor, patch: Partial<FrameStyle>): void {
	ed.current.frame = { ...ed.current.frame, ...patch };
	const patches = new Map<string, ElementPatch>();
	for (const f of ed.selectedFrames()) patches.set(f.id, { style: { ...f.style, ...patch } });
	if (patches.size) ed.commit(updateElements(ed.elements, patches));
}

export function reverseConnector(ed: Editor, id: string): void {
	const c = ed.byId.get(id);
	if (!isConnector(c)) return;
	ed.updateElement(id, {
		from: c.to,
		to: c.from,
		style: { ...c.style, startArrow: c.style.endArrow, endArrow: c.style.startArrow },
	});
}

/** Aligns selected boxes (blocks and frames). */
export function alignSelection(ed: Editor, mode: "left" | "center" | "right" | "top" | "middle" | "bottom"): void {
	const boxes = ed.elements.filter((e): e is BlockElement | FrameElement => isBox(e) && ed.selection.has(e.id));
	if (boxes.length < 2) return;
	const ub = unionBounds(boxes) as Bounds;
	let next = ed.elements;
	for (const b of boxes) {
		let dx = 0;
		let dy = 0;
		if (mode === "left") dx = ub.x - b.x;
		if (mode === "right") dx = ub.x + ub.width - (b.x + b.width);
		if (mode === "center") dx = ub.x + ub.width / 2 - (b.x + b.width / 2);
		if (mode === "top") dy = ub.y - b.y;
		if (mode === "bottom") dy = ub.y + ub.height - (b.y + b.height);
		if (mode === "middle") dy = ub.y + ub.height / 2 - (b.y + b.height / 2);
		if (dx || dy) next = translateElements(next, expandMoveSet(next, [b.id]), dx, dy);
	}
	next = assignFrames(next, boxes.filter(isBlock).map((b) => b.id));
	ed.commit(next);
}

export function distributeSelection(ed: Editor, axis: "h" | "v"): void {
	const boxes = ed.elements.filter((e): e is BlockElement | FrameElement => isBox(e) && ed.selection.has(e.id));
	if (boxes.length < 3) return;
	const sorted = [...boxes].sort((a, b) => (axis === "h" ? a.x - b.x : a.y - b.y));
	const first = sorted[0];
	const last = sorted[sorted.length - 1];
	const total = sorted.reduce((s, b) => s + (axis === "h" ? b.width : b.height), 0);
	const span = axis === "h" ? last.x + last.width - first.x : last.y + last.height - first.y;
	const gap = (span - total) / (sorted.length - 1);
	let cursor = axis === "h" ? first.x : first.y;
	let next = ed.elements;
	for (const b of sorted) {
		const delta = cursor - (axis === "h" ? b.x : b.y);
		if (delta) next = translateElements(next, expandMoveSet(next, [b.id]), axis === "h" ? delta : 0, axis === "v" ? delta : 0);
		cursor += (axis === "h" ? b.width : b.height) + gap;
	}
	ed.commit(assignFrames(next, sorted.filter(isBlock).map((b) => b.id)));
}

/** Turns the 3D effect on or off for the selected blocks and connectors (all when none). */
export function toggle3D(ed: Editor): void {
	if (ed.options.readOnly) return;
	const targets = ed.selection.size ? ed.selectedElements() : ed.elements;
	const items = targets.filter((e): e is BlockElement | ConnectorElement => isBlock(e) || isConnector(e));
	if (!items.length) return;
	const on = !items.every((e) => e.style.threeD);
	const patches = new Map<string, ElementPatch>();
	for (const e of items) patches.set(e.id, { style: { ...e.style, threeD: on } } as ElementPatch);
	ed.commit(updateElements(ed.elements, patches));
}

/**
 * Restyles the selection (or the whole drawing when nothing is selected) with a theme, as
 * one undo step, and makes it the style for new elements.
 */
export function applyTheme(ed: Editor, id: DrawingThemeId): void {
	const theme = drawingThemeById(id);
	if (!theme || ed.options.readOnly) return;
	const scope = ed.selection.size ? new Set(ed.selection) : undefined;
	ed.commit(applyDrawingTheme(ed.elements, theme, scope));
	ed.current.block = {
		...ed.current.block,
		fill: theme.fills[0],
		stroke: theme.strokes[0],
		strokeWidth: theme.strokeWidth,
		textColor: "auto",
		threeD: theme.threeD,
	};
	ed.current.connector = {
		...ed.current.connector,
		stroke: theme.connector === "source" ? theme.strokes[0] : theme.connector,
		strokeWidth: theme.connectorWidth,
		threeD: theme.threeD,
	};
	ed.current.frame = { fill: theme.frameFill, stroke: theme.frameStroke };
	ed.palette = id === "futuristic" ? "futuristic" : id === "classic" ? "classic" : id === "minimal" ? "minimal" : "3d";
	ed.props.refresh();
	ed.host.notice(`Applied the ${theme.name} theme to ${scope ? "the selection" : "the drawing"}. Undo with ${shortcut("undo")}.`);
}
