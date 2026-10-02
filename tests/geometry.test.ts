import { describe, expect, it } from "vitest";
import { offsetPolyline, segmentCrossesBox, simplifyPolyline } from "../src/geometry/geom";
import { routeConnector, trimRoute, type RouteEndpoint } from "../src/geometry/routing";
import { boundaryPoint, shapeContains, sideAnchor } from "../src/geometry/shapes";
import type { AnchorSide, BlockShape, Bounds } from "../src/model/types";

const ep = (b: Bounds, side: AnchorSide = "auto", shape: BlockShape = "rectangle"): RouteEndpoint => ({
	bounds: b,
	shape,
	side,
});

function assertOrthogonal(points: { x: number; y: number }[]) {
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1];
		const b = points[i];
		expect(a.x === b.x || a.y === b.y).toBe(true);
	}
}

function crossesAny(points: { x: number; y: number }[], boxes: Bounds[]): boolean {
	for (let i = 1; i < points.length; i++) {
		for (const box of boxes) if (segmentCrossesBox(points[i - 1], points[i], box)) return true;
	}
	return false;
}

describe("shapes", () => {
	const b = { x: 0, y: 0, width: 200, height: 100 };

	it("finds boundary points", () => {
		expect(boundaryPoint("rectangle", b, { x: 500, y: 50 })).toEqual({ x: 200, y: 50 });
		expect(boundaryPoint("rectangle", b, { x: 100, y: -500 })).toEqual({ x: 100, y: 0 });
		const e = boundaryPoint("ellipse", b, { x: 500, y: 50 });
		expect(e.x).toBeCloseTo(200);
		const d = boundaryPoint("diamond", b, { x: 100 + 100, y: 50 + 50 });
		// diamond edge from (200,50) to (100,100): x/100 + y/50 = 3 (in absolute coords)
		expect(d.x / 100 + d.y / 50).toBeCloseTo(3);
	});

	it("anchors on side midpoints", () => {
		expect(sideAnchor("rectangle", b, "top")).toEqual({ x: 100, y: 0 });
		expect(sideAnchor("rectangle", b, "right")).toEqual({ x: 200, y: 50 });
		expect(sideAnchor("ellipse", b, "bottom")).toEqual({ x: 100, y: 100 });
		expect(sideAnchor("rectangle", b, "left")).toEqual({ x: 0, y: 50 });
	});

	it("tests containment per shape", () => {
		expect(shapeContains("rectangle", b, { x: 2, y: 2 })).toBe(true);
		expect(shapeContains("ellipse", b, { x: 2, y: 2 })).toBe(false);
		expect(shapeContains("diamond", b, { x: 100, y: 50 })).toBe(true);
		expect(shapeContains("diamond", b, { x: 10, y: 10 })).toBe(false);
		expect(shapeContains("diamond", b, { x: 10, y: 10 }, 4)).toBe(true);
	});
});

