import { textInsets } from "../../geometry/shapes";
import type { HistoryEntry } from "../../model/history";
import { updateElements, type ElementPatch } from "../../model/ops";
import { isBlock, isConnector, isFrame } from "../../model/types";
import { resolveTextColor, SCREEN_THEME, resolveStroke } from "../../render/colors";
import { FRAME_TITLE_SIZE, frameTitleMetrics, LABEL_FONT_SIZE } from "../../render/elements";
import { fontStack } from "../../render/fonts";
import { FONT_FAMILY, LINE_HEIGHT, measureText, titleWeight } from "../../render/text";
import { activeElementOf, el } from "../dom";
import type { Editor } from "../Editor";
import { fitBlockHeight } from "../Editor";

/** In-place text editing (block titles, connector labels, frame titles) with a textarea overlay. */
export class TextEditor {
	readonly area: HTMLTextAreaElement;
	private targetId: string | null = null;
	private before: HistoryEntry | null = null;
	private committing = false;

	constructor(private readonly ed: Editor) {
		this.area = el("textarea", "bd-text-editor", ed.root);
		this.area.spellcheck = true;
		this.area.rows = 1;
		this.area.setAttribute("aria-label", "Edit text");
		ed.listen(this.area, "keydown", (e) => this.onKeyDown(e as KeyboardEvent));
		ed.listen(this.area, "input", () => this.onInput());
		ed.listen(this.area, "blur", () => this.commit());
		ed.listen(this.area, "pointerdown", (e) => e.stopPropagation());
	}

	isActive(): boolean {
		return this.targetId !== null;
	}

	start(id: string): void {
		const ed = this.ed;
		if (ed.options.readOnly) return;
		this.commit();
		const target = ed.byId.get(id);
		if (!target) return;
		const text = isBlock(target) ? target.title : isConnector(target) ? target.label : target.title;
		this.targetId = id;
		this.before = ed.snapshot();
		ed.editingId = id;
		ed.selection = new Set([id]);
		this.area.value = text;
		this.area.dataset.kind = target.type;
		this.area.classList.add("is-active");
		this.reposition();
		ed.requestRender();
		// focus after the element is visible
		this.area.focus({ preventScroll: true });
		if (text) this.area.select();
		else this.area.setSelectionRange(0, 0);
	}

