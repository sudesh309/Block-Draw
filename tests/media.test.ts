import { describe, expect, it } from "vitest";
import { parseDrawing, serializeDrawing } from "../src/model/file";
import { readImage, readTable, tableFromText } from "../src/model/media";
import { tableSize } from "../src/render/media";
import { renderBlock } from "../src/render/elements";
import { LIGHT_THEME } from "../src/render/colors";
import { toSvgString } from "../src/render/vnode";
import { DEFAULT_BLOCK_STYLE, type BlockElement } from "../src/model/types";

const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const block = (patch: Partial<BlockElement>): BlockElement => ({
	id: "b", type: "block", x: 0, y: 0, width: 200, height: 60, title: "", description: "", descriptionOpen: true, shape: "rectangle",
	frameId: null, link: null, tag: "", comment: "", commentOpen: false, style: { ...DEFAULT_BLOCK_STYLE }, ...patch,
});

describe("tables from text", () => {
	it("reads tab-separated rows, as a spreadsheet copies them, with quoted cells", () => {
		expect(tableFromText("Name\tQty\nApple\t3\n")).toEqual([["Name", "Qty"], ["Apple", "3"]]);
		expect(tableFromText('a\t"b\tc"\n"d ""q"""\te')).toEqual([["a", "b\tc"], ['d "q"', "e"]]);
		expect(tableFromText("a\tb\nc")).toEqual([["a", "b"], ["c", ""]]);
	});
	it("reads a Markdown table", () => {
		expect(tableFromText("| A | B |\n| --- | :-: |\n| 1 | x \\| y |\n")).toEqual([["A", "B"], ["1", "x | y"]]);
		expect(tableFromText("A | B\n---|---\n1 | 2")).toEqual([["A", "B"], ["1", "2"]]);
	});
	it("leaves ordinary text alone", () => {
		expect(tableFromText("just a sentence")).toBeNull();
		expect(tableFromText("one\ntwo")).toBeNull();
		expect(tableFromText("a|b\nc|d")).toBeNull();
		expect(tableFromText("single\tcell-line is two columns?")).not.toBeNull();
	});
});

describe("pictures and tables in a file", () => {
	it("keep only safe pictures and sane tables", () => {
		expect(readImage(PIXEL)).toBe(PIXEL);
		for (const bad of ["https://x.test/a.png", "data:image/svg+xml;base64,AAAA", "data:image/png;base64,@@", 5, null]) expect(readImage(bad)).toBeNull();
		expect(readTable([["a"], ["b", "c"], "x"])).toEqual([["a", ""], ["b", "c"]]);
		expect(readTable([])).toBeNull();
		expect(readTable([[]])).toBeNull();
	});
	it("survive a save and load, written last and only when present", () => {
		const plain = block({});
		const picture = block({ id: "p", image: PIXEL, inFront: true });
		const table = block({ id: "t", table: [["h"], ["v"]] });
		const text = serializeDrawing({ type: "block-draw", version: 1, elements: [plain, picture, table] });
		expect(text.split("\n")[2]).not.toContain('"image"');
		const back = parseDrawing(text);
		expect(back.elements[1]).toMatchObject({ image: PIXEL, inFront: true });
		expect(back.elements[2]).toMatchObject({ table: [["h"], ["v"]] });
		expect(serializeDrawing(back)).toBe(text);
		expect(Object.keys(back.elements[1]).slice(-2)).toEqual(["image", "inFront"]);
	});
});

describe("drawing them", () => {
	it("draws a picture and a table inside the block", () => {
		const svg = toSvgString(renderBlock(block({ image: PIXEL }), { theme: LIGHT_THEME, zoom: 1, interactive: false }));
		expect(svg).toContain("<image");
		expect(svg).toContain(PIXEL);
		const t = toSvgString(renderBlock(block({ table: [["Name", "Qty"], ["Apple", "3"]], width: 200, height: 60 }), { theme: LIGHT_THEME, zoom: 1, interactive: false }));
		for (const cell of ["Name", "Qty", "Apple", "3"]) expect(t).toContain(`>${cell}<`);
	});
	it("sizes a table from its text", () => {
		const s = tableSize([["a", "b"], ["c", "d"]], 14);
		expect(s.height).toBe(2 * Math.ceil(14 * 1.25 + 12));
		expect(s.width).toBeGreaterThanOrEqual(72);
	});
});
