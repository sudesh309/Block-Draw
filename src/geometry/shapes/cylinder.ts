import { f, type ShapeDef } from "./shape";

/** Height of the cylinder's top and bottom caps. */
export function cylinderCap(width: number, height: number): number {
	return Math.min(height * 0.15, width * 0.25, 14);
}

export const cylinder: ShapeDef = {
	label: "Database",
	path(w, h) {
		const ry = cylinderCap(w, h);
		return `M0,${f(ry)} A${f(w / 2)},${f(ry)} 0 0 1 ${f(w)},${f(ry)} ` + `V${f(h - ry)} A${f(w / 2)},${f(ry)} 0 0 1 0,${f(h - ry)} Z`;
	},
	decoration(w, h) {
		const ry = cylinderCap(w, h);
		return `M0,${f(ry)} A${f(w / 2)},${f(ry)} 0 0 0 ${f(w)},${f(ry)}`;
	},
	textBox(w, h) {
		const pad = 8;
		const ry = cylinderCap(w, h);
		return { x: pad, y: ry * 2 + 2, width: Math.max(0, w - 2 * pad), height: Math.max(0, h - ry * 3 - 4) };
	},
};
