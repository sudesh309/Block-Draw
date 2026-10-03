import { f, type ShapeDef } from "./shape";

export const diamond: ShapeDef = {
	label: "Decision",
	path: (w, h) => `M${f(w / 2)},0 L${f(w)},${f(h / 2)} L${f(w / 2)},${f(h)} L0,${f(h / 2)} Z`,
	outline: ({ x, y, width: w, height: h }) => [
		{ x: x + w / 2, y },
		{ x: x + w, y: y + h / 2 },
		{ x: x + w / 2, y: y + h },
		{ x, y: y + h / 2 },
	],
	textBox(w, h) {
		const iw = w * 0.56;
		const ih = h * 0.56;
		return { x: (w - iw) / 2, y: (h - ih) / 2, width: iw, height: ih };
	},
};
