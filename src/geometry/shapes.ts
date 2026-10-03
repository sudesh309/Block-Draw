import type { BlockShape, Bounds, Point, Side } from "../model/types";
import { center } from "./geom";
import { SHAPES, type ShapeDef } from "./shapes/index";

export { SHAPES, type ShapeDef } from "./shapes/index";

/*
 * Shape geometry for the rest of the plugin. Each function works for every shape the same way;
 * what differs between shapes is a row in the SHAPES table (one file per shape in shapes/).
 */

/** The row for a shape; anything unknown is drawn as a rectangle. */
export const shapeDef = (shape: BlockShape): ShapeDef => SHAPES[shape] ?? SHAPES.rectangle;

/** SVG path data for a shape outline in local coordinates (0,0)-(w,h). */
export function shapePath(shape: BlockShape, w: number, h: number): string {
	return shapeDef(shape).path(w, h);
}

/** Extra decoration strokes drawn on top of the fill (e.g. the cylinder's front lip). */
export function shapeDecorationPath(shape: BlockShape, w: number, h: number): string | null {
	return shapeDef(shape).decoration?.(w, h) ?? null;
}

/** Outline polygon (in absolute coordinates) for polygonal shapes, used for exact hit/clip maths. */
function polygonFor(shape: BlockShape, b: Bounds): Point[] | null {
	const outline = shapeDef(shape).outline;
	return typeof outline === "function" ? outline(b) : null;
}

/** Intersection of the ray center→p with segment a-b; returns the ray parameter t (or null). */
function raySegment(c: Point, d: Point, a: Point, b: Point): number | null {
	const ex = b.x - a.x;
	const ey = b.y - a.y;
	const denom = d.x * ey - d.y * ex;
	if (Math.abs(denom) < 1e-9) return null;
	const t = ((a.x - c.x) * ey - (a.y - c.y) * ex) / denom;
	const u = ((a.x - c.x) * d.y - (a.y - c.y) * d.x) / denom;
	if (t >= 0 && u >= -1e-9 && u <= 1 + 1e-9) return t;
	return null;
}

/**
 * Point where the ray from the shape's center toward `toward` leaves the shape outline.
 * Used to clip straight connectors so they end exactly on the visible border.
 */
export function boundaryPoint(shape: BlockShape, b: Bounds, toward: Point): Point {
	const c = center(b);
	let d = { x: toward.x - c.x, y: toward.y - c.y };
	if (d.x === 0 && d.y === 0) d = { x: 1, y: 0 };

	if (shapeDef(shape).outline === "ellipse") {
		const rx = b.width / 2;
		const ry = b.height / 2;
		if (rx === 0 || ry === 0) return c;
		const t = 1 / Math.sqrt((d.x * d.x) / (rx * rx) + (d.y * d.y) / (ry * ry));
		return { x: c.x + d.x * t, y: c.y + d.y * t };
	}

	const poly = polygonFor(shape, b);
	if (poly) {
		let best: number | null = null;
		for (let i = 0; i < poly.length; i++) {
			const t = raySegment(c, d, poly[i], poly[(i + 1) % poly.length]);
			if (t !== null && (best === null || t < best)) best = t;
		}
		if (best !== null) return { x: c.x + d.x * best, y: c.y + d.y * best };
	}

	// Rectangle-like shapes.
	const hw = b.width / 2;
	const hh = b.height / 2;
	const tx = d.x !== 0 ? hw / Math.abs(d.x) : Infinity;
	const ty = d.y !== 0 ? hh / Math.abs(d.y) : Infinity;
	const t = Math.min(tx, ty);
	return { x: c.x + d.x * t, y: c.y + d.y * t };
}

/** Connection point in the middle of a side of the shape. */
export function sideAnchor(shape: BlockShape, b: Bounds, side: Side): Point {
	const c = center(b);
	const inset = shapeDef(shape).sideInset?.(b.width, b.height) ?? 0;
	switch (side) {
		case "top":
			return { x: c.x, y: b.y };
		case "bottom":
			return { x: c.x, y: b.y + b.height };
		case "left":
			return { x: b.x + inset, y: c.y };
		case "right":
			return { x: b.x + b.width - inset, y: c.y };
	}
}

/**
 * Inner box available for text, relative to the block's top-left corner.
 * Shapes with slanted or curved sides offer less room than their bounds.
 */
export function textInsets(shape: BlockShape, w: number, h: number): Bounds {
	return shapeDef(shape).textBox(w, h);
}

/** Is `p` inside the visible shape (used for precise click selection)? */
export function shapeContains(shape: BlockShape, b: Bounds, p: Point, margin = 0): boolean {
	if (
		p.x < b.x - margin ||
		p.x > b.x + b.width + margin ||
		p.y < b.y - margin ||
		p.y > b.y + b.height + margin
	) {
		return false;
	}
	if (margin > 0) return true;
	if (shapeDef(shape).outline === "ellipse") {
		const c = center(b);
		const rx = b.width / 2;
		const ry = b.height / 2;
		if (rx === 0 || ry === 0) return false;
		return ((p.x - c.x) ** 2) / (rx * rx) + ((p.y - c.y) ** 2) / (ry * ry) <= 1;
	}
	const poly = polygonFor(shape, b);
	if (!poly) return true;
	let inside = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const a = poly[i];
		const c = poly[j];
		if (a.y > p.y !== c.y > p.y && p.x < ((c.x - a.x) * (p.y - a.y)) / (c.y - a.y) + a.x) inside = !inside;
	}
	return inside;
}
