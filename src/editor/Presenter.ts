import { parseFrameLink } from "../model/links";
import { isBlock, isConnector, type Bounds } from "../model/types";
import { frameTitleMetrics } from "../render/elements";
import { contentBounds } from "../render/scene";
import { clearEl, el } from "./dom";
import type { Editor } from "./Editor";
import { iconButton } from "./ui/controls";
import type { Viewport } from "./types";

interface Slide {
	title: string;
	frameId: string | null;
	bounds: Bounds;
}

/**
 * Full-screen presentation: an overview slide, then one slide per frame in frame order.
 * The canvas becomes read-only, panels are hidden, a laser pointer follows the mouse and
 * clicking a block spotlights its dependencies.
 */
export class Presenter {
	private active = false;
	private slides: Slide[] = [];
	private index = 0;
	private saved: { vp: Viewport; readOnly: boolean } | null = null;
	private bar: HTMLDivElement | null = null;
	private titleEl: HTMLDivElement | null = null;
	private counterEl: HTMLDivElement | null = null;
	private progressEl: HTMLDivElement | null = null;
	private laser: HTMLDivElement | null = null;
	private legendEl: HTMLDivElement | null = null;
	private guideEl: HTMLDivElement | null = null;
	private laserOn = true;
	private enteredFullscreen = false;
	/** Comments the presenter opened or closed by clicking; view-only, never saved to the drawing. */
	private readonly commentOverrides = new Map<string, boolean>();
	private readonly off: (() => void)[] = [];

	constructor(private readonly ed: Editor) {}

	isActive(): boolean {
		return this.active;
	}

	/** True while the laser pointer replaces the mouse cursor. */
	laserVisible(): boolean {
		return this.active && this.laserOn;
	}

	/** Whether a comment is shown right now: the presenter's own clicks win over the saved state. */
	commentOpen(el: { id: string; commentOpen: boolean }): boolean {
		return this.commentOverrides.get(el.id) ?? el.commentOpen;
	}

	/** Shows or hides a comment for the rest of the presentation without changing the drawing. */
	toggleComment(id: string): void {
		const el = this.ed.byId.get(id);
		if (!isBlock(el) && !isConnector(el)) return;
		this.commentOverrides.set(id, !this.commentOpen(el));
		this.ed.requestRender();
	}

	start(): void {
		const ed = this.ed;
		if (this.active) return;
		this.slides = this.buildSlides();
		if (!this.slides.length) {
			ed.host.notice("Add some blocks first — there is nothing to present yet.");
			return;
		}
		this.active = true;
		this.index = 0;
		this.commentOverrides.clear();
		this.saved = { vp: { ...ed.vp }, readOnly: ed.options.readOnly };
		ed.textEditor.commit();
		ed.setTool("select");
		ed.clearSelection();
		ed.setOptions({ readOnly: true });
		ed.root.classList.add("bd-presenting");
		if (this.laserOn) ed.root.classList.add("bd-laser-on");
		this.buildChrome();
		this.listen(ed.canvas, "pointerdown", (e) => this.onPointerDown(e as PointerEvent), true);
		this.listen(ed.root, "pointermove", (e) => this.moveLaser(e as PointerEvent));
		this.listen(ed.root, "pointerleave", () => this.laser?.classList.remove("is-visible"));
		this.listen(ed.doc, "fullscreenchange", () => {
			if (this.enteredFullscreen && !ed.doc.fullscreenElement) this.stop();
			else this.refit();
		});
		this.listen(ed.win, "resize", () => this.refit());
		const req = ed.root.requestFullscreen?.bind(ed.root);
		if (req) {
			req()
				.then(() => {
					this.enteredFullscreen = true;
				})
				.catch(() => undefined);
		}
		ed.focus();
		this.go(0, false);
	}

	stop(): void {
		const ed = this.ed;
		if (!this.active) return;
		this.active = false;
		for (const fn of this.off.splice(0)) fn();
		this.bar?.remove();
		this.laser?.remove();
		this.legendEl?.remove();
		this.guideEl?.remove();
		this.bar = this.laser = this.legendEl = this.guideEl = this.titleEl = this.counterEl = this.progressEl = null;
		this.commentOverrides.clear();
		ed.root.classList.remove("bd-presenting", "bd-laser-on", "bd-stage-dark");
		ed.clearTrace();
		if (this.enteredFullscreen && ed.doc.fullscreenElement === ed.root) void ed.doc.exitFullscreen().catch(() => undefined);
		this.enteredFullscreen = false;
		const saved = this.saved;
		this.saved = null;
		if (saved) {
			ed.setOptions({ readOnly: saved.readOnly });
			ed.whenSized(() => ed.setViewport(saved.vp));
		}
		ed.requestRender();
	}

