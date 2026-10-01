import { deleteElements, frameChildren, moveFrameOrder } from "../../model/ops";
import { parseFrameLink } from "../../model/links";
import { isBlock, type FrameElement } from "../../model/types";
import { clearEl, el } from "../dom";
import type { Editor } from "../Editor";
import { iconButton } from "./controls";

/** Side panel listing frames in export order; click to navigate, double-click to rename. */
export class FramesPanel {
	readonly el: HTMLDivElement;
	private list: HTMLDivElement;
	private key = "";
	private renaming: string | null = null;

	constructor(private readonly ed: Editor) {
		this.el = el("div", "bd-frames-panel bd-panel", ed.root);
		const head = el("div", "bd-panel-head", this.el);
		el("div", "bd-panel-title", head, "Frames");
		if (!ed.options.readOnly) iconButton(head, "plus", "Add frame", () => ed.addFrameAfterContent());
		iconButton(head, "close", "Close", () => this.toggle(false));
		this.list = el("div", "bd-frames-list", this.el);
		el(
			"div",
			"bd-frames-note",
			this.el,
			"Frames export as sheets in this order. Link a block to a frame to jump between them.",
		);
	}

	isOpen(): boolean {
		return this.el.classList.contains("is-open");
	}

	toggle(force?: boolean): void {
		const open = force ?? !this.isOpen();
		this.el.classList.toggle("is-open", open);
		this.key = "";
		this.ed.requestRender();
	}

	update(): void {
		if (!this.isOpen()) return;
		const ed = this.ed;
		const frames = ed.frames();
		const counts = new Map<string, number>();
		const incoming = new Map<string, number>();
		for (const e of ed.elements) {
			if (!isBlock(e)) continue;
			if (e.frameId) counts.set(e.frameId, (counts.get(e.frameId) ?? 0) + 1);
			const target = parseFrameLink(e.link);
			if (target) incoming.set(target, (incoming.get(target) ?? 0) + 1);
		}
		const key = frames.map((f) => `${f.id}:${f.title}:${counts.get(f.id) ?? 0}:${incoming.get(f.id) ?? 0}:${ed.selection.has(f.id)}`).join("|") + this.renaming;
		if (key === this.key) return;
		this.key = key;
		clearEl(this.list);
		if (!frames.length) {
			el("div", "bd-frames-empty", this.list, "No frames yet. Press F and drag on the canvas to draw one.");
			return;
		}
		frames.forEach((frame, i) => this.renderItem(frame, i, frames.length, counts.get(frame.id) ?? 0, incoming.get(frame.id) ?? 0));
	}

	private renderItem(frame: FrameElement, index: number, total: number, count: number, links: number): void {
		const ed = this.ed;
		const row = el("div", "bd-frame-item", this.list);
		row.classList.toggle("is-selected", ed.selection.has(frame.id));
		el("span", "bd-frame-index", row, String(index + 1));
		if (this.renaming === frame.id) {
			const input = el("input", "bd-input bd-frame-rename", row);
			input.type = "text";
			input.value = frame.title;
			const finish = (save: boolean) => {
				if (this.renaming !== frame.id) return;
				this.renaming = null;
				const title = input.value.replace(/\s+/g, " ").trim();
				if (save && title && title !== frame.title) ed.updateElement(frame.id, { title });
				this.key = "";
				ed.requestRender();
			};
			input.addEventListener("keydown", (e) => {
				e.stopPropagation();
				if (e.key === "Enter") finish(true);
				if (e.key === "Escape") finish(false);
			});
			input.addEventListener("blur", () => finish(true));
			this.ed.win.setTimeout(() => {
				input.focus();
				input.select();
			}, 0);
		} else {
			const title = el("span", "bd-frame-name", row, frame.title || "Frame");
			title.title = "Click to go there · double-click to rename";
		}
		const meta = el("span", "bd-frame-meta", row, `${count} block${count === 1 ? "" : "s"}${links ? ` · ${links}↙` : ""}`);
		meta.title = links ? `${links} block${links === 1 ? "" : "s"} link here` : "";
		row.addEventListener("click", (e) => {
			if ((e.target as HTMLElement).closest("button, input")) return;
			ed.navigateToFrame(frame.id, { select: true });
		});
		row.addEventListener("dblclick", (e) => {
			if (ed.options.readOnly || (e.target as HTMLElement).closest("button, input")) return;
			this.renaming = frame.id;
			this.key = "";
			this.update();
		});
		if (ed.options.readOnly) return;
		const actions = el("span", "bd-frame-actions", row);
		const up = iconButton(actions, "up", "Move up", () => ed.commit(moveFrameOrder(ed.elements, frame.id, -1)));
		up.disabled = index === 0;
		const down = iconButton(actions, "down", "Move down", () => ed.commit(moveFrameOrder(ed.elements, frame.id, 1)));
		down.disabled = index === total - 1;
		iconButton(
			actions,
			"trash",
			"Delete frame and its blocks",
			() => {
				const children = frameChildren(ed.elements, frame.id).length;
				ed.commit(deleteElements(ed.elements, [frame.id]), { selection: [] });
				ed.host.notice(`Deleted “${frame.title}”${children ? ` and ${children} block${children === 1 ? "" : "s"}` : ""}. Undo with Ctrl/Cmd+Z.`);
			},
			"bd-danger",
		);
	}
}
