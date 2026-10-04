/** Strokes that start this close to the left or right edge of the window still reach Obsidian. */
const EDGE_ZONE = 24;

/**
 * Tablet mode: keeps Obsidian's mobile swipe gestures (open a sidebar, pull down for the quick
 * switcher) from starting inside a drawing, where a finger or pen moving across the screen draws.
 *
 * Obsidian starts a swipe from the touchmove events that reach the window, so only touchmove is
 * kept inside the drawing. touchstart and touchend still bubble up, because Obsidian builds other
 * things on them, such as the long-press menu on iOS. The editor itself uses pointer events, which
 * are not touched. A stroke that starts at the left or right edge of the window is let through, so
 * a sidebar can still be swiped open from the edge.
 */
export class TouchGuard {
	private enabled = false;
	/** The current stroke started at the edge of the window: Obsidian gets it. */
	private passThrough = false;

	constructor(private readonly el: HTMLElement) {}

	setEnabled(on: boolean): void {
		if (on === this.enabled) return;
		this.enabled = on;
		this.passThrough = false;
		if (on) {
			this.el.addEventListener("touchstart", this.onStart, { passive: true });
			this.el.addEventListener("touchmove", this.onMove, { passive: true });
		} else {
			this.el.removeEventListener("touchstart", this.onStart);
			this.el.removeEventListener("touchmove", this.onMove);
		}
	}

	private readonly onStart = (e: TouchEvent): void => {
		// The first finger of a stroke decides; a finger that joins later keeps that decision.
		if (e.touches.length !== e.changedTouches.length) return;
		const x = e.changedTouches[0].clientX;
		const width = this.el.ownerDocument.defaultView?.innerWidth ?? 0;
		this.passThrough = x < EDGE_ZONE || x > width - EDGE_ZONE;
	};

	private readonly onMove = (e: TouchEvent): void => {
		if (!this.passThrough) e.stopPropagation();
	};
}