	next(): void {
		if (this.index < this.slides.length - 1) this.go(this.index + 1);
	}

	previous(): void {
		if (this.index > 0) this.go(this.index - 1);
	}

	/** Keyboard handling while presenting; returns true when the key was used. */
	handleKey(e: KeyboardEvent): boolean {
		const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
		switch (key) {
			case "ArrowRight":
			case "ArrowDown":
			case "PageDown":
			case " ":
			case "Enter":
			case "n":
				this.next();
				return true;
			case "ArrowLeft":
			case "ArrowUp":
			case "PageUp":
			case "Backspace":
			case "p":
				this.previous();
				return true;
			case "Home":
				this.go(0);
				return true;
			case "End":
				this.go(this.slides.length - 1);
				return true;
			case "Escape":
				if (this.guideEl?.classList.contains("is-open")) this.toggleGuide(false);
				else if (this.ed.traceRootId) this.ed.clearTrace();
				else this.stop();
				return true;
			case "s":
				this.ed.root.classList.toggle("bd-stage-dark");
				return true;
			case "l":
				this.laserOn = !this.laserOn;
				this.ed.root.classList.toggle("bd-laser-on", this.laserOn);
				if (!this.laserOn) this.laser?.classList.remove("is-visible");
				return true;
			case "t":
				this.ed.clearTrace();
				return true;
			case "?":
				this.toggleGuide();
				return true;
		}
		if (/^[1-9]$/.test(key)) {
			// 1 = overview (when there is one), then frames in order.
			const i = Number(key) - 1;
			if (i < this.slides.length) this.go(i);
			return true;
		}
		return false;
	}

	/* ------------------------------------------------------------------ */

	private buildSlides(): Slide[] {
		const ed = this.ed;
		const slides: Slide[] = [];
		const all = contentBounds(ed.elements);
		const frames = ed.frames();
		if (all && (frames.length !== 1 || ed.elements.some((e) => isBlock(e) && !e.frameId))) {
			slides.push({ title: frames.length ? "Overview" : "Drawing", frameId: null, bounds: all });
		}
		for (const f of frames) {
			const t = frameTitleMetrics(f, 1);
			const top = t.y - t.size;
			slides.push({
				title: f.title || "Frame",
				frameId: f.id,
				bounds: { x: f.x, y: top, width: f.width, height: f.y + f.height - top },
			});
		}
		return slides;
	}

	private buildChrome(): void {
		const ed = this.ed;
		this.bar = el("div", "bd-present-bar", ed.root);
		iconButton(this.bar, "back", "Previous — ←", () => this.previous());
		const info = el("div", "bd-present-info", this.bar);
		this.titleEl = el("div", "bd-present-title", info);
		this.counterEl = el("div", "bd-present-counter", info);
		iconButton(this.bar, "next", "Next — → or Space", () => this.next());
		iconButton(this.bar, "stage", "Light / dark stage — S", () => ed.root.classList.toggle("bd-stage-dark"));
		iconButton(this.bar, "help", "Legend & shortcuts — ?", () => this.toggleGuide());
		iconButton(this.bar, "close", "End presentation — Esc", () => this.stop());
		const track = el("div", "bd-present-progress", this.bar);
		this.progressEl = el("div", "bd-present-progress-fill", track);
		this.laser = el("div", "bd-laser", ed.root);
		this.legendEl = el("div", "bd-present-legend", ed.root);
		this.buildGuide();
	}

	toggleGuide(force?: boolean): void {
		if (!this.guideEl) return;
		const open = force ?? !this.guideEl.classList.contains("is-open");
		this.guideEl.classList.toggle("is-open", open);
	}

	private buildGuide(): void {
		this.guideEl = el("div", "bd-present-guide bd-panel", this.ed.root);
		const head = el("div", "bd-panel-head", this.guideEl);
		el("div", "bd-panel-title", head, "Presentation Guide");
		iconButton(head, "close", "Close", () => this.toggleGuide(false));

		const body = el("div", "bd-present-guide-body", this.guideEl);

		el("div", "bd-guide-heading", body, "Block Spotlight (Click a block)");
		const spotGrid = el("div", "bd-guide-spot-grid", body);
		for (const [cls, label, desc] of [
			["bd-legend-dot-focus", "Focus", "The selected block being analyzed"],
			["bd-legend-dot-up", "Upstream", "Preceding blocks & inputs leading into this block"],
			["bd-legend-dot-down", "Downstream", "Successor blocks & outputs depending on this block"],
			["bd-legend-dot-dim", "Dimmed", "Elements outside this flow"],
		]) {
			const row = el("div", "bd-guide-row", spotGrid);
			const dotWrap = el("span", "bd-guide-row-dot", row);
			el("span", `bd-legend-dot ${cls}`, dotWrap);
			el("strong", "bd-guide-label", row, label);
			el("span", "bd-guide-desc", row, desc);
		}

		el("div", "bd-guide-heading", body, "Navigation & Shortcuts");
		const navGrid = el("div", "bd-guide-nav-grid", body);
		for (const [keys, action] of [
			["→ / Space / Enter", "Next slide"],
			["← / Backspace", "Previous slide"],
			["Click a block", "Toggle spotlight on its flow"],
			["Click a comment badge", "Show / hide that comment (the drawing is not changed)"],
			["Click canvas / Esc", "Clear spotlight"],
			["S", "Toggle light / dark stage"],
			["L", "Toggle laser pointer"],
			["Esc", "Exit presentation"],
		]) {
			const row = el("div", "bd-guide-nav-row", navGrid);
			el("span", "bd-guide-keys", row, keys);
			el("span", "bd-guide-action", row, action);
		}
	}

