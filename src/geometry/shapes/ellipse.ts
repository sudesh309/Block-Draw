import { f, type ShapeDef } from "./shape";

export const ellipse: ShapeDef = {
	label: "Ellipse",
	path: (w, h) => `M0,${f(h / 2)} A${f(w / 2)},${f(h / 2)} 0 1 1 ${f(w)},${f(h / 2)} ` + `A${f(w / 2)},${f(h / 2)} 0 1 1 0,${f(h / 2)} Z`,
	outline: "ellipse",
	textBox(w, h) {
		const iw = w * 0.72;
		const ih = h * 0.72;
		return { x: (w - iw) / 2 + 2, y: (h - ih) / 2, width: Math.max(0, iw - 4), height: ih };
	},
};
