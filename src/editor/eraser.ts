import { dist, type Point } from "../geometry/geom";
import { routePathData } from "../geometry/routing";
import { deleteElements } from "../model/ops";
import { isBlock, isConnector } from "../model/types";
import { h, type VNode } from "../render/vnode";
import type { Editor } from "./Editor";
import { hitTest } from "./hitTest";

/**
 * Erasing, with the Eraser tool or (in tablet mode) a pen's button or eraser end. The blocks and
 * links a stroke passes over are marked, and deleted together when it ends: one undo step, with the
 * rules of the Delete key (a block takes its links with it). Frames are never erased this way,
 * because a frame takes its blocks with it, which is too much for a stroke that grazes its border.
 */

/** The block or link that erasing at a point would take, if any. */
export function erasableAt(ed: Editor, p: Point): string | null {
	const hit = hitTest(ed, p, false);
	return hit && hit.kind !== "frame" ? hit.id : null;
}

/** Marks what a stroke from `from` to `to` passes over. True when it marked something new. */
export function markErasable(ed: Editor, marked: Set<string>, from: Point, to: Point): boolean {
	const steps = Math.max(1, Math.ceil(dist(from, to) / (6 / ed.vp.zoom)));
	let added = false;
	for (let i = 1; i <= steps; i++) {
		const t = i / steps;
		const id = erasableAt(ed, { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
		if (id && !marked.has(id)) {
			marked.add(id);
			added = true;
		}
	}
	return added;
}

/** Deletes what a stroke marked, as one undo step (whatever else was selected stays selected). */
export function eraseMarked(ed: Editor, marked: ReadonlySet<string>): void {
	if (marked.size) ed.commit(deleteElements(ed.elements, marked));
}

/** Outlines of everything the stroke deletes when it ends: the marked elements and the links of marked blocks. */
export function eraseOverlay(ed: Editor, marked: ReadonlySet<string>, z: number): VNode[] {
	const doomed = new Set(marked);
	for (const el of ed.elements) if (isConnector(el) && (marked.has(el.from.id) || marked.has(el.to.id))) doomed.add(el.id);
	const nodes: VNode[] = [];
	for (const id of doomed) {
		const el = ed.byId.get(id);
		if (isBlock(el)) {
			const m = 4 / z;
			nodes.push(h("rect", { class: "bd-erase-mark", x: el.x - m, y: el.y - m, width: el.width + 2 * m, height: el.height + 2 * m, rx: 6 / z }));
		} else if (isConnector(el)) {
			const r = ed.renderer.route(el);
			if (r) nodes.push(h("path", { class: "bd-erase-mark-line", d: routePathData(r.route) }));
		}
	}
	return nodes;
}
