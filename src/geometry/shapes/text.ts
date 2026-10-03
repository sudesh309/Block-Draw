import { rectanglePath, type ShapeDef } from "./shape";

/** Text without a visible outline (the outline is still there for clicks and links). */
export const text: ShapeDef = {
	label: "Text only",
	path: rectanglePath,
	textBox: (w, h) => ({ x: 4, y: 4, width: Math.max(0, w - 8), height: Math.max(0, h - 8) }),
	dashedIcon: true,
};
