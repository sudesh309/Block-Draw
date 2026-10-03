import type { Bounds, Point } from "./types";

export function center(b: Bounds): Point {
	return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

export function containsPoint(b: Bounds, p: Point, margin = 0): boolean {
	return (
		p.x >= b.x - margin &&
		p.x <= b.x + b.width + margin &&
		p.y >= b.y - margin &&
		p.y <= b.y + b.height + margin
	);
}
