import type { Routing, Side } from "../model/types";
import {
	add,
	clamp,
	dist,
	normalize,
	pointAlongPolyline,
	pointsBounds,
	scale,
	SIDE_DIR,
	simplifyPolyline,
	sub,
	type Point,
} from "./geom";
import { finishPolyline, naturalSides, sampleCubic, type Route, type RouteEndpoint } from "./routing";
import { boundaryPoint, sideAnchor } from "./shapes";

/*
 * Routes that pass through waypoints the person placed. Without waypoints the automatic routes in
 * routing.ts are used; the spreadsheet exporter never uses these, a grid has no use for them.
 */

const STUB = 20;
/** A turn costs about this much length, like in the automatic elbow routes. */
const BEND_COST = 24;
/** Added when a leg would double back over the segment before it. */
const REVERSAL_COST = 10000;

/** The side of a block that faces a point. */
function facing(bounds: RouteEndpoint["bounds"], p: Point): Side {
	return naturalSides(bounds, { x: p.x, y: p.y, width: 0, height: 0 })[0];
}

const sideOrNull = (side: RouteEndpoint["side"]): Side | null => (side === "auto" ? null : side);

export function routeThrough(routing: Routing, from: RouteEndpoint, to: RouteEndpoint, via: readonly Point[]): Route {
	switch (routing) {
		case "straight":
			return straightThrough(from, to, via);
		case "curved":
			return curvedThrough(from, to, via);
		case "elbow":
		default:
			return elbowThrough(from, to, via);
	}
}

function straightThrough(from: RouteEndpoint, to: RouteEndpoint, via: readonly Point[]): Route {
	const start = from.side === "auto" ? boundaryPoint(from.shape, from.bounds, via[0]) : sideAnchor(from.shape, from.bounds, from.side);
	const end = to.side === "auto" ? boundaryPoint(to.shape, to.bounds, via[via.length - 1]) : sideAnchor(to.shape, to.bounds, to.side);
	return finishPolyline(tidy([start, ...via, end]), sideOrNull(from.side), sideOrNull(to.side));
}

const direction = (a: Point, b: Point): Point => normalize(sub(b, a));
const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;

/**
 * Drops repeated points and points in the middle of a straight run, but keeps the tip of an
 * out-and-back (a waypoint the link has to double back from): removing it would lose the waypoint.
 */
function tidy(points: Point[]): Point[] {
	const out: Point[] = [];
	for (const p of points) {
		const last = out[out.length - 1];
		if (last && Math.abs(last.x - p.x) < 1e-6 && Math.abs(last.y - p.y) < 1e-6) continue;
		out.push(p);
	}
	for (let i = out.length - 2; i >= 1; i--) {
		const [a, b, c] = [out[i - 1], out[i], out[i + 1]];
		const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
		if (Math.abs(cross) < 1e-6 && dot(sub(b, a), sub(c, b)) > 0) out.splice(i, 1);
	}
	return out;
}

/**
 * Right angles only: leave the block, go through each waypoint in turn, arrive at the other block.
 * Between two points the path turns once, along x first or along y first. Which one is chosen for
 * every leg together, so that no segment doubles back over the one before it (that would hide the
 * waypoint in between) and the path bends as little as possible.
 */
function elbowThrough(from: RouteEndpoint, to: RouteEndpoint, via: readonly Point[]): Route {
	const sa = from.side === "auto" ? facing(from.bounds, via[0]) : from.side;
	const sb = to.side === "auto" ? facing(to.bounds, via[via.length - 1]) : to.side;
	const pa = sideAnchor(from.shape, from.bounds, sa);
	const pb = sideAnchor(to.shape, to.bounds, sb);
	const s1 = add(pa, scale(SIDE_DIR[sa], STUB));
	const e1 = add(pb, scale(SIDE_DIR[sb], STUB));
	const keys = [s1, ...via, e1];
	const legs = keys.length - 1;

	interface Option {
		corner: Point;
		first: Point;
		last: Point;
		bends: number;
	}
	const options: Option[][] = [];
	for (let i = 0; i < legs; i++) {
		const [a, b] = [keys[i], keys[i + 1]];
		options.push(
			[{ x: b.x, y: a.y }, { x: a.x, y: b.y }].map((corner) => {
				const path = simplifyPolyline([a, corner, b]);
				return {
					corner,
					first: direction(path[0], path[1]),
					last: direction(path[path.length - 2], path[path.length - 1]),
					bends: path.length - 2,
				};
			}),
		);
	}
	const reverses = (heading: Point, next: Point) => (dot(heading, next) < -0.5 ? REVERSAL_COST : 0);
	// best[i][k]: the cheapest way to get through leg i ending with option k, and where it came from
	const best: { cost: number; from: number }[][] = [];
	for (let i = 0; i < legs; i++) {
		best.push(
			options[i].map((o, k) => {
				if (i === 0) return { cost: o.bends * BEND_COST + reverses(SIDE_DIR[sa], o.first), from: -1 };
				let pick = { cost: Infinity, from: 0 };
				options[i - 1].forEach((prev, j) => {
					const cost = best[i - 1][j].cost + o.bends * BEND_COST + reverses(prev.last, o.first);
					if (cost < pick.cost - 1e-6) pick = { cost, from: j };
				});
				return pick;
			}),
		);
	}
	const arrive = scale(SIDE_DIR[sb], -1);
	let k = 0;
	let total = Infinity;
	options[legs - 1].forEach((o, j) => {
		const cost = best[legs - 1][j].cost + reverses(o.last, arrive);
		if (cost < total - 1e-6) {
			total = cost;
			k = j;
		}
	});
	const chosen: Point[] = [];
	for (let i = legs - 1; i >= 0; i--) {
		chosen[i] = options[i][k].corner;
		k = best[i][k].from;
	}
	const out: Point[] = [pa, s1];
	for (let i = 0; i < legs; i++) out.push(chosen[i], keys[i + 1]);
	out.push(pb);
	return finishPolyline(tidy(out), sa, sb);
}

