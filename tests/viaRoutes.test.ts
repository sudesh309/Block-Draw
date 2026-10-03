import { describe, expect, it } from "vitest";
import type { Point } from "../src/geometry/geom";
import { distanceToRoute, routeConnector, routePathData, type RouteEndpoint } from "../src/geometry/routing";
import { routeMidpoints, routeParam, routeThrough, waypointIndex } from "../src/geometry/viaRoutes";
import { routeFor } from "../src/render/elements";
import type { AnchorSide } from "../src/model/types";
import { block, connector } from "./helpers";

const end = (x: number, y: number, side: AnchorSide = "auto"): RouteEndpoint => ({ bounds: { x, y, width: 160, height: 80 }, shape: "rounded", side });
const A = () => end(0, 0);
const B = () => end(500, 300);

/** Deterministic pseudo-random numbers, so a failing case can be replayed. */
function random(seed: number): () => number {
	let s = seed;
	return () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return s / 2 ** 32;
	};
}

describe("routes through waypoints", () => {
	it("a straight link goes from block to waypoint to block", () => {
		const route = routeThrough("straight", A(), B(), [{ x: 300, y: -100 }]);
		expect(route.curved).toBe(false);
		expect(route.points.some((p) => p.x === 300 && p.y === -100)).toBe(true);
		const [first, last] = [route.points[0], route.points[route.points.length - 1]];
		// the ends are on the borders of the blocks, facing the waypoint
		expect(first.y).toBeLessThanOrEqual(0 + 1e-6);
		expect(last.x).toBeGreaterThanOrEqual(500 - 1e-6);
	});

	it("an elbow link uses right angles only and visits every waypoint in order", () => {
		const via: Point[] = [{ x: 260, y: -60 }, { x: 420, y: 200 }];
		const route = routeThrough("elbow", A(), B(), via);
		for (let i = 1; i < route.points.length; i++) {
			const [a, b] = [route.points[i - 1], route.points[i]];
			expect(Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6, `segment ${i} is horizontal or vertical`).toBe(true);
		}
		for (const w of via) expect(distanceToRoute(route, w)).toBeLessThan(1e-6);
		expect(routeParam(route, via[0])).toBeLessThan(routeParam(route, via[1]));
	});

	it("an elbow link never doubles back over itself, wherever the waypoints are", () => {
		const next = random(7);
		for (let n = 0; n < 600; n++) {
			const via = Array.from({ length: 1 + Math.floor(next() * 3) }, () => ({ x: Math.round(next() * 900 - 200), y: Math.round(next() * 700 - 200) }));
			const sides: AnchorSide[] = ["auto", "top", "right", "bottom", "left"];
			const from = end(0, 0, sides[Math.floor(next() * 5)]);
			const to = end(500, 300, sides[Math.floor(next() * 5)]);
			const route = routeThrough("elbow", from, to, via);
			for (let i = 1; i < route.points.length; i++) {
				const [a, b] = [route.points[i - 1], route.points[i]];
				expect(Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6, `case ${n}: segment ${i} is axis-aligned`).toBe(true);
			}
			for (const w of via) expect(distanceToRoute(route, w), `case ${n}: passes through ${JSON.stringify(w)}`).toBeLessThan(1e-6);
			expect(Number.isFinite(route.bounds.width) && Number.isFinite(route.endDir.x)).toBe(true);
		}
	});

	it("a curved link is one smooth curve through the waypoints", () => {
		const via: Point[] = [{ x: 250, y: -120 }, { x: 600, y: 120 }];
		const route = routeThrough("curved", A(), B(), via);
		expect(route.curved).toBe(true);
		expect((route.points.length - 1) % 3).toBe(0);
		expect(route.points).toHaveLength(1 + 3 * (via.length + 1));
		for (const w of via) expect(distanceToRoute(route, w)).toBeLessThan(0.5);
		const d = routePathData(route);
		expect(d.startsWith("M")).toBe(true);
		expect(d.match(/C/g)).toHaveLength(via.length + 1);
	});

	it("without waypoints a link is routed exactly as before", () => {
		const a = block("a", 0, 0);
		const b = block("b", 500, 300);
		const plain = connector("c", "a", "b");
		const same = connector("c", "a", "b", { waypoints: [] });
		expect(routeFor(same, a, b)).toEqual(routeFor(plain, a, b));
		expect(routeFor(plain, a, b)).toEqual(routeConnector("elbow", { bounds: a, shape: "rounded", side: "auto" }, { bounds: b, shape: "rounded", side: "auto" }));
		expect(routeFor(connector("c", "a", "b", { waypoints: [{ x: 300, y: -50 }] }), a, b)).not.toEqual(routeFor(plain, a, b));
	});
});

describe("editing a route", () => {
	const via: Point[] = [{ x: 260, y: -60 }, { x: 420, y: 200 }];
	const route = routeThrough("elbow", A(), B(), via);

	it("offers a handle in the middle of each long enough stretch", () => {
		const handles = routeMidpoints(route, 24);
		expect(handles.length).toBeGreaterThanOrEqual(3);
		for (const h of handles) expect(distanceToRoute(route, h)).toBeLessThan(1e-6);
		expect(routeMidpoints(route, 1e9)).toEqual([]);
		const curved = routeThrough("curved", A(), B(), via);
		expect(routeMidpoints(curved, 24)).toHaveLength(via.length + 1);
	});

	it("puts a new waypoint where the route visits it: before, between or after the others", () => {
		const first = routeParam(route, via[0]);
		const second = routeParam(route, via[1]);
		const at = (s: number) => {
			// the point of the route that far along
			let along = 0;
			for (let i = 1; i < route.points.length; i++) {
				const [a, b] = [route.points[i - 1], route.points[i]];
				const len = Math.hypot(b.x - a.x, b.y - a.y);
				if (along + len >= s) return { x: a.x + ((b.x - a.x) * (s - along)) / len, y: a.y + ((b.y - a.y) * (s - along)) / len };
				along += len;
			}
			return route.points[route.points.length - 1];
		};
		expect(waypointIndex(route, via, at(first / 2))).toBe(0);
		expect(waypointIndex(route, via, at((first + second) / 2))).toBe(1);
		expect(waypointIndex(route, via, at(second + 20))).toBe(2);
	});
});
