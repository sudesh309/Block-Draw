import { el } from "../dom";
import type { Editor } from "../Editor";
import { iconButton } from "./controls";

export class ZoomControls {
	readonly el: HTMLDivElement;
	private label: HTMLButtonElement;
	private gridBtn: HTMLButtonElement;
	private snapBtn: HTMLButtonElement;
	private backBtn: HTMLButtonElement;

	constructor(private readonly ed: Editor) {
		this.el = el("div", "bd-zoom bd-panel", ed.root);
		iconButton(this.el, "zoom-out", "Zoom out — −", () => ed.zoomAt(1 / 1.2));
		this.label = el("button", "bd-zoom-label", this.el);
		this.label.type = "button";
		this.label.title = "Reset zoom (Shift+0)";
		this.label.addEventListener("pointerdown", (e) => e.preventDefault());
		this.label.addEventListener("click", () => ed.zoomTo(1));
		iconButton(this.el, "zoom-in", "Zoom in — +", () => ed.zoomAt(1.2));
		iconButton(this.el, "fit", "Zoom to fit — Shift+1", () => ed.zoomToFit({ animate: true }));
		el("div", "bd-toolbar-sep", this.el);
		this.gridBtn = iconButton(this.el, "grid", "Show grid — G", () => ed.setOptions({ showGrid: !ed.options.showGrid }));
		this.snapBtn = iconButton(this.el, "snap", "Snap to grid", () => ed.setOptions({ snapToGrid: !ed.options.snapToGrid }));
		this.backBtn = el("button", "bd-back-btn bd-panel", ed.root);
		this.backBtn.type = "button";
		this.backBtn.title = "Back to the previous view (Alt+←)";
		this.backBtn.textContent = "Back";
		this.backBtn.addEventListener("pointerdown", (e) => e.preventDefault());
		this.backBtn.addEventListener("click", () => ed.navigateBack());
	}

	update(): void {
		const ed = this.ed;
		const pct = `${Math.round(ed.vp.zoom * 100)}%`;
		if (this.label.textContent !== pct) this.label.textContent = pct;
		this.gridBtn.classList.toggle("is-active", ed.options.showGrid);
		this.snapBtn.classList.toggle("is-active", ed.options.snapToGrid);
		this.snapBtn.hidden = ed.options.readOnly;
		this.backBtn.classList.toggle("is-visible", ed.navStack.length > 0);
	}
}
