import type { Bounds, Point } from "../../model/types";

/**
 * One row of the SHAPES table: everything Block Draw needs to know about a block shape. Each
 * shape lives in its own file next to this one; index.ts lists them.
 */
export interface ShapeDef {
	/** Name in the shape picker. */
	label: string;
	/** Outline as SVG path data in local coordinates (0,0)-(w,h). The picker icon draws it too. */
	path(w: number, h: number): string;
	/** Extra strokes drawn over the fill, such as a cylinder's front lip. */
	decoration?(w: number, h: number): string;
	/**
	 * The visible outline, for clicks and for where straight links meet the border: a polygon in
	 * absolute coordinates, or "ellipse". Without it the shape is its bounding rectangle.
	 */
	outline?: ((b: Bounds) => Point[]) | "ellipse";
	/** How far in from the left and right edges links attach (slanted sides). Default 0. */
	sideInset?(w: number, h: number): number;
	/** Box available for the text, relative to the top-left corner. */
	textBox(w: number, h: number): Bounds;
	/** Draw the picker icon dashed (the shape has no visible outline). */
	dashedIcon?: boolean;
}

/** Rounds to two decimals for compact path data. */
export const f = (n: number) => (Math.round(n * 100) / 100).toString();

export const rectanglePath = (w: number, h: number) => `M0,0 H${f(w)} V${f(h)} H0 Z`;

/** Text box of a shape with straight sides: the bounds minus 8 on every side. */
export function paddedTextBox(w: number, h: number): Bounds {
	const pad = 8;
	return { x: pad, y: pad, width: Math.max(0, w - 2 * pad), height: Math.max(0, h - 2 * pad) };
}
