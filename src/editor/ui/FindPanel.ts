import { isBlock, isConnector, isFrame, type Bounds, type DrawElement } from "../../model/types";
import { el } from "../dom";
import type { Editor } from "../Editor";
import { iconButton } from "./controls";

/** Everything on an element that can be searched, in one lowercase string. */
function searchText(e: DrawElement): string {
	const parts = isBlock(e) ? [e.title, e.tag, e.description, e.comment, ...(e.table ?? []).flat()] : isFrame(e) ? [e.title, e.description] : [e.label, e.comment];
	return parts.join("\n").toLowerCase();
}

/** Find (Ctrl/Cmd+F): type to search blocks, frames and links; Enter walks through the matches. */
export class FindPanel {
	private readonly box: HTMLDivElement;
	private readonly input: HTMLInputElement;
	private readonly count: HTMLSpanElement;
	private matches: string[] = [];
	private index = 0;

	constructor(private readonly ed: Editor) {
		this.box = el("div", "bd-find bd-panel", ed.root);
		this.input = el("input", "bd-find-input", this.box);
		this.input.type = "text";
		this.input.placeholder = "Find in drawing";
		this.input.setAttribute("aria-label", "Find in drawing");
		this.count = el("span", "bd-find-count", this.box);
		iconButton(this.box, "up", "Previous match — Shift+Enter", () => this.step(-1));
		iconButton(this.box, "down", "Next match — Enter", () => this.step(1));
		iconButton(this.box, "close", "Close — Esc", () => this.toggle(false));
		ed.listen(this.box, "pointerdown", (e) => e.stopPropagation());
		ed.listen(this.input, "input", () => this.search());
		ed.listen(this.input, "keydown", (e) => {
			const k = e as KeyboardEvent;
			k.stopPropagation();
			if (k.key === "Enter") {
				k.preventDefault();
				this.step(k.shiftKey ? -1 : 1);
			} else if (k.key === "Escape") {
				k.preventDefault();
				this.toggle(false);
			}
		});
	}

	isOpen(): boolean {
		return this.box.classList.contains("is-open");
	}

	toggle(open = !this.isOpen()): void {
		this.box.classList.toggle("is-open", open);
		if (open) {
			this.input.focus({ preventScroll: true });
			this.input.select();
			this.search();
		} else {
			this.ed.root.focus({ preventScroll: true });
		}
		this.ed.requestRender();
	}

	private search(): void {
		const q = this.input.value.trim().toLowerCase();
		this.matches = q ? this.ed.elements.filter((e) => searchText(e).includes(q)).map((e) => e.id) : [];
		this.index = 0;
		this.show();
	}

	private step(by: number): void {
		if (!this.matches.length) return;
		this.index = (this.index + by + this.matches.length) % this.matches.length;
		this.show();
	}

	/** Selects the current match and brings it into view. */
	private show(): void {
		const ed = this.ed;
		const q = this.input.value.trim();
		this.count.textContent = !q ? "" : this.matches.length ? `${this.index + 1} of ${this.matches.length}` : "No matches";
		this.box.classList.toggle("is-empty", !!q && !this.matches.length);
		const target = ed.byId.get(this.matches[this.index] ?? "");
		if (!target) return;
		ed.setSelection([target.id]);
		const bounds: Bounds | undefined = isConnector(target) ? ed.renderer.route(target)?.route.bounds : target;
		if (bounds) ed.zoomToBounds(bounds, { animate: true, padding: 160, maxZoom: Math.max(1, ed.vp.zoom) });
	}
}
