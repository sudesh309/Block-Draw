import { f, type ShapeDef } from "./shape";

function inset(width: number, height: number): number {
	return Math.min(width * 0.25, height * 0.5);
}

export const hexagon: ShapeDef = {
	label: "Preparation",
	path(w, h) {
		const s = inset(w, h);
		return `M${f(s)},0 L${f(w - s)},0 L${f(w)},${f(h / 2)} L${f(w - s)},${f(h)} L${f(s)},${f(h)} L0,${f(h / 2)} Z`;
	},
	outline({ x, y, width: w, height: h }) {
		const s = inset(w, h);
		return [
			{ x: x + s, y },
			{ x: x + w - s, y },
			{ x: x + w, y: y + h / 2 },
			{ x: x + w - s, y: y + h },
			{ x: x + s, y: y + h },
			{ x, y: y + h / 2 },
		];
	},
	textBox(w, h) {
		const pad = 8;
		const s = inset(w, h) * 0.75;
		return { x: s, y: pad, width: Math.max(0, w - 2 * s), height: Math.max(0, h - 2 * pad) };
	},
};
