import { newId } from "./ids";
import { parseFrameLink, frameLink } from "./links";
import { center, containsPoint } from "./space";
import { stackLevel } from "./stack";
import {
	isBlock,
	isConnector,
	isFrame,
	type BlockElement,
	type ConnectorElement,
	type DrawElement,
	type FrameElement,
	type Point,
} from "./types";

/* ------------------------------------------------------------------ queries */

export function blocksOf(els: readonly DrawElement[]): BlockElement[] {
	return els.filter(isBlock);
}

export function framesOf(els: readonly DrawElement[]): FrameElement[] {
	return els.filter(isFrame);
}

export function connectorsOf(els: readonly DrawElement[]): ConnectorElement[] {
	return els.filter(isConnector);
}

export function indexById(els: readonly DrawElement[]): Map<string, DrawElement> {
	const map = new Map<string, DrawElement>();
	for (const el of els) map.set(el.id, el);
	return map;
}

export function frameChildren(els: readonly DrawElement[], frameId: string): BlockElement[] {
	return els.filter((el): el is BlockElement => isBlock(el) && el.frameId === frameId);
}

/** Connectors attached to any of the given block ids. */
export function attachedConnectors(els: readonly DrawElement[], blockIds: Set<string>): ConnectorElement[] {
	return els.filter(
		(el): el is ConnectorElement => isConnector(el) && (blockIds.has(el.from.id) || blockIds.has(el.to.id)),
	);
}

/** Topmost frame whose bounds contain the point (frames later in the list are on top). */
export function frameAt(els: readonly DrawElement[], p: Point, exclude?: Set<string>): FrameElement | null {
	for (let i = els.length - 1; i >= 0; i--) {
		const el = els[i];
		if (isFrame(el) && !exclude?.has(el.id) && containsPoint(el, p)) return el;
	}
	return null;
}

/* -------------------------------------------------------------- mutations */

/** Partial update for one element kind (id and type can never change). */
export type ElementPatch =
	| Partial<Omit<BlockElement, "id" | "type">>
	| Partial<Omit<FrameElement, "id" | "type">>
	| Partial<Omit<ConnectorElement, "id" | "type">>;

/** Applies shallow patches; elements without a patch keep their identity. */
export function updateElements(
	els: readonly DrawElement[],
	patches: Map<string, ElementPatch>,
): DrawElement[] {
	if (patches.size === 0) return els.slice();
	return els.map((el) => {
		const patch = patches.get(el.id);
		if (!patch) return el;
		let changed = false;
		for (const [key, value] of Object.entries(patch)) {
			if ((el as unknown as Record<string, unknown>)[key] !== value) {
				changed = true;
				break;
			}
		}
		return changed ? ({ ...el, ...patch } as DrawElement) : el;
	});
}

/**
 * Deletes elements with cascading: a frame takes its blocks with it, a block takes its
 * connectors, and frame links that pointed at deleted frames are cleared.
 */
export function deleteElements(els: readonly DrawElement[], ids: Iterable<string>): DrawElement[] {
	const doomed = new Set(ids);
	for (const el of els) {
		if (isBlock(el) && el.frameId && doomed.has(el.frameId)) doomed.add(el.id);
	}
	for (const el of els) {
		if (isConnector(el) && (doomed.has(el.from.id) || doomed.has(el.to.id))) doomed.add(el.id);
	}
	const kept: DrawElement[] = [];
	for (const el of els) {
		if (doomed.has(el.id)) continue;
		if (isBlock(el) && el.link) {
			const target = parseFrameLink(el.link);
			if (target && doomed.has(target)) {
				kept.push({ ...el, link: null });
				continue;
			}
		}
		kept.push(el);
	}
	return kept;
}

/** Ids that actually move when `ids` are dragged: frames carry their children along. */
export function expandMoveSet(els: readonly DrawElement[], ids: Iterable<string>): Set<string> {
	const set = new Set<string>();
	const idSet = new Set(ids);
	for (const el of els) {
		if (!idSet.has(el.id)) continue;
		if (isBlock(el) || isFrame(el)) set.add(el.id);
	}
	for (const el of els) {
		if (isBlock(el) && el.frameId && set.has(el.frameId)) set.add(el.id);
	}
	return set;
}