	update(): void {
		if (!this.active) return;
		this.updateLegend();
	}

	private updateLegend(): void {
		if (!this.legendEl) return;
		const trace = this.ed.currentTrace();
		if (!trace) {
			this.legendEl.classList.remove("is-visible");
			clearEl(this.legendEl);
			return;
		}
		const root = this.ed.byId.get(trace.rootId);
		const title = isBlock(root) && root.title.trim() ? root.title.trim().split("\n")[0] : "Block";
		clearEl(this.legendEl);

		const rootPill = el("span", "bd-legend-pill bd-legend-root", this.legendEl);
		el("span", "bd-legend-dot bd-legend-dot-focus", rootPill);
		el("span", "bd-legend-text", rootPill, `Focus: ${title}`);

		const upPill = el("span", "bd-legend-pill bd-legend-up", this.legendEl);
		el("span", "bd-legend-dot bd-legend-dot-up", upPill);
		el("span", "bd-legend-text", upPill, `Upstream: ${trace.upstream.size}`);

		const downPill = el("span", "bd-legend-pill bd-legend-down", this.legendEl);
		el("span", "bd-legend-dot bd-legend-dot-down", downPill);
		el("span", "bd-legend-text", downPill, `Downstream: ${trace.downstream.size}`);

		const clearBtn = el("button", "bd-legend-clear", this.legendEl);
		clearBtn.type = "button";
		clearBtn.textContent = "✕";
		clearBtn.title = "Clear spotlight (esc)";
		clearBtn.setAttribute("aria-label", "Clear spotlight (esc)");
		clearBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
		clearBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.ed.clearTrace();
		});

		this.legendEl.classList.add("is-visible");
	}

	private go(i: number, animate = true): void {
		const slide = this.slides[i];
		if (!slide) return;
		this.index = i;
		this.ed.clearTrace();
		this.ed.zoomToBounds(slide.bounds, { animate, padding: 64, maxZoom: 3 });
		if (this.titleEl) this.titleEl.textContent = slide.title;
		if (this.counterEl) this.counterEl.textContent = `${i + 1} / ${this.slides.length}`;
		if (this.progressEl) this.progressEl.style.width = `${((i + 1) / this.slides.length) * 100}%`;
	}

	private refit(): void {
		if (!this.active) return;
		this.ed.win.setTimeout(() => {
			const slide = this.slides[this.index];
			if (this.active && slide) this.ed.zoomToBounds(slide.bounds, { animate: false, padding: 64, maxZoom: 3 });
		}, 60);
	}

	private onPointerDown(e: PointerEvent): void {
		if (e.button !== 0) return;
		const ed = this.ed;
		e.stopPropagation();
		e.preventDefault();
		const hit = ed.hitTest(ed.clientToWorld(e.clientX, e.clientY));
		if (hit?.kind === "link-badge") {
			const block = ed.byId.get(hit.id);
			const frameId = isBlock(block) ? parseFrameLink(block.link) : null;
			const target = frameId ? this.slides.findIndex((s) => s.frameId === frameId) : -1;
			if (target >= 0) this.go(target);
			else ed.followLink(hit.id);
			return;
		}
		if (hit?.kind === "comment-badge") {
			this.toggleComment(hit.id);
			return;
		}
		if (hit?.kind === "block") {
			ed.toggleTrace(hit.id);
			return;
		}
		ed.clearTrace();
	}

	private moveLaser(e: PointerEvent): void {
		if (!this.laser || !this.laserOn) return;
		const r = this.ed.root.getBoundingClientRect();
		this.laser.style.transform = `translate(${e.clientX - r.left}px, ${e.clientY - r.top}px)`;
		this.laser.classList.add("is-visible");
	}

	private listen(target: EventTarget, type: string, fn: (e: Event) => void, capture = false): void {
		target.addEventListener(type, fn, capture);
		this.off.push(() => target.removeEventListener(type, fn, capture));
	}
}
