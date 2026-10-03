import type { AnchorSide, BlockShape, Bounds, Routing, Side } from "../model/types";
import {
	add,
	center,
	clamp,
	dist,
	normalize,
	pointAlongPolyline,
	pointsBounds,
	polylineLength,
	scale,
	segmentCrossesBox,
	SIDE_DIR,
	SIDES,
	simplifyPolyline,
	sub,
	type Point,
} from "./geom";
import { boundaryPoint, sideAnchor } from "./shapes";

export interface RouteEndpoint {
	bounds: Bounds;
	shape: BlockShape;
	side: AnchorSide;
}

export interface Route {
	/** Polyline for straight/elbow routes; for curved ones [start, control1, control2, end], continued by further control1, control2, end triples when the route has waypoints. */
	points: Point[];
	curved: boolean;
	start: Point;
	end: Point;
	/** Unit vector pointing along the path into the end point (arrowhead direction). */
	endDir: Point;
	/** Unit vector pointing along the path (reversed) into the start point. */
	startDir: Point;
	labelPos: Point;
	fromSide: Side | null;
	toSide: Side | null;
	bounds: Bounds;
}

export interface RouteOptions {
	/** Length of the straight "stub" leaving/entering a block on elbow routes. */
	stub?: number;
	/** Rounds intermediate coordinates (used by the spreadsheet grid router). */
	quantize?: (v: number) => number;
	/** Overrides where a connector attaches to a side (default: the side's midpoint). */
	anchor?: (endpoint: RouteEndpoint, side: Side) => Point;
	/** Extra cost for a candidate path (e.g. crossing other blocks or overlapping lines). */
	extraCost?: (points: Point[]) => number;
}

const DEFAULT_STUB = 20;
const BEND_COST = 24;
const CROSS_COST = 10000;

export function routeConnector(
	routing: Routing,
	from: RouteEndpoint,
	to: RouteEndpoint,
	opts: RouteOptions = {},
): Route {
	switch (routing) {
		case "straight":
			return straightRoute(from, to);
		case "curved":
			return curvedRoute(from, to);
		case "elbow":
		default:
			return elbowRoute(from, to, opts);
	}
}

export function finishPolyline(points: Point[], fromSide: Side | null, toSide: Side | null): Route {
	const pts = points.length >= 2 ? points : [points[0], points[0]];
	const n = pts.length;
	const endDir = normalize(sub(pts[n - 1], pts[n - 2]));
	const startDir = normalize(sub(pts[0], pts[1]));
	return {
		points: pts,
		curved: false,
		start: pts[0],
		end: pts[n - 1],
		endDir,
		startDir,
		labelPos: pointAlongPolyline(pts, 0.5).point,
		fromSide,
		toSide,
		bounds: pointsBounds(pts) ?? { x: pts[0].x, y: pts[0].y, width: 0, height: 0 },
	};
}

function straightRoute(from: RouteEndpoint, to: RouteEndpoint): Route {
	const ca = center(from.bounds);
	const cb = center(to.bounds);
	let start: Point;
	let end: Point;
	if (from.side !== "auto" && to.side !== "auto") {
		start = sideAnchor(from.shape, from.bounds, from.side);
		end = sideAnchor(to.shape, to.bounds, to.side);
	} else if (from.side !== "auto") {
		start = sideAnchor(from.shape, from.bounds, from.side);
		end = boundaryPoint(to.shape, to.bounds, start);
	} else if (to.side !== "auto") {
		end = sideAnchor(to.shape, to.bounds, to.side);
		start = boundaryPoint(from.shape, from.bounds, end);
	} else {
		start = boundaryPoint(from.shape, from.bounds, cb);
		end = boundaryPoint(to.shape, to.bounds, ca);
	}
	return finishPolyline([start, end], from.side === "auto" ? null : from.side, to.side === "auto" ? null : to.side);
}

/** Picks facing sides from the dominant axis between the two centers. */
export function naturalSides(a: Bounds, b: Bounds): [Side, Side] {
	const ca = center(a);
	const cb = center(b);
	const dx = cb.x - ca.x;
	const dy = cb.y - ca.y;
	if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ["right", "left"] : ["left", "right"];
	return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
}