/** Moves blocks/frames by (dx, dy); `moveSet` should come from {@link expandMoveSet}. */
export function translateElements(
	els: readonly DrawElement[],
	moveSet: Set<string>,
	dx: number,
	dy: number,
	origin?: Map<string, { x: number; y: number }>,
): DrawElement[] {
	return els.map((el) => {
		if (!moveSet.has(el.id) || isConnector(el)) return el;
		const base = origin?.get(el.id) ?? el;
		const x = base.x + dx;
		const y = base.y + dy;
		if (x === el.x && y === el.y) return el;
		return { ...el, x, y };
	});
}

/**
 * Recomputes the frame of the given blocks: a block belongs to the topmost frame containing
 * its center, or to no frame.
 */
export function assignFrames(els: readonly DrawElement[], blockIds: Iterable<string>): DrawElement[] {
	const ids = new Set(blockIds);
	if (ids.size === 0) return els.slice();
	return els.map((el) => {
		if (!isBlock(el) || !ids.has(el.id)) return el;
		const frame = frameAt(els, center(el));
		const frameId = frame ? frame.id : null;
		return frameId === el.frameId ? el : { ...el, frameId };
	});
}

/**
 * After a frame is created or resized: adopt blocks whose center lies inside it and release
 * children that ended up outside (they may fall into another frame).
 */
export function refreshFrameMembership(els: readonly DrawElement[], frameId: string): DrawElement[] {
	const frame = els.find((e) => e.id === frameId);
	if (!isFrame(frame)) return els.slice();
	const affected: string[] = [];
	for (const el of els) {
		if (!isBlock(el)) continue;
		const inside = containsPoint(frame, center(el));
		if (inside && el.frameId !== frameId) affected.push(el.id);
		if (!inside && el.frameId === frameId) affected.push(el.id);
	}
	return assignFrames(els, affected);
}

export type ZOrderMode = "front" | "back" | "forward" | "backward";

/** The element as it is when brought to the front or sent to the back of its kind. */
function placed(el: DrawElement, mode: "front" | "back"): DrawElement {
	if (isBlock(el)) {
		if (mode === "front") return { ...el, inFront: true };
		const { inFront: _off, ...rest } = el;
		return rest;
	}
	if (isConnector(el)) {
		if (mode === "back") return { ...el, behind: true };
		const { behind: _off, ...rest } = el;
		return rest;
	}
	return el;
}

/**
 * Changes stacking order (see model/stack.ts for the levels). Bring to front puts a block above the
 * links and a link above the blocks; send to back puts a link below the blocks and a block below the
 * links. Bring forward and send backward move one step among the elements of the same level.
 */
export function reorderElements(els: readonly DrawElement[], ids: Set<string>, mode: ZOrderMode): DrawElement[] {
	const arr = els.slice();
	if (mode === "front" || mode === "back") {
		const picked = arr.filter((e) => ids.has(e.id)).map((e) => placed(e, mode));
		const others = arr.filter((e) => !ids.has(e.id));
		return mode === "front" ? [...others, ...picked] : [...picked, ...others];
	}
	if (mode === "forward") {
		for (let i = arr.length - 2; i >= 0; i--) {
			if (ids.has(arr[i].id) && !ids.has(arr[i + 1].id)) {
				const j = nextSameLayer(arr, i, 1);
				if (j !== -1) moveItem(arr, i, j);
			}
		}
		return arr;
	}
	for (let i = 1; i < arr.length; i++) {
		if (ids.has(arr[i].id) && !ids.has(arr[i - 1].id)) {
			const j = nextSameLayer(arr, i, -1);
			if (j !== -1) moveItem(arr, i, j);
		}
	}
	return arr;
}

