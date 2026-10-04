import { describe, expect, it } from "vitest";
import { isEraserPress, PalmRejection } from "../src/editor/pen";

const press = (pointerType: string, button: number, buttons: number) => ({ pointerType, button, buttons }) as PointerEvent;

describe("pen presses that erase in tablet mode", () => {
	it("are the barrel button and the eraser end, however the device reports them", () => {
		expect(isEraserPress(press("pen", 2, 2)), "barrel button held when the pen touches down").toBe(true);
		expect(isEraserPress(press("pen", 0, 3)), "tip down with the barrel button held").toBe(true);
		expect(isEraserPress(press("pen", 5, 32)), "eraser end").toBe(true);
		expect(isEraserPress(press("pen", -1, 32)), "eraser end, while it moves").toBe(true);
	});

	it("are never the pen's tip, a mouse or a finger", () => {
		expect(isEraserPress(press("pen", 0, 1))).toBe(false);
		expect(isEraserPress(press("pen", -1, 0)), "a pen hovering").toBe(false);
		expect(isEraserPress(press("mouse", 2, 2)), "a right click opens the menu as before").toBe(false);
		expect(isEraserPress(press("touch", 0, 1))).toBe(false);
	});
});

describe("palm rejection", () => {
	it("ignores fingers that come down while the pen draws, and just after it lifts, until they lift", () => {
		const palm = new PalmRejection();
		expect(palm.rejectsTouch(1, 0), "no pen: a finger is a finger").toBe(false);
		palm.penDown(7);
		expect(palm.rejectsTouch(2, 10)).toBe(true);
		expect(palm.isIgnored(2)).toBe(true);
		palm.penUp(7, 100);
		expect(palm.rejectsTouch(3, 250), "the hand is still there right after the pen lifts").toBe(true);
		expect(palm.rejectsTouch(4, 500), "later, a finger is a finger again").toBe(false);
		expect(palm.isIgnored(2, true), "lifting forgets it").toBe(true);
		expect(palm.isIgnored(2)).toBe(false);
	});

	it("only counts pens it saw come down", () => {
		const palm = new PalmRejection();
		palm.penUp(9, 100);
		expect(palm.rejectsTouch(1, 150)).toBe(false);
	});
});
