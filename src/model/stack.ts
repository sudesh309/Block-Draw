import { isBlock, isConnector, type DrawElement } from "./types";

/*
 * Stacking order. Frames are drawn below everything. Above them, from back to front: links that were
 * sent behind the blocks, the blocks, the links (the default: a link is never hidden by a block
 * around its ends), and blocks that were brought in front of the links. Within one level, the order
 * of the elements in the file decides.
 */
export const LEVEL_FRAME = 0;
export const LEVEL_LINK_BEHIND = 1;
export const LEVEL_BLOCK = 2;
export const LEVEL_LINK = 3;
export const LEVEL_BLOCK_FRONT = 4;

export function stackLevel(el: DrawElement): number {
	if (isConnector(el)) return el.behind ? LEVEL_LINK_BEHIND : LEVEL_LINK;
	if (isBlock(el)) return el.inFront ? LEVEL_BLOCK_FRONT : LEVEL_BLOCK;
	return LEVEL_FRAME;
}

/** The elements from back to front. */
export function inStackOrder(els: readonly DrawElement[]): DrawElement[] {
	return [...els].sort((a, b) => stackLevel(a) - stackLevel(b));
}
