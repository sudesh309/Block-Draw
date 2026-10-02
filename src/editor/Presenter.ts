import { parseFrameLink } from "../model/links";
import { isBlock, type Bounds } from "../model/types";
import { frameTitleMetrics } from "../render/elements";
import { contentBounds } from "../render/scene";
import { el } from "./dom";
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
	private laserOn = true;
	private enteredFullscreen = false;
	private readonly off: (() => void)[] = [];

	constructor(private readonly ed: Editor) {}

	isActive(): boolean {
		return this.active;
	}

	/** True while the laser pointer replaces the mouse cursor. */
	laserVisible(): boolean {
		return this.active && this.laserOn;
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
		this.bar = this.laser = this.titleEl = this.counterEl = this.progressEl = null;
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
				if (this.ed.traceRootId) this.ed.clearTrace();
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
		iconButton(this.bar, "close", "End presentation — Esc", () => this.stop());
		const track = el("div", "bd-present-progress", this.bar);
		this.progressEl = el("div", "bd-present-progress-fill", track);
		this.laser = el("div", "bd-laser", ed.root);
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
		if (hit && (hit.kind === "block" || hit.kind === "comment-badge")) {
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