	private onKeyDown(e: KeyboardEvent): void {
		e.stopPropagation();
		if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey && !e.isComposing)) {
			e.preventDefault();
			this.commit();
			this.ed.root.focus({ preventScroll: true });
		} else if (e.key === "Tab") {
			e.preventDefault();
			this.commit();
			this.ed.root.focus({ preventScroll: true });
		}
	}

	private onInput(): void {
		const ed = this.ed;
		const id = this.targetId;
		if (!id) return;
		const target = ed.byId.get(id);
		if (isBlock(target)) {
			// Grow the block live so the text always fits (one undo step on commit).
			const base = this.before?.elements.find((e) => e.id === id);
			const baseHeight = isBlock(base) ? base.height : target.height;
			const grown = fitBlockHeight({ ...target, title: this.area.value, height: baseHeight });
			if (grown.height !== target.height) {
				ed.setTransient(updateElements(ed.elements, new Map([[id, { height: grown.height }]])));
			}
		}
		this.reposition();
	}

	/** Positions the textarea over the element being edited (also called on pan/zoom). */
	reposition(): void {
		const ed = this.ed;
		const id = this.targetId;
		if (!id) return;
		const target = ed.byId.get(id);
		if (!target) return;
		const z = ed.vp.zoom;
		const s = this.area.style;
		s.fontFamily = isBlock(target) ? fontStack(target.style.fontFamily) : FONT_FAMILY;
		if (isBlock(target)) {
			const inner = textInsets(target.shape, target.width, target.height);
			const tl = ed.worldToScreen({ x: target.x + inner.x, y: target.y + inner.y });
			const size = target.style.fontSize * z;
			s.fontSize = `${size}px`;
			s.lineHeight = String(LINE_HEIGHT);
			s.fontWeight = String(titleWeight(target));
			s.textAlign = target.style.textAlign;
			s.color = resolveTextColor(target.style.textColor, target.style.fill, SCREEN_THEME);
			s.width = `${Math.max(inner.width * z, 20)}px`;
			s.left = `${tl.x}px`;
			s.height = "0px";
			const contentH = Math.max(this.area.scrollHeight, size * LINE_HEIGHT);
			s.height = `${contentH}px`;
			const innerH = inner.height * z;
			const free = Math.max(0, innerH - contentH);
			const valign = target.style.textVAlign;
			s.top = `${tl.y + (valign === "top" ? 0 : valign === "bottom" ? free : free / 2)}px`;
		} else if (isConnector(target)) {
			const entry = ed.renderer.route(target);
			if (!entry) return;
			const size = LABEL_FONT_SIZE * z;
			const width = Math.max(80, (measureText(this.area.value || "", LABEL_FONT_SIZE) + 24) * z);
			const c = ed.worldToScreen(entry.route.labelPos);
			s.fontSize = `${size}px`;
			s.lineHeight = "1.25";
			s.fontWeight = "400";
			s.textAlign = "center";
			s.color = resolveStroke(target.style.stroke, SCREEN_THEME);
			s.width = `${width}px`;
			s.height = "0px";
			const contentH = Math.max(this.area.scrollHeight, size * 1.25);
			s.height = `${contentH}px`;
			s.left = `${c.x - width / 2}px`;
			s.top = `${c.y - contentH / 2}px`;
		} else if (isFrame(target)) {
			const t = frameTitleMetrics(target, z);
			const tl = ed.worldToScreen({ x: t.x, y: t.y - t.size });
			s.fontSize = `${FRAME_TITLE_SIZE}px`;
			s.lineHeight = "1.3";
			s.fontWeight = "600";
			s.textAlign = "left";
			s.color = "var(--bd-frame-title)";
			s.width = `${Math.max(180, target.width * z)}px`;
			s.height = `${FRAME_TITLE_SIZE * 1.4}px`;
			s.left = `${tl.x}px`;
			s.top = `${tl.y - 2}px`;
		}
	}

	/** Saves the edited text (one undo step) and closes the editor. */
	commit(): void {
		const ed = this.ed;
		const id = this.targetId;
		if (!id || this.committing) return;
		this.committing = true;
		try {
			const value = this.area.value;
			const before = this.before;
			this.close();
			const target = ed.byId.get(id);
			if (!target) return;
			let patch: ElementPatch | null = null;
			if (isBlock(target)) {
				const title = value.replace(/\s+$/, "");
				// Height = original height, grown if the new text needs more room.
				const base = before?.elements.find((e) => e.id === id);
				const grown = fitBlockHeight({ ...target, title, height: isBlock(base) ? base.height : target.height });
				patch = { title, height: grown.height };
			} else if (isConnector(target)) {
				patch = { label: value.trim() };
			} else if (isFrame(target)) {
				patch = { title: value.replace(/\s+/g, " ").trim() || target.title || "Frame" };
			}
			const next = patch ? updateElements(ed.elements, new Map([[id, patch]])) : ed.elements;
			ed.commit(next, { before: before ?? undefined, selection: [id] });
		} finally {
			this.committing = false;
		}
	}

	/** Closes without saving. */
	cancel(): void {
		if (!this.targetId) return;
		const before = this.before;
		this.close();
		if (before && before.elements !== this.ed.elements) this.ed.setTransient(before.elements);
	}

	private close(): void {
		this.targetId = null;
		this.ed.editingId = null;
		this.before = null;
		this.area.classList.remove("is-active");
		if (activeElementOf(this.area) === this.area) this.area.blur();
		this.ed.requestRender();
	}
}
