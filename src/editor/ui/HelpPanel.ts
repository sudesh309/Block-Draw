import { el } from "../dom";
import type { Editor } from "../Editor";
import { iconButton } from "./controls";

const SHORTCUTS: [string, string][] = [
	["V / H", "Select / pan tool (or hold Space and drag)"],
	["B, O, D", "Block, ellipse block, decision block"],
	["A", "Connector tool"],
	["F", "Frame tool"],
	["Double-click", "Add a block, or edit the text under the pointer"],
	["Drag an edge dot", "Connect blocks — drop on empty space to create a connected block"],
	["Click an edge dot", "Add a connected block in that direction"],
	["Ctrl/Cmd+K", "Link the selected block to a frame or note"],
	["Ctrl/Cmd+click", "Follow a block's link"],
	["[ / ]", "Previous / next frame"],
	["Alt+←", "Back to where you were before following a link"],
	["Enter", "Edit the selected element's text"],
	["Ctrl/Cmd+D", "Duplicate (or Alt+drag)"],
	["Ctrl/Cmd+Z / Shift+Z", "Undo / redo"],
	["Arrows", "Nudge (Shift = 5 grid steps)"],
	["Shift+1 / Shift+2", "Zoom to fit / to selection"],
	["+ / − / Shift+0", "Zoom in / out / 100%"],
	["Ctrl/Cmd+] / [", "Bring forward / send backward"],
	["Delete", "Delete selection"],
];

export class HelpPanel {
	readonly el: HTMLDivElement;

	constructor(private readonly ed: Editor) {
		this.el = el("div", "bd-help bd-panel", ed.root);
		const head = el("div", "bd-panel-head", this.el);
		el("div", "bd-panel-title", head, "Keyboard shortcuts");
		iconButton(head, "close", "Close", () => this.toggle(false));
		const table = el("div", "bd-help-grid", this.el);
		for (const [keys, what] of SHORTCUTS) {
			el("div", "bd-help-keys", table, keys);
			el("div", "bd-help-what", table, what);
		}
	}

	isOpen(): boolean {
		return this.el.classList.contains("is-open");
	}

	toggle(force?: boolean): void {
		const open = force ?? !this.isOpen();
		this.el.classList.toggle("is-open", open);
		this.ed.requestRender();
	}
}