describe("routing", () => {
	const A = { x: 0, y: 0, width: 160, height: 80 };

	it("routes aligned blocks with a single straight elbow segment", () => {
		const B = { x: 400, y: 0, width: 160, height: 80 };
		const r = routeConnector("elbow", ep(A), ep(B));
		expect(r.points).toEqual([
			{ x: 160, y: 40 },
			{ x: 400, y: 40 },
		]);
		expect(r.fromSide).toBe("right");
		expect(r.toSide).toBe("left");
		expect(r.endDir).toEqual({ x: 1, y: 0 });
	});

	it("routes diagonal blocks orthogonally without crossing them", () => {
		const B = { x: 400, y: 300, width: 160, height: 80 };
		const r = routeConnector("elbow", ep(A), ep(B));
		assertOrthogonal(r.points);
		expect(r.points.length).toBeLessThanOrEqual(4);
		expect(crossesAny(r.points, [A, B])).toBe(false);
	});

	it("routes around when the target is behind a pinned side", () => {
		const B = { x: -400, y: 20, width: 160, height: 80 };
		const r = routeConnector("elbow", ep(A, "right"), ep(B, "left"));
		assertOrthogonal(r.points);
		expect(r.fromSide).toBe("right");
		expect(r.toSide).toBe("left");
		expect(crossesAny(r.points, [A, B])).toBe(false);
		expect(r.points[0]).toEqual({ x: 160, y: 40 });
		expect(r.points[r.points.length - 1]).toEqual({ x: -400, y: 60 });
	});

	it("routes vertically stacked blocks top to bottom", () => {
		const B = { x: 0, y: 300, width: 160, height: 80 };
		const r = routeConnector("elbow", ep(A), ep(B));
		expect(r.fromSide).toBe("bottom");
		expect(r.toSide).toBe("top");
		expect(r.points).toEqual([
			{ x: 80, y: 80 },
			{ x: 80, y: 300 },
		]);
	});

	it("handles nearly touching blocks without reversing", () => {
		const B = { x: 170, y: 100, width: 160, height: 80 };
		const r = routeConnector("elbow", ep(A), ep(B));
		assertOrthogonal(r.points);
		expect(crossesAny(r.points, [A, B])).toBe(false);
	});

	it("clips straight routes at the shape outline", () => {
		const B = { x: 400, y: 0, width: 160, height: 80 };
		const r = routeConnector("straight", ep(A, "auto", "ellipse"), ep(B));
		expect(r.start.x).toBeCloseTo(160);
		expect(r.end.x).toBeCloseTo(400);
	});

	it("builds curved routes from facing sides", () => {
		const B = { x: 400, y: 200, width: 160, height: 80 };
		const r = routeConnector("curved", ep(A), ep(B));
		expect(r.curved).toBe(true);
		expect(r.points).toHaveLength(4);
		expect(r.fromSide).toBe("right");
		expect(r.toSide).toBe("left");
	});

	it("trims routes for arrowheads", () => {
		const B = { x: 400, y: 0, width: 160, height: 80 };
		const r = routeConnector("elbow", ep(A), ep(B));
		const pts = trimRoute(r, 0, 10);
		expect(pts[pts.length - 1]).toEqual({ x: 390, y: 40 });
		expect(pts[0]).toEqual({ x: 160, y: 40 });
	});

	it("quantizes intermediate coordinates for grid routing", () => {
		const B = { x: 13, y: 9, width: 4, height: 3 };
		const a = { x: 0, y: 0, width: 5, height: 4 };
		const r = routeConnector("elbow", ep(a), ep(B), { stub: 1, quantize: Math.round });
		for (const p of r.points.slice(1, -1)) {
			expect(Number.isInteger(p.x) || Number.isInteger(p.y)).toBe(true);
		}
	});
});

describe("polyline helpers", () => {
	it("simplifies collinear and duplicate points", () => {
		expect(
			simplifyPolyline([
				{ x: 0, y: 0 },
				{ x: 5, y: 0 },
				{ x: 5, y: 0 },
				{ x: 10, y: 0 },
				{ x: 10, y: 10 },
			]),
		).toEqual([
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
			{ x: 10, y: 10 },
		]);
	});

	it("only counts interior crossings", () => {
		const box = { x: 0, y: 0, width: 10, height: 10 };
		expect(segmentCrossesBox({ x: -5, y: 5 }, { x: 15, y: 5 }, box)).toBe(true);
		expect(segmentCrossesBox({ x: -5, y: 0 }, { x: 15, y: 0 }, box)).toBe(false);
		expect(segmentCrossesBox({ x: 10, y: 5 }, { x: 20, y: 5 }, box)).toBe(false);
	});
});

describe("offsetPolyline", () => {
	const round = (pts: { x: number; y: number }[]) => pts.map((p) => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 }));

	it("moves a segment to the right of its direction of travel", () => {
		expect(offsetPolyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], 2)).toEqual([{ x: 0, y: 2 }, { x: 10, y: 2 }]);
		expect(offsetPolyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], -2)).toEqual([{ x: 0, y: -2 }, { x: 10, y: -2 }]);
		expect(round(offsetPolyline([{ x: 0, y: 0 }, { x: 0, y: 10 }], 2))).toEqual([{ x: -2, y: 0 }, { x: -2, y: 10 }]);
	});

	it("miters the corners of an elbow", () => {
		const elbow = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
		expect(round(offsetPolyline(elbow, 2))).toEqual([{ x: 0, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 10 }]);
		expect(round(offsetPolyline(elbow, -2))).toEqual([{ x: 0, y: -2 }, { x: 12, y: -2 }, { x: 12, y: 10 }]);
	});

	it("puts the lane of the reversed route on the opposite side", () => {
		const elbow = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
		const back = offsetPolyline([...elbow].reverse(), 2);
		expect(round(back)).toEqual([{ x: 12, y: 10 }, { x: 12, y: -2 }, { x: 0, y: -2 }]);
	});

	it("ignores repeated points and survives degenerate input", () => {
		expect(offsetPolyline([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }], 1)).toEqual([{ x: 0, y: 1 }, { x: 10, y: 1 }]);
		expect(offsetPolyline([{ x: 5, y: 5 }], 3)).toEqual([{ x: 5, y: 5 }]);
		expect(offsetPolyline([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 0 }], 1)).toHaveLength(3);
		for (const p of offsetPolyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 1, y: 1 }], 2)) {
			expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
			expect(Math.hypot(p.x, p.y)).toBeLessThan(40);
		}
	});
});