/** A smooth curve through the waypoints, leaving and entering the blocks straight out of their sides. */
function curvedThrough(from: RouteEndpoint, to: RouteEndpoint, via: readonly Point[]): Route {
	const sa = from.side === "auto" ? facing(from.bounds, via[0]) : from.side;
	const sb = to.side === "auto" ? facing(to.bounds, via[via.length - 1]) : to.side;
	const pa = sideAnchor(from.shape, from.bounds, sa);
	const pb = sideAnchor(to.shape, to.bounds, sb);
	const keys = [pa, ...via, pb];
	const last = keys.length - 1;
	const points: Point[] = [pa];
	for (let i = 0; i < last; i++) {
		const p0 = keys[i];
		const p1 = keys[i + 1];
		const reach = clamp(dist(p0, p1) * 0.4, 12, 200);
		// A waypoint is passed in the direction from the point before it to the point after it.
		const c1 = i === 0 ? add(p0, scale(SIDE_DIR[sa], reach)) : add(p0, scale(direction(keys[i - 1], keys[i + 1]), reach));
		const c2 = i + 1 === last ? add(p1, scale(SIDE_DIR[sb], reach)) : sub(p1, scale(direction(keys[i], keys[i + 2]), reach));
		points.push(c1, c2, p1);
	}
	let endDir = direction(points[points.length - 2], pb);
	if (endDir.x === 0 && endDir.y === 0) endDir = scale(SIDE_DIR[sb], -1);
	let startDir = direction(points[1], pa);
	if (startDir.x === 0 && startDir.y === 0) startDir = scale(SIDE_DIR[sa], -1);
	return {
		points,
		curved: true,
		start: pa,
		end: pb,
		endDir,
		startDir,
		labelPos: pointAlongPolyline(sampleCubic(points, 24), 0.5).point,
		fromSide: sa,
		toSide: sb,
		bounds: pointsBounds(points) ?? { x: pa.x, y: pa.y, width: 0, height: 0 },
	};
}

/* ----------------------------------------------------- editing a route */

/** Points of a route as a polyline: the route itself, or a curve sampled finely. */
function samples(route: Route): Point[] {
	return route.curved ? sampleCubic(route.points, 24) : route.points;
}

/** How far along the route (by length) the point of the route closest to `p` is. */
export function routeParam(route: Route, p: Point): number {
	const pts = samples(route);
	let along = 0;
	let best = { d: Infinity, s: 0 };
	for (let i = 1; i < pts.length; i++) {
		const a = pts[i - 1];
		const b = pts[i];
		const len = dist(a, b);
		const t = len === 0 ? 0 : clamp(((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len), 0, 1);
		const d = dist(p, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
		if (d < best.d - 1e-9) best = { d, s: along + len * t };
		along += len;
	}
	return best.s;
}

/**
 * Where a person can grab a route to bend it: the middle of each straight stretch of a polyline, or
 * of each curved piece, skipping stretches shorter than `minLength`.
 */
export function routeMidpoints(route: Route, minLength: number): Point[] {
	const out: Point[] = [];
	if (route.curved) {
		for (let i = 0; i + 3 < route.points.length; i += 3) {
			const piece = sampleCubic(route.points.slice(i, i + 4), 24);
			if (dist(route.points[i], route.points[i + 3]) >= minLength) out.push(pointAlongPolyline(piece, 0.5).point);
		}
		return out;
	}
	for (let i = 1; i < route.points.length; i++) {
		const a = route.points[i - 1];
		const b = route.points[i];
		if (dist(a, b) >= minLength) out.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
	}
	return out;
}

/** Where a new waypoint at `p` belongs in the list, so the route still visits them in order. */
export function waypointIndex(route: Route, waypoints: readonly Point[], p: Point): number {
	const at = routeParam(route, p);
	let index = 0;
	for (const w of waypoints) if (routeParam(route, w) < at - 1e-6) index++;
	return index;
}
