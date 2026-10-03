import { beforeAll, describe, expect, it } from "vitest";
import { normalizeElements, parseDrawing, serializeDrawing } from "../src/model/file";
import { reorderElements, withWaypoints } from "../src/model/ops";
import { inStackOrder, stackLevel } from "../src/model/stack";
import type { ConnectorElement, DrawElement } from "../src/model/types";
import { LIGHT_THEME } from "../src/render/colors";
import { sceneToSvg } from "../src/render/scene";
import { useEstimatedTextMeasure } from "../src/render/text";
import { block, connector, frame } from "./helpers";

beforeAll(() => useEstimatedTextMeasure());

const ids = (els: readonly DrawElement[]) => els.map((e) => e.id);
const reorder = (els: DrawElement[], pick: string[], mode: Parameters<typeof reorderElements>[2]) => reorderElements(els, new Set(pick), mode);

/** Two overlapping blocks and a link between two other blocks, drawn in this order. */
const scene = () => [frame("f", 0, 0, 900, 400), block("a", 0, 0), block("b", 100, 0), block("c", 400, 0), connector("l", "a", "c")];

describe("stacking order", () => {
	it("draws a link above the blocks unless it was sent behind them, and a block below the links unless brought in front", () => {
		const els = scene();
		expect(inStackOrder(els).map((e) => e.id)).toEqual(["f", "a", "b", "c", "l"]);
		const behind = reorder(els, ["l"], "back");
		expect((behind.find((e) => e.id === "l") as ConnectorElement).behind).toBe(true);
		expect(inStackOrder(behind).map((e) => e.id)).toEqual(["f", "l", "a", "b", "c"]);
		const raised = reorder(els, ["a"], "front");
		expect(inStackOrder(raised).map((e) => e.id)).toEqual(["f", "b", "c", "l", "a"]);
	});

	it("brings a block to the front of its own kind too, and undoes both with the opposite command", () => {
		const els = scene();
		const front = reorder(els, ["a"], "front");
		expect(ids(front)).toEqual(["f", "b", "c", "l", "a"]);
		expect(stackLevel(front[4])).toBeGreaterThan(stackLevel(front[3]));
		const back = reorder(front, ["a"], "back");
		expect(ids(back)).toEqual(["a", "f", "b", "c", "l"]);
		expect("inFront" in back[0]).toBe(false);
		const forward = reorder(reorder(els, ["l"], "back"), ["l"], "front");
		expect("behind" in forward[forward.length - 1]).toBe(false);
	});

	it("moves a block one step among the blocks at its own level only", () => {
		const els = [block("a", 0, 0), block("b", 0, 0, { inFront: true }), block("c", 0, 0)];
		expect(ids(reorder(els, ["a"], "forward"))).toEqual(["b", "c", "a"]);
		expect(ids(reorder(els, ["c"], "backward"))).toEqual(["c", "a", "b"]);
		// b is in front of the links, a and c are not: stepping b back does not swap it with them
		expect(ids(reorder(els, ["b"], "backward"))).toEqual(["a", "b", "c"]);
	});

	it("keeps the flags in the file only while they are set, and reads them back", () => {
		const els = reorder(reorder(scene(), ["l"], "back"), ["a"], "front");
		const text = serializeDrawing({ type: "block-draw", version: 1, elements: els });
		expect(text.match(/"behind":true/g)).toHaveLength(1);
		expect(text.match(/"inFront":true/g)).toHaveLength(1);
		const back = parseDrawing(text).elements;
		expect(back.map(stackLevel)).toEqual(els.map(stackLevel));
		// a drawing that never used them is written exactly as before
		expect(serializeDrawing({ type: "block-draw", version: 1, elements: scene() })).not.toMatch(/behind|inFront/);
		expect(normalizeElements([{ type: "block", id: "x", inFront: "yes" }])[0]).not.toHaveProperty("inFront");
	});
});

describe("the order of the optional keys", () => {
	it("is the same whichever was set first, and survives reading the file and writing it again", () => {
		const link = connector("l", "a", "c");
		const via = [{ x: 1, y: 2 }];
		const [behindFirst] = [withWaypoints(reorder([link], ["l"], "back")[0] as ConnectorElement, via)];
		const [bendFirst] = reorder([withWaypoints(link, via)], ["l"], "back");
		expect(Object.keys(behindFirst)).toEqual(Object.keys(bendFirst));
		expect(Object.keys(behindFirst).slice(-2)).toEqual(["waypoints", "behind"]);
		// sent back and forth again, and bent and reset: no key moves
		const again = withWaypoints(withWaypoints(reorder([bendFirst], ["l"], "front")[0] as ConnectorElement, []), via);
		expect(Object.keys(reorder([again], ["l"], "back")[0])).toEqual(Object.keys(bendFirst));
		const file = { type: "block-draw" as const, version: 1, elements: [block("a", 0, 0), block("c", 400, 0), bendFirst] };
		const text = serializeDrawing(file);
		expect(serializeDrawing(parseDrawing(text))).toBe(text);
	});
});

describe("drawing the stacking order", () => {
	const order = (els: DrawElement[]) => {
		const { svg } = sceneToSvg(els, { theme: LIGHT_THEME });
		// each element is drawn with its data-id or its title: find where each title first shows up
		return ["A", "B", "C", "link label"].map((t) => [t, svg.indexOf(`>${t}<`)] as const).sort((x, y) => x[1] - y[1]).map(([t]) => t);
	};
	const labeled = (extra: Partial<ConnectorElement> = {}) => connector("l", "a", "c", { label: "link label", ...extra });

	it("draws the label of a link with its link, above the blocks by default", () => {
		const els = [block("a", 0, 0), block("b", 200, 0), block("c", 400, 0), labeled()];
		expect(order(els)).toEqual(["A", "B", "C", "link label"]);
	});

	it("draws a link that was sent behind the blocks, and its label, below them", () => {
		const els = [block("a", 0, 0), block("b", 200, 0), block("c", 400, 0), labeled({ behind: true })];
		expect(order(els)).toEqual(["link label", "A", "B", "C"]);
	});

	it("draws a block brought in front of the links after the links and their labels", () => {
		const els = [block("a", 0, 0, { inFront: true }), block("b", 200, 0), block("c", 400, 0), labeled()];
		expect(order(els)).toEqual(["B", "C", "link label", "A"]);
	});
});
