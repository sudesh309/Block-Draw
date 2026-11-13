import { unionBounds } from "../geometry/geom";
import { isBlock, isBox, type Bounds } from "../model/types";
import { h, type VNode } from "../render/vnode";
import type { Editor } from "./Editor";

/**
 * Alignment guides: while blocks are dragged, a line appears wherever their left, center or right
 * (top, middle or bottom) lines up with another block's. They only show what the grid and the hand
 * already did; they never move anything.
 */
export function alignmentGuides(ed: Editor, moving: ReadonlySet<string>, z: number): VNode[] {
	const moved: Bounds[] = [];
	const others: Bounds[] = [];
	for (const el of ed.elements) {
		if (isBox(el) && moving.has(el.id)) moved.push(el);
		else if (isBlock(el) && others.length < 400) others.push(el);
	}
	const m = unionBounds(moved);
	if (!m || !others.length) return [];
	const stops = (b: Bounds, axis: "x" | "y") => (axis === "x" ? [b.x, b.x + b.width / 2, b.x + b.width] : [b.y, b.y + b.height / 2, b.y + b.height]);
	const nodes: VNode[] = [];
	for (const axis of ["x", "y"] as const) {
		const mine = stops(m, axis);
		// One line per position: it spans the dragged blocks and every block lined up with them.
		const spans = new Map<number, [number, number]>();
		for (const o of others) {
			for (const at of stops(o, axis)) {
				if (!mine.some((v) => Math.abs(v - at) < 0.5)) continue;
				const lo = axis === "x" ? Math.min(m.y, o.y) : Math.min(m.x, o.x);
				const hi = axis === "x" ? Math.max(m.y + m.height, o.y + o.height) : Math.max(m.x + m.width, o.x + o.width);
				const key = Math.round(at * 2) / 2;
				const span = spans.get(key);
				spans.set(key, span ? [Math.min(span[0], lo), Math.max(span[1], hi)] : [lo, hi]);
			}
		}
		const pad = 12 / z;
		for (const [at, [lo, hi]] of spans) {
			nodes.push(h("line", { class: "bd-align-guide", ...(axis === "x" ? { x1: at, x2: at, y1: lo - pad, y2: hi + pad } : { y1: at, y2: at, x1: lo - pad, x2: hi + pad }) }));
		}
	}
	return nodes;
}
