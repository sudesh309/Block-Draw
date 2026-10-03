import type { BlockElement } from "../model/types";
import { layoutBlockText } from "../render/text";

/** Grows a block so its text fits (never shrinks it). */
export function fitBlockHeight(block: BlockElement): BlockElement {
	const need = layoutBlockText(block).requiredHeight;
	if (need <= block.height) return block;
	return { ...block, height: Math.ceil(need / 10) * 10 };
}