function curvedRoute(from: RouteEndpoint, to: RouteEndpoint): Route {
	const [na, nb] = naturalSides(from.bounds, to.bounds);
	const sa: Side = from.side === "auto" ? na : from.side;
	const sb: Side = to.side === "auto" ? nb : to.side;
	const pa = sideAnchor(from.shape, from.bounds, sa);
	const pb = sideAnchor(to.shape, to.bounds, sb);
	const k = clamp(dist(pa, pb) * 0.4, 30, 200);
	const c1 = add(pa, scale(SIDE_DIR[sa], k));
	const c2 = add(pb, scale(SIDE_DIR[sb], k));
	const mid = cubicPoint(pa, c1, c2, pb, 0.5);
	let endDir = normalize(sub(pb, c2));
	if (endDir.x === 0 && endDir.y === 0) endDir = scale(SIDE_DIR[sb], -1);
	let startDir = normalize(sub(pa, c1));
	if (startDir.x === 0 && startDir.y === 0) startDir = scale(SIDE_DIR[sa], -1);
	const points = [pa, c1, c2, pb];
	return {
		points,
		curved: true,
		start: pa,
		end: pb,
		endDir,
		startDir,
		labelPos: mid,
		fromSide: sa,
		toSide: sb,
		bounds: pointsBounds(points) ?? { x: pa.x, y: pa.y, width: 0, height: 0 },
	};
}

export function cubicPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
	const u = 1 - t;
	const a = u * u * u;
	const b = 3 * u * u * t;
	const c = 3 * u * t * t;
	const d = t * t * t;
	return {
		x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
		y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
	};
}

/** Stub length: shortened when two facing sides are close together. */
function stubLength(a: Bounds, sa: Side, b: Bounds, sb: Side, base: number): number {
	let gap = Infinity;
	if (sa === "right" && sb === "left") gap = b.x - (a.x + a.width);
	else if (sa === "left" && sb === "right") gap = a.x - (b.x + b.width);
	else if (sa === "bottom" && sb === "top") gap = b.y - (a.y + a.height);
	else if (sa === "top" && sb === "bottom") gap = a.y - (b.y + b.height);
	if (gap > 0 && gap < base * 2) return gap / 2;
	return base;
}

function scorePath(points: Point[], a: Bounds, b: Bounds, extra?: (points: Point[]) => number): number {
	const simple = simplifyPolyline(points);
	let score = polylineLength(simple) + (simple.length - 2) * BEND_COST + (extra ? extra(simple) : 0);
	for (let i = 1; i < simple.length; i++) {
		if (segmentCrossesBox(simple[i - 1], simple[i], a)) score += CROSS_COST;
		if (segmentCrossesBox(simple[i - 1], simple[i], b)) score += CROSS_COST;
	}
	return score;
}

function elbowRoute(from: RouteEndpoint, to: RouteEndpoint, opts: RouteOptions): Route {
	const q = opts.quantize ?? ((v: number) => v);
	const baseStub = opts.stub ?? DEFAULT_STUB;
	const sidesA = from.side === "auto" ? SIDES : [from.side];
	const sidesB = to.side === "auto" ? SIDES : [to.side];
	const a = from.bounds;
	const b = to.bounds;

	let best: { points: Point[]; score: number; sa: Side; sb: Side } | null = null;
	for (const sa of sidesA) {
		for (const sb of sidesB) {
			const pa = opts.anchor ? opts.anchor(from, sa) : sideAnchor(from.shape, a, sa);
			const pb = opts.anchor ? opts.anchor(to, sb) : sideAnchor(to.shape, b, sb);
			const stub = opts.quantize ? baseStub : stubLength(a, sa, b, sb, baseStub);
			const s1 = add(pa, scale(SIDE_DIR[sa], stub));
			const e1 = add(pb, scale(SIDE_DIR[sb], stub));
			// Vertical channels (x) and horizontal channels (y) the path may run through:
			// halfway between the stubs, or outside both blocks to detour around them.
			const xs = [
				q((s1.x + e1.x) / 2),
				q(Math.min(a.x, b.x) - baseStub),
				q(Math.max(a.x + a.width, b.x + b.width) + baseStub),
			];
			const ys = [
				q((s1.y + e1.y) / 2),
				q(Math.min(a.y, b.y) - baseStub),
				q(Math.max(a.y + a.height, b.y + b.height) + baseStub),
			];
			const candidates: Point[][] = [
				[pa, s1, { x: s1.x, y: e1.y }, e1, pb],
				[pa, s1, { x: e1.x, y: s1.y }, e1, pb],
			];
			for (const x of xs) candidates.push([pa, s1, { x, y: s1.y }, { x, y: e1.y }, e1, pb]);
			for (const y of ys) candidates.push([pa, s1, { x: s1.x, y }, { x: e1.x, y }, e1, pb]);
			for (const c of candidates) {
				// A leg that is not axis-aligned would be a diagonal: skip such candidates.
				let orthogonal = true;
				for (let i = 1; i < c.length; i++) {
					if (Math.abs(c[i].x - c[i - 1].x) > 1e-6 && Math.abs(c[i].y - c[i - 1].y) > 1e-6) {
						orthogonal = false;
						break;
					}
				}
				if (!orthogonal) continue;
				const score = scorePath(c, a, b, opts.extraCost);
				if (!best || score < best.score - 1e-6) best = { points: c, score, sa, sb };
			}
		}
	}
	if (!best) return straightRoute(from, to);
	return finishPolyline(simplifyPolyline(best.points), best.sa, best.sb);
}

