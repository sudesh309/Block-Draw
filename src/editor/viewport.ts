import { center, clamp, type Point } from "../geometry/geom";
import type { Bounds } from "../model/types";
import { contentBounds } from "../render/scene";
import type { Editor } from "./Editor";
import { MAX_ZOOM, MIN_ZOOM, type Viewport } from "./types";

/** Pan, zoom and the mapping between screen and drawing coordinates of one editor. */
export class ViewportController {
	private animation: number | null = null;
	private lastSize = { width: 0, height: 0 };
	/** View change requested before the canvas had a size (applied on first layout). */
	private pendingView: (() => void) | null = null;

	constructor(private readonly ed: Editor) {}

	/**
	 * Runs a viewport change now if the canvas is laid out, otherwise on its first layout.
	 * Only the latest pending change is kept (e.g. "go to frame" wins over "zoom to fit").
	 */
	whenSized(fn: () => void): void {
		const r = this.ed.svg.getBoundingClientRect();
		if (r.width > 0 && r.height > 0 && this.lastSize.width > 0) {
			this.pendingView = null;
			fn();
		} else {
			this.pendingView = fn;
		}
	}

	viewSize(): { width: number; height: number } {
		const ed = this.ed;
		const r = ed.svg.getBoundingClientRect();
		return { width: r.width || ed.root.clientWidth || 800, height: r.height || ed.root.clientHeight || 600 };
	}

	clientToScreen(clientX: number, clientY: number): Point {
		const r = this.ed.svg.getBoundingClientRect();
		return { x: clientX - r.left, y: clientY - r.top };
	}

	screenToWorld(p: Point): Point {
		const vp = this.ed.vp;
		return { x: (p.x - vp.x) / vp.zoom, y: (p.y - vp.y) / vp.zoom };
	}

	worldToScreen(p: Point): Point {
		const vp = this.ed.vp;
		return { x: p.x * vp.zoom + vp.x, y: p.y * vp.zoom + vp.y };
	}

	clientToWorld(clientX: number, clientY: number): Point {
		return this.screenToWorld(this.clientToScreen(clientX, clientY));
	}

	setViewport(vp: Viewport, opts: { silent?: boolean } = {}): void {
		const ed = this.ed;
		ed.vp = { x: vp.x, y: vp.y, zoom: clamp(vp.zoom, MIN_ZOOM, MAX_ZOOM) };
		this.applyGridClass();
		ed.textEditor.reposition();
		if (!opts.silent) ed.onViewportChange?.(ed.vp);
		ed.requestRender();
	}

	panBy(dx: number, dy: number): void {
		this.stopAnimation();
		const vp = this.ed.vp;
		this.setViewport({ ...vp, x: vp.x + dx, y: vp.y + dy });
	}

	zoomAt(factor: number, screen?: Point): void {
		this.stopAnimation();
		const size = this.viewSize();
		const s = screen ?? { x: size.width / 2, y: size.height / 2 };
		const zoom = clamp(this.ed.vp.zoom * factor, MIN_ZOOM, MAX_ZOOM);
		const w = this.screenToWorld(s);
		this.setViewport({ zoom, x: s.x - w.x * zoom, y: s.y - w.y * zoom });
	}

	zoomTo(zoom: number): void {
		this.zoomAt(zoom / this.ed.vp.zoom);
	}

	/** Viewport that shows `b` centered with padding. */
	viewportFor(b: Bounds, padding = 48, maxZoom = 2): Viewport {
		const size = this.viewSize();
		const zoom = clamp(
			Math.min((size.width - padding * 2) / Math.max(b.width, 1), (size.height - padding * 2) / Math.max(b.height, 1)),
			MIN_ZOOM,
			maxZoom,
		);
		const c = center(b);
		return { zoom, x: size.width / 2 - c.x * zoom, y: size.height / 2 - c.y * zoom };
	}

	zoomToBounds(b: Bounds, opts: { animate?: boolean; padding?: number; maxZoom?: number } = {}): void {
		const target = this.viewportFor(b, opts.padding ?? 48, opts.maxZoom ?? 2);
		if (opts.animate === false) this.setViewport(target);
		else this.animateTo(target);
	}

	zoomToFit(opts: { animate?: boolean; maxZoom?: number } = {}): void {
		const b = contentBounds(this.ed.elements);
		if (!b) {
			const size = this.viewSize();
			this.setViewport({ x: size.width / 2, y: size.height / 2, zoom: 1 });
			return;
		}
		this.zoomToBounds(b, { animate: opts.animate, maxZoom: opts.maxZoom ?? 1 });
	}

	zoomToSelection(): void {
		const b = this.ed.selectionBounds();
		if (b) this.zoomToBounds(b, { maxZoom: 1.5 });
	}

	animateTo(target: Viewport, duration = 320): void {
		const ed = this.ed;
		this.stopAnimation();
		const start = { ...ed.vp };
		const t0 = performance.now();
		const step = (now: number) => {
			if (ed.destroyed) return;
			const t = Math.min(1, (now - t0) / duration);
			const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
			// interpolate zoom geometrically so the motion feels uniform
			const zoom = start.zoom * Math.pow(target.zoom / start.zoom, e);
			this.setViewport({ zoom, x: start.x + (target.x - start.x) * e, y: start.y + (target.y - start.y) * e }, { silent: t < 1 });
			this.animation = t < 1 ? ed.win.requestAnimationFrame(step) : null;
		};
		this.animation = ed.win.requestAnimationFrame(step);
	}

	stopAnimation(): void {
		if (this.animation !== null) {
			this.ed.win.cancelAnimationFrame(this.animation);
			this.animation = null;
		}
	}

	resize(): void {
		const ed = this.ed;
		const r = ed.root.getBoundingClientRect();
		if (r.width === 0 || r.height === 0) return;
		const first = this.lastSize.width === 0;
		// keep the center of the view stable when the pane is resized
		if (!first) {
			ed.vp = {
				...ed.vp,
				x: ed.vp.x + (r.width - this.lastSize.width) / 2,
				y: ed.vp.y + (r.height - this.lastSize.height) / 2,
			};
		}
		this.lastSize = { width: r.width, height: r.height };
		if (first && this.pendingView) {
			const apply = this.pendingView;
			this.pendingView = null;
			apply();
		}
		ed.textEditor.reposition();
		ed.requestRender();
	}

	applyGridClass(): void {
		const ed = this.ed;
		const gs = ed.options.gridSize * ed.vp.zoom;
		const step = gs < 10 ? gs * 5 : gs;
		ed.canvas.style.setProperty("--bd-grid-step", `${step}px`);
		ed.canvas.style.setProperty("--bd-grid-x", `${ed.vp.x}px`);
		ed.canvas.style.setProperty("--bd-grid-y", `${ed.vp.y}px`);
		ed.canvas.classList.toggle("bd-show-grid", ed.options.showGrid && step >= 6);
	}
}
