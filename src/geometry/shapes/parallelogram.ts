import { f, type ShapeDef } from "./shape";

function skew(width: number, height: number): number {
	return Math.min(width * 0.2, height * 0.6);
}

export const parallelogram: ShapeDef = {
	label: "Input / output",
	path(w, h) {
		const s = skew(w, h);
		return `M${f(s)},0 L${f(w)},0 L${f(w - s)},${f(h)} L0,${f(h)} Z`;
	},
	outline({ x, y, width: w, height: h }) {
		const s = skew(w, h);
		return [
			{ x: x + s, y },
			{ x: x + w, y },
			{ x: x + w - s, y: y + h },
			{ x, y: y + h },
		];
	},
	sideInset: (w, h) => skew(w, h) / 2,
	textBox(w, h) {
		const pad = 8;
		const s = skew(w, h);
		return { x: s + 2, y: pad, width: Math.max(0, w - 2 * s - 4), height: Math.max(0, h - 2 * pad) };
	},
};
