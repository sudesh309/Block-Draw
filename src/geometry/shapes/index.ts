import type { BlockShape } from "../../model/types";
import { cylinder } from "./cylinder";
import { diamond } from "./diamond";
import { ellipse } from "./ellipse";
import { hexagon } from "./hexagon";
import { parallelogram } from "./parallelogram";
import { rectangle } from "./rectangle";
import { rounded } from "./rounded";
import type { ShapeDef } from "./shape";
import { text } from "./text";

export type { ShapeDef } from "./shape";

/**
 * Every block shape, keyed by the id stored in the file (BLOCK_SHAPES in model/types.ts, which
 * also sets the picker order). TypeScript refuses to build until the two agree.
 */
export const SHAPES: Record<BlockShape, ShapeDef> = {
	rounded,
	rectangle,
	ellipse,
	diamond,
	parallelogram,
	hexagon,
	cylinder,
	text,
};
