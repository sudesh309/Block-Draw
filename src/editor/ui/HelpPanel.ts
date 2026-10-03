import { helpRows } from "../commands";
import { el } from "../dom";
import type { Editor } from "../Editor";
import { iconButton } from "./controls";

export class HelpPanel {
	readonly el: HTMLDivElement;

	constructor(private readonly ed: Editor) {
		this.el = el("div", "bd-help bd-panel", ed.root);
		const head = el("div", "bd-panel-head", this.el);
		el("div", "bd-panel-title", head, "Keyboard shortcuts");
		iconButton(head, "close", "Close", () => this.toggle(false));
		const table = el("div", "bd-help-grid", this.el);
		for (const { group, rows } of helpRows()) {
			el("div", "bd-help-group", table, group);
			for (const { keys, label } of rows) {
				el("div", "bd-help-keys", table, keys);
				el("div", "bd-help-what", table, label);
			}
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
