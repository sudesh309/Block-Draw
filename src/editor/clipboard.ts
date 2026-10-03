import { unionBounds, type Point } from "../geometry/geom";
import { cloneElements, collectForCopy, insertClones, makeClipboardPayload, readClipboardPayload } from "../model/ops";
import { DEFAULT_BLOCK_SIZE, isBox } from "../model/types";
import { fitBlockHeight } from "./blocks";
import type { Editor } from "./Editor";

/** Copy, cut and paste: through the system clipboard, with an in-editor copy as a fallback. */
export class ClipboardController {
	/** Last copy, for pasting when the system clipboard cannot be read. */
	private internal: string | null = null;
	private pasteCount = 0;

	constructor(private readonly ed: Editor) {
		ed.listen(ed.doc, "copy", (e) => this.onClipboardEvent(e as ClipboardEvent, "copy"));
		ed.listen(ed.doc, "cut", (e) => this.onClipboardEvent(e as ClipboardEvent, "cut"));
		ed.listen(ed.doc, "paste", (e) => this.onClipboardEvent(e as ClipboardEvent, "paste"));
	}

	copySelectionText(): string | null {
		if (!this.ed.selection.size) return null;
		const picked = collectForCopy(this.ed.elements, this.ed.selection);
		const selectedConnectors = this.ed.selectedConnectors().filter((c) => !picked.includes(c));
		if (!picked.length && !selectedConnectors.length) return null;
		const text = JSON.stringify(makeClipboardPayload(picked));
		this.internal = text;
		this.pasteCount = 0;
		return text;
	}

	/** Pastes Block Draw elements or plain text (as a new block) at `at` (world). */
	pasteText(text: string, at?: Point): void {
		const els = readClipboardPayload(text);
		if (els) {
			const valid = els.filter((e) => e && typeof e === "object" && typeof e.id === "string");
			const boxes = valid.filter(isBox);
			const b = unionBounds(boxes);
			let dx = 0;
			let dy = 0;
			if (b) {
				if (at) {
					const target = this.ed.snapPoint({ x: at.x - b.width / 2, y: at.y - b.height / 2 });
					dx = target.x - b.x;
					dy = target.y - b.y;
				} else {
					this.pasteCount++;
					dx = dy = (this.ed.options.gridSize || 20) * this.pasteCount;
				}
			}
			const { elements, idMap } = cloneElements(valid, dx, dy);
			const next = insertClones(this.ed.elements, elements, new Set(elements.map((e) => e.id)));
			this.ed.commit(next, { selection: [...idMap.values()].filter((id) => next.some((e) => e.id === id)) });
			return;
		}
		const clean = text.trim().slice(0, 2000);
		if (!clean) return;
		const size = this.ed.viewSize();
		const p = at ?? this.ed.screenToWorld({ x: size.width / 2, y: size.height / 2 });
		const block = this.ed.makeBlock({ x: 0, y: 0, ...DEFAULT_BLOCK_SIZE }, { title: clean, shape: this.ed.current.shape });
		const pos = this.ed.snapPoint({ x: p.x - block.width / 2, y: p.y - block.height / 2 });
		const grown = fitBlockHeight({ ...block, x: pos.x, y: pos.y });
		this.ed.insertBlocks([grown]);
	}

	pasteInternal(at?: Point): boolean {
		if (!this.internal) return false;
		this.pasteText(this.internal, at);
		return true;
	}

	private onClipboardEvent(e: ClipboardEvent, kind: "copy" | "cut" | "paste"): void {
		if (this.ed.destroyed || this.ed.options.readOnly) return;
		if (this.ed.doc.activeElement !== this.ed.root) return;
		if (kind === "paste") {
			const text = e.clipboardData?.getData("text/plain") ?? "";
			e.preventDefault();
			if (text) this.pasteText(text);
			else this.pasteInternal();
			return;
		}
		const text = this.copySelectionText();
		if (!text) return;
		e.preventDefault();
		e.clipboardData?.setData("text/plain", text);
		if (kind === "cut") this.ed.deleteSelection();
	}

	async pasteFromSystem(at?: Point): Promise<void> {
		try {
			const text = await navigator.clipboard.readText();
			if (text) {
				this.pasteText(text, at);
				return;
			}
		} catch {
			// clipboard API unavailable: fall back to the in-editor clipboard
		}
		if (!this.pasteInternal(at)) this.ed.host.notice("Nothing to paste.");
	}
}