function nextSameLayer(arr: DrawElement[], i: number, step: 1 | -1): number {
	const level = stackLevel(arr[i]);
	for (let j = i + step; j >= 0 && j < arr.length; j += step) {
		if (stackLevel(arr[j]) === level) return j;
	}
	return -1;
}

function moveItem<T>(arr: T[], from: number, to: number): void {
	const [item] = arr.splice(from, 1);
	arr.splice(to, 0, item);
}

/** Moves a frame one step earlier/later in frame order (used by the frame list). */
export function moveFrameOrder(els: readonly DrawElement[], frameId: string, delta: -1 | 1): DrawElement[] {
	const arr = els.slice();
	const i = arr.findIndex((e) => e.id === frameId);
	if (i < 0) return arr;
	const j = nextSameLayer(arr, i, delta);
	if (j < 0) return arr;
	const tmp = arr[i];
	arr[i] = arr[j];
	arr[j] = tmp;
	return arr;
}

/* ------------------------------------------------------- copy / duplicate */

/**
 * Elements that should travel together when `ids` are copied: frames bring their children,
 * and connectors come along when both of their ends are included.
 */
export function collectForCopy(els: readonly DrawElement[], ids: Iterable<string>): DrawElement[] {
	const set = expandMoveSet(els, ids);
	const picked = new Set(set);
	for (const el of els) {
		if (isConnector(el) && set.has(el.from.id) && set.has(el.to.id)) picked.add(el.id);
	}
	return els.filter((el) => picked.has(el.id));
}

/**
 * Clones elements with fresh ids, shifted by (dx, dy). References between cloned elements
 * (frame membership, connector ends, frame links) are remapped; dangling connectors dropped.
 */
export function cloneElements(
	source: readonly DrawElement[],
	dx: number,
	dy: number,
): { elements: DrawElement[]; idMap: Map<string, string> } {
	const idMap = new Map<string, string>();
	for (const el of source) idMap.set(el.id, newId());
	const out: DrawElement[] = [];
	for (const el of source) {
		const id = idMap.get(el.id) as string;
		if (isConnector(el)) {
			const from = idMap.get(el.from.id);
			const to = idMap.get(el.to.id);
			if (!from || !to) continue;
			out.push({ ...el, id, from: { ...el.from, id: from }, to: { ...el.to, id: to }, style: { ...el.style } });
		} else if (isFrame(el)) {
			out.push({ ...el, id, x: el.x + dx, y: el.y + dy, style: { ...el.style } });
		} else {
			let link = el.link;
			const target = link ? parseFrameLink(link) : null;
			if (target && idMap.has(target)) link = frameLink(idMap.get(target) as string);
			out.push({
				...el,
				id,
				x: el.x + dx,
				y: el.y + dy,
				frameId: el.frameId && idMap.has(el.frameId) ? (idMap.get(el.frameId) as string) : el.frameId,
				link,
				style: { ...el.style },
			});
		}
	}
	return { elements: out, idMap };
}

/**
 * Inserts cloned elements and fixes frame membership of blocks whose frame was not part of
 * the clone (they are re-assigned by position).
 */
export function insertClones(
	els: readonly DrawElement[],
	clones: DrawElement[],
	clonedIds: Set<string>,
): DrawElement[] {
	const next = [...els, ...clones];
	const reassign: string[] = [];
	for (const el of clones) {
		if (isBlock(el) && (!el.frameId || !clonedIds.has(el.frameId))) reassign.push(el.id);
	}
	return assignFrames(next, reassign);
}

export interface ClipboardPayload {
	type: "block-draw/clipboard";
	version: 1;
	elements: DrawElement[];
}

export function makeClipboardPayload(elements: DrawElement[]): ClipboardPayload {
	return { type: "block-draw/clipboard", version: 1, elements };
}

export function readClipboardPayload(text: string): DrawElement[] | null {
	if (!text || text[0] !== "{") return null;
	try {
		const data = JSON.parse(text) as Partial<ClipboardPayload>;
		if (data && data.type === "block-draw/clipboard" && Array.isArray(data.elements)) {
			return data.elements;
		}
	} catch {
		// not ours
	}
	return null;
}
