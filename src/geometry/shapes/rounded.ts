import { f, paddedTextBox, type ShapeDef } from "./shape";

/** Corner radius of the rounded shape. */
export function roundedRadius(width: number, height: number): number {
	return Math.max(0, Math.min(16, width / 4, height / 4));
}

export const rounded: ShapeDef = {
	label: "Rounded",
	path(w, h) {
		const r = roundedRadius(w, h);
		return (
			`M${f(r)},0 H${f(w - r)} A${f(r)},${f(r)} 0 0 1 ${f(w)},${f(r)} ` +
			`V${f(h - r)} A${f(r)},${f(r)} 0 0 1 ${f(w - r)},${f(h)} ` +
			`H${f(r)} A${f(r)},${f(r)} 0 0 1 0,${f(h - r)} ` +
			`V${f(r)} A${f(r)},${f(r)} 0 0 1 ${f(r)},0 Z`
		);
	},
	textBox: paddedTextBox,
};
