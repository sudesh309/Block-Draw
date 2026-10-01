import type { BlockShape, Bounds, Side } from "../model/types";
import { center, type Point } from "./geom";

/** Corner radius used by the "rounded" shape. */
export function roundedRadius(width: number, height: number): number {
	return Math.max(0, Math.min(16, width / 4, height / 4));
}

function parallelogramSkew(width: number, height: number): number {
	return Math.min(width * 0.2, height * 0.6);
}

function hexagonInset(width: number, height: number): number {
	return Math.min(width * 0.25, height * 0.5);
}

export function cylinderCap(width: number, height: number): number {
	return Math.min(height * 0.15, width * 0.25, 14);
}

const f = (n: number) => (Math.round(n * 100) / 100).toString();

/** SVG path data for a shape outline in local coordinates (0,0)-(w,h). */
export function shapePath(shape: BlockShape, w: number, h: number): string {
	switch (shape) {
		case "rounded": {
			const r = roundedRadius(w, h);
			return (
				`M${f(r)},0 H${f(w - r)} A${f(r)},${f(r)} 0 0 1 ${f(w)},${f(r)} ` +
				`V${f(h - r)} A${f(r)},${f(r)} 0 0 1 ${f(w - r)},${f(h)} ` +
				`H${f(r)} A${f(r)},${f(r)} 0 0 1 0,${f(h - r)} ` +
				`V${f(r)} A${f(r)},${f(r)} 0 0 1 ${f(r)},0 Z`
			);
		}
		case "ellipse":
			return (
				`M0,${f(h / 2)} A${f(w / 2)},${f(h / 2)} 0 1 1 ${f(w)},${f(h / 2)} ` +
				`A${f(w / 2)},${f(h / 2)} 0 1 1 0,${f(h / 2)} Z`
			);
		case "diamond":
			return `M${f(w / 2)},0 L${f(w)},${f(h / 2)} L${f(w / 2)},${f(h)} L0,${f(h / 2)} Z`;
		case "parallelogram": {
			const s = parallelogramSkew(w, h);
			return `M${f(s)},0 L${f(w)},0 L${f(w - s)},${f(h)} L0,${f(h)} Z`;
		}
		case "hexagon": {
			const s = hexagonInset(w, h);
			return `M${f(s)},0 L${f(w - s)},0 L${f(w)},${f(h / 2)} L${f(w - s)},${f(h)} L${f(s)},${f(h)} L0,${f(h / 2)} Z`;
		}
		case "cylinder": {
			const ry = cylinderCap(w, h);
			return (
				`M0,${f(ry)} A${f(w / 2)},${f(ry)} 0 0 1 ${f(w)},${f(ry)} ` +
				`V${f(h - ry)} A${f(w / 2)},${f(ry)} 0 0 1 0,${f(h - ry)} Z`
			);
		}
		case "rectangle":
		case "text":
		default:
			return `M0,0 H${f(w)} V${f(h)} H0 Z`;
	}
}

/** Extra decoration strokes drawn on top of the fill (e.g. the cylinder's front lip). */
export function shapeDecorationPath(shape: BlockShape, w: number, h: number): string | null {
	if (shape === "cylinder") {
		const ry = cylinderCap(w, h);
		return `M0,${f(ry)} A${f(w / 2)},${f(ry)} 0 0 0 ${f(w)},${f(ry)}`;
	}
	return null;
}

/** Outline polygon (in absolute coordinates) for polygonal shapes, used for exact hit/clip maths. */
function polygonFor(shape: BlockShape, b: Bounds): Point[] | null {
	const { x, y, width: w, height: h } = b;
	switch (shape) {
		case "diamond":
			return [
				{ x: x + w / 2, y },
				{ x: x + w, y: y + h / 2 },
				{ x: x + w / 2, y: y + h },
				{ x, y: y + h / 2 },
			];
		case "parallelogram": {
			const s = parallelogramSkew(w, h);
			return [
				{ x: x + s, y },
				{ x: x + w, y },
				{ x: x + w - s, y: y + h },
				{ x, y: y + h },
			];
		}
		case "hexagon": {
			const s = hexagonInset(w, h);
			return [
				{ x: x + s, y },
				{ x: x + w - s, y },
				{ x: x + w, y: y + h / 2 },
				{ x: x + w - s, y: y + h },
				{ x: x + s, y: y + h },
				{ x, y: y + h / 2 },
			];
		}
		default:
			return null;
	}
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

	if (shape === "ellipse") {
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
	switch (side) {
		case "top":
			return { x: c.x, y: b.y };
		case "bottom":
			return { x: c.x, y: b.y + b.height };
		case "left":
			if (shape === "parallelogram") {
				const s = parallelogramSkew(b.width, b.height);
				return { x: b.x + s / 2, y: c.y };
			}
			return { x: b.x, y: c.y };
		case "right":
			if (shape === "parallelogram") {
				const s = parallelogramSkew(b.width, b.height);
				return { x: b.x + b.width - s / 2, y: c.y };
			}
			return { x: b.x + b.width, y: c.y };
	}
}

/**
 * Inner box available for text, relative to the block's top-left corner.
 * Shapes with slanted or curved sides offer less room than their bounds.
 */
export function textInsets(shape: BlockShape, w: number, h: number): Bounds {
	const pad = 8;
	switch (shape) {
		case "ellipse": {
			const iw = w * 0.72;
			const ih = h * 0.72;
			return { x: (w - iw) / 2 + 2, y: (h - ih) / 2, width: Math.max(0, iw - 4), height: ih };
		}
		case "diamond": {
			const iw = w * 0.56;
			const ih = h * 0.56;
			return { x: (w - iw) / 2, y: (h - ih) / 2, width: iw, height: ih };
		}
		case "parallelogram": {
			const s = parallelogramSkew(w, h);
			return { x: s + 2, y: pad, width: Math.max(0, w - 2 * s - 4), height: Math.max(0, h - 2 * pad) };
		}
		case "hexagon": {
			const s = hexagonInset(w, h) * 0.75;
			return { x: s, y: pad, width: Math.max(0, w - 2 * s), height: Math.max(0, h - 2 * pad) };
		}
		case "cylinder": {
			const ry = cylinderCap(w, h);
			return { x: pad, y: ry * 2 + 2, width: Math.max(0, w - 2 * pad), height: Math.max(0, h - ry * 3 - 4) };
		}
		case "text":
			return { x: 4, y: 4, width: Math.max(0, w - 8), height: Math.max(0, h - 8) };
		default:
			return { x: pad, y: pad, width: Math.max(0, w - 2 * pad), height: Math.max(0, h - 2 * pad) };
	}
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
	if (shape === "ellipse") {
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
