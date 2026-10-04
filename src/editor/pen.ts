/**
 * Pen input in tablet mode. Pointer Events report a pen's barrel button as button 2 (buttons bit
 * 2) and the eraser end of a pen that has one as button 5 (buttons bit 32). Either one erases.
 * A long press with the pen's tip is not a button press, so it still opens the context menu.
 */
export function isEraserPress(e: PointerEvent): boolean {
	return e.pointerType === "pen" && (e.button === 2 || e.button === 5 || (e.buttons & (2 | 32)) !== 0);
}

/** How long after the pen lifts a new touch still counts as the hand that held it. */
const PALM_MS = 300;

/**
 * Palm rejection for tablet mode. While a pen touches the screen, and for a moment after it lifts,
 * a finger that comes down is the hand resting on the screen: it is ignored until it lifts.
 */
export class PalmRejection {
	private readonly pens = new Set<number>();
	private penLiftedAt = -Infinity;
	/** Pointers to ignore until they lift, by pointer id. */
	private readonly ignored = new Set<number>();

	penDown(id: number): void {
		this.pens.add(id);
	}

	penUp(id: number, now: number): void {
		if (this.pens.delete(id)) this.penLiftedAt = now;
	}

	/** A finger came down. True when it is the resting hand; its later events are then ignored too. */
	rejectsTouch(id: number, now: number): boolean {
		if (!this.pens.size && now - this.penLiftedAt >= PALM_MS) return false;
		this.ignored.add(id);
		return true;
	}

	ignore(id: number): void {
		this.ignored.add(id);
	}

	/** Whether to ignore an event of this pointer. `lifted` (pointerup, pointercancel) also forgets it. */
	isIgnored(id: number, lifted = false): boolean {
		return lifted ? this.ignored.delete(id) : this.ignored.has(id);
	}
}
