import type { Bounds, Side } from "../model/types";

export interface Point {
	x: number;
	y: number;
}

export const SIDES: Side[] = ["top", "right", "bottom", "left"];

export const SIDE_DIR: Record<Side, Point> = {
	top: { x: 0, y: -1 },
	right: { x: 1, y: 0 },
	bottom: { x: 0, y: 1 },
	left: { x: -1, y: 0 },
};

export const OPPOSITE_SIDE: Record<Side, Side> = {
	top: "bottom",
	right: "left",
	bottom: "top",
	left: "right",
};

export function add(a: Point, b: Point): Point {
	return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Point, b: Point): Point {
	return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Point, k: number): Point {
	return { x: a.x * k, y: a.y * k };
}

export function dist(a: Point, b: Point): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

export function normalize(v: Point): Point {
	const len = Math.hypot(v.x, v.y);
	return len === 0 ? { x: 0, y: 0 } : { x: v.x / len, y: v.y / len };
}

export function center(b: Bounds): Point {
	return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

export function right(b: Bounds): number {
	return b.x + b.width;
}

export function bottom(b: Bounds): number {
	return b.y + b.height;
}

export function containsPoint(b: Bounds, p: Point, margin = 0): boolean {
	return (
		p.x >= b.x - margin &&
		p.x <= b.x + b.width + margin &&
		p.y >= b.y - margin &&
		p.y <= b.y + b.height + margin
	);
}

/** True when `inner` lies completely inside `outer`. */
export function containsBounds(outer: Bounds, inner: Bounds): boolean {
	return (
		inner.x >= outer.x &&
		inner.y >= outer.y &&
		inner.x + inner.width <= outer.x + outer.width &&
		inner.y + inner.height <= outer.y + outer.height
	);
}

export function intersects(a: Bounds, b: Bounds): boolean {
	return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function expand(b: Bounds, by: number): Bounds {
	return { x: b.x - by, y: b.y - by, width: b.width + by * 2, height: b.height + by * 2 };
}

/** Bounds spanned by two corner points, in any order. */
export function boundsFromPoints(a: Point, b: Point): Bounds {
	return {
		x: Math.min(a.x, b.x),
		y: Math.min(a.y, b.y),
		width: Math.abs(a.x - b.x),
		height: Math.abs(a.y - b.y),
	};
}

export function unionBounds(list: Bounds[]): Bounds | null {
	if (list.length === 0) return null;
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const b of list) {
		minX = Math.min(minX, b.x);
		minY = Math.min(minY, b.y);
		maxX = Math.max(maxX, b.x + b.width);
		maxY = Math.max(maxY, b.y + b.height);
	}
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function pointsBounds(points: Point[]): Bounds | null {
	if (points.length === 0) return null;
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const p of points) {
		minX = Math.min(minX, p.x);
		minY = Math.min(minY, p.y);
		maxX = Math.max(maxX, p.x);
		maxY = Math.max(maxY, p.y);
	}
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const lenSq = dx * dx + dy * dy;
	if (lenSq === 0) return dist(p, a);
	let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
	t = Math.max(0, Math.min(1, t));
	return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/**
 * Does the axis-aligned segment a-b pass through the *interior* of `box`?
 * Touching the border does not count, so connectors may run along edges.
 */
export function segmentCrossesBox(a: Point, b: Point, box: Bounds): boolean {
	const eps = 0.5;
	const minX = box.x + eps;
	const maxX = box.x + box.width - eps;
	const minY = box.y + eps;
	const maxY = box.y + box.height - eps;
	if (minX >= maxX || minY >= maxY) return false;
	if (a.y === b.y) {
		if (a.y <= minY || a.y >= maxY) return false;
		const lo = Math.min(a.x, b.x);
		const hi = Math.max(a.x, b.x);
		return hi > minX && lo < maxX;
	}
	if (a.x === b.x) {
		if (a.x <= minX || a.x >= maxX) return false;
		const lo = Math.min(a.y, b.y);
		const hi = Math.max(a.y, b.y);
		return hi > minY && lo < maxY;
	}
	// Diagonal segments: sample (only used for scoring, precision is not critical).
	for (let i = 1; i < 16; i++) {
		const t = i / 16;
		const x = a.x + (b.x - a.x) * t;
		const y = a.y + (b.y - a.y) * t;
		if (x > minX && x < maxX && y > minY && y < maxY) return true;
	}
	return false;
}

/** Total length of a polyline. */
export function polylineLength(points: Point[]): number {
	let len = 0;
	for (let i = 1; i < points.length; i++) len += dist(points[i - 1], points[i]);
	return len;
}

/** Point at a fraction (0..1) of a polyline's length, plus the direction of that segment. */
export function pointAlongPolyline(points: Point[], fraction: number): { point: Point; dir: Point } {
	if (points.length === 1) return { point: points[0], dir: { x: 1, y: 0 } };
	const total = polylineLength(points);
	let remaining = total * fraction;
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1];
		const b = points[i];
		const seg = dist(a, b);
		if (remaining <= seg || i === points.length - 1) {
			const t = seg === 0 ? 0 : Math.min(1, remaining / seg);
			return {
				point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
				dir: normalize(sub(b, a)),
			};
		}
		remaining -= seg;
	}
	return { point: points[points.length - 1], dir: { x: 1, y: 0 } };
}

/** Removes duplicate and collinear interior points of an axis-aligned polyline. */
export function simplifyPolyline(points: Point[]): Point[] {
	const out: Point[] = [];
	for (const p of points) {
		const last = out[out.length - 1];
		if (last && Math.abs(last.x - p.x) < 1e-6 && Math.abs(last.y - p.y) < 1e-6) continue;
		out.push(p);
	}
	let changed = true;
	while (changed && out.length > 2) {
		changed = false;
		for (let i = 1; i < out.length - 1; i++) {
			const a = out[i - 1];
			const b = out[i];
			const c = out[i + 1];
			const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
			if (Math.abs(cross) < 1e-6) {
				out.splice(i, 1);
				changed = true;
				break;
			}
		}
	}
	return out;
}

/**
 * Parallel copy of a polyline `d` units to the right of the direction of travel (negative `d`:
 * to the left; "right" as seen on screen, where y points down). Corners are mitered, so an
 * orthogonal route keeps its shape. Repeated points are dropped.
 */
export function offsetPolyline(points: Point[], d: number): Point[] {
	const pts: Point[] = [];
	for (const p of points) {
		const last = pts[pts.length - 1];
		if (!last || dist(last, p) > 1e-6) pts.push(p);
	}
	if (pts.length < 2 || d === 0) return pts.map((p) => ({ ...p }));
	const normals: Point[] = [];
	for (let i = 1; i < pts.length; i++) {
		const n = normalize(sub(pts[i], pts[i - 1]));
		normals.push({ x: -n.y, y: n.x });
	}
	return pts.map((p, i) => {
		if (i === 0) return add(p, scale(normals[0], d));
		if (i === pts.length - 1) return add(p, scale(normals[i - 1], d));
		const a = normals[i - 1];
		const b = normals[i];
		const sum = add(a, b);
		if (Math.hypot(sum.x, sum.y) < 1e-6) return add(p, scale(a, d)); // a full U-turn has no miter
		const m = normalize(sum);
		// Keep both offset segments exactly |d| away; capped so very sharp turns do not spike.
		const k = d / Math.max(m.x * a.x + m.y * a.y, 0.35);
		return add(p, scale(m, k));
	});
}

export function snap(value: number, grid: number): number {
	return grid > 0 ? Math.round(value / grid) * grid : value;
}

export function clamp(v: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, v));
}
