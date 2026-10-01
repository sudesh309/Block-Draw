import type { FrameElement } from "../model/types";

export interface MenuItemSpec {
	title: string;
	icon?: string;
	onClick: () => void;
	disabled?: boolean;
	checked?: boolean;
	warning?: boolean;
	/** Draw a separator before this item. */
	separator?: boolean;
}

export interface LinkPickOptions {
	current: string | null;
	frames: FrameElement[];
	/** Frame of the block being linked (excluded from frame suggestions). */
	ownFrameId: string | null;
}

/**
 * Everything the editor needs from its environment. Obsidian implements this in the view;
 * the browser test harness implements it with plain DOM.
 */
export interface EditorHost {
	showMenu(items: MenuItemSpec[], position: { x: number; y: number }): void;
	notice(message: string): void;
	/** Opens a vault link (`[[...]]`) or external URL. Frame links are handled by the editor. */
	openLink(link: string, newLeaf: boolean): void;
	/**
	 * Lets the user choose a link target. Resolves to the new link, `null` to remove the link,
	 * or `undefined` when cancelled.
	 */
	pickLink(options: LinkPickOptions): Promise<string | null | undefined>;
	/** Human readable label for a stored link (e.g. the note's basename). */
	describeLink?(link: string): string;
	/** Items for the toolbar's export menu. */
	exportMenu?(): MenuItemSpec[];
	isMac: boolean;
}