/** SVG path data for a route. */
export function routePathData(route: Route): string {
	const r = (n: number) => Math.round(n * 100) / 100;
	const p = route.points;
	if (route.curved) {
		let d = `M${r(p[0].x)},${r(p[0].y)}`;
		for (let i = 1; i + 2 < p.length; i += 3) {
			d += ` C${r(p[i].x)},${r(p[i].y)} ${r(p[i + 1].x)},${r(p[i + 1].y)} ${r(p[i + 2].x)},${r(p[i + 2].y)}`;
		}
		return d;
	}
	return p.map((pt, i) => `${i === 0 ? "M" : "L"}${r(pt.x)},${r(pt.y)}`).join(" ");
}

/** Approximate distance from `p` to the route (for hit testing). */
export function distanceToRoute(route: Route, p: Point): number {
	const pts = route.curved ? sampleCubic(route.points, 24) : route.points;
	let best = Infinity;
	for (let i = 1; i < pts.length; i++) {
		best = Math.min(best, distToSeg(p, pts[i - 1], pts[i]));
	}
	return best;
}

function distToSeg(p: Point, a: Point, b: Point): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const lenSq = dx * dx + dy * dy;
	if (lenSq === 0) return dist(p, a);
	const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq, 0, 1);
	return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** Samples a curve made of cubic pieces ([start, c1, c2, end, c1, c2, end, ...]), `steps` points per piece. */
export function sampleCubic(points: Point[], steps: number): Point[] {
	const out: Point[] = [];
	for (let i = 0; i + 3 < points.length; i += 3) {
		for (let k = i === 0 ? 0 : 1; k <= steps; k++) out.push(cubicPoint(points[i], points[i + 1], points[i + 2], points[i + 3], k / steps));
	}
	return out;
}

/** Moves the route's end point back by `by` units (so the line does not poke through an arrowhead). */
export function trimRoute(route: Route, atStart: number, atEnd: number): Point[] {
	const pts = route.points.map((p) => ({ ...p }));
	const n = pts.length;
	if (atEnd > 0) {
		const prev = pts[n - 2];
		const seg = dist(prev, pts[n - 1]);
		const k = seg > 0 ? Math.min(atEnd, seg * 0.9) / seg : 0;
		pts[n - 1] = { x: pts[n - 1].x + (prev.x - pts[n - 1].x) * k, y: pts[n - 1].y + (prev.y - pts[n - 1].y) * k };
	}
	if (atStart > 0) {
		const next = pts[1];
		const seg = dist(next, pts[0]);
		const k = seg > 0 ? Math.min(atStart, seg * 0.9) / seg : 0;
		pts[0] = { x: pts[0].x + (next.x - pts[0].x) * k, y: pts[0].y + (next.y - pts[0].y) * k };
	}
	return pts;
}
