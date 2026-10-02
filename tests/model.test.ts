import { describe, expect, it } from "vitest";
import { createEmptyDrawing, DrawingParseError, parseDrawing, serializeDrawing } from "../src/model/file";
import { History } from "../src/model/history";
import { frameLink, normalizeLinkInput, parseLink } from "../src/model/links";
import {
	assignFrames,
	cloneElements,
	collectForCopy,
	deleteElements,
	expandMoveSet,
	insertClones,
	moveFrameOrder,
	readClipboardPayload,
	makeClipboardPayload,
	refreshFrameMembership,
	reorderElements,
	translateElements,
	updateElements,
} from "../src/model/ops";
import type { BlockElement, DrawElement } from "../src/model/types";
import { block, connector, frame } from "./helpers";

describe("file format", () => {
	it("treats an empty file as an empty drawing", () => {
		expect(parseDrawing("")).toEqual(createEmptyDrawing());
		expect(parseDrawing("   \n")).toEqual(createEmptyDrawing());
	});

	it("rejects invalid JSON and foreign file types", () => {
		expect(() => parseDrawing("{nope")).toThrow(DrawingParseError);
		expect(() => parseDrawing('{"type":"excalidraw"}')).toThrow(DrawingParseError);
		expect(() => parseDrawing("[1,2]")).toThrow(DrawingParseError);
	});

	it("fills defaults, drops dangling connectors and unknown frames", () => {
		const data = parseDrawing(
			JSON.stringify({
				type: "block-draw",
				version: 1,
				elements: [
					{ id: "a", type: "block", x: 1, y: 2, title: "A", frameId: "missing" },
					{ id: "b", type: "block", x: 300, y: 2, shape: "weird" },
					{ id: "c1", type: "connector", from: { id: "a" }, to: { id: "b" } },
					{ id: "c2", type: "connector", from: { id: "a" }, to: { id: "nope" } },
					{ id: "c3", type: "connector", from: { id: "a" }, to: { id: "a" } },
					{ type: "mystery" },
					"junk",
				],
			}),
		);
		expect(data.elements.map((e) => e.id)).toEqual(["a", "b", "c1"]);
		const a = data.elements[0] as BlockElement;
		expect(a.frameId).toBeNull();
		expect(a.width).toBe(160);
		expect(a.style.fill).toBe("#a5d8ff");
		expect(a.style.fontFamily).toBe("inter");
		expect(a.comment).toBe("");
		expect(a.commentOpen).toBe(false);
		expect((data.elements[1] as BlockElement).shape).toBe("rounded");
	});

	it("normalizes comment and commentOpen, defaulting values of the wrong type", () => {
		const data = parseDrawing(
			JSON.stringify({
				elements: [
					{ id: "a", type: "block", comment: 42, commentOpen: "yes" },
					{ id: "b", type: "block", comment: "note", commentOpen: true },
					{ id: "c", type: "connector", from: { id: "a" }, to: { id: "b" }, comment: "watch for timeouts", commentOpen: true },
				],
			}),
		);
		const [a, b, c] = data.elements;
		expect(a).toMatchObject({ comment: "", commentOpen: false });
		expect(b).toMatchObject({ comment: "note", commentOpen: true });
		expect(c).toMatchObject({ comment: "watch for timeouts", commentOpen: true });
	});

	it("round-trips and preserves unknown top-level keys", () => {
		const file = {
			...createEmptyDrawing(),
			elements: [block("a", 0, 0), block("b", 300, 0), connector("c", "a", "b", { label: "yes" })] as DrawElement[],
			exports: { googleSheet: { spreadsheetId: "x", url: "u", exportedAt: "t" } },
			futureKey: { keep: true },
		};
		const text = serializeDrawing(file);
		expect(text.split("\n").filter((l) => l.startsWith("\t\t{")).length).toBe(3);
		const back = parseDrawing(text);
		expect(back.elements).toEqual(file.elements);
		expect(back.exports).toEqual(file.exports);
		expect(back.futureKey).toEqual({ keep: true });
	});

	it("re-ids duplicated element ids", () => {
		const data = parseDrawing(
			JSON.stringify({ elements: [{ id: "a", type: "block" }, { id: "a", type: "block" }] }),
		);
		expect(data.elements).toHaveLength(2);
		expect(data.elements[0].id).not.toBe(data.elements[1].id);
	});
});

describe("links", () => {
	it("parses the three link kinds", () => {
		expect(parseLink(frameLink("f1"))).toEqual({ kind: "frame", frameId: "f1" });
		expect(parseLink("https://example.com/x")).toEqual({ kind: "url", url: "https://example.com/x" });
		expect(parseLink("obsidian://open?vault=v")).toEqual({ kind: "url", url: "obsidian://open?vault=v" });
		expect(parseLink("[[Folder/Note#Heading|Alias]]")).toEqual({
			kind: "note",
			linktext: "Folder/Note#Heading",
			path: "Folder/Note",
			subpath: "#Heading",
			display: "Alias",
		});
		expect(parseLink("Note")).toMatchObject({ kind: "note", path: "Note", display: "Note" });
		expect(parseLink("")).toBeNull();
		expect(parseLink("[[ ]]")).toBeNull();
	});

	it("normalizes typed input", () => {
		expect(normalizeLinkInput("Projects/Plan")).toBe("[[Projects/Plan]]");
		expect(normalizeLinkInput("[[A|Nice]]")).toBe("[[A|Nice]]");
		expect(normalizeLinkInput(" https://x.y ")).toBe("https://x.y");
		expect(normalizeLinkInput("   ")).toBeNull();
	});
});

describe("scene operations", () => {
	const scene = (): DrawElement[] => [
		frame("F", 0, 0, 600, 400),
		frame("G", 1000, 0, 600, 400),
		block("a", 40, 40, { frameId: "F" }),
		block("b", 300, 40, { frameId: "F", link: frameLink("G") }),
		block("c", 1100, 40, { frameId: "G" }),
		block("free", 2000, 2000),
		connector("ab", "a", "b"),
		connector("bc", "b", "c"),
	];

	it("deleting a frame removes its blocks, their connectors and links to it", () => {
		const out = deleteElements(scene(), ["G"]);
		expect(out.map((e) => e.id).sort()).toEqual(["F", "a", "ab", "b", "free"].sort());
		expect((out.find((e) => e.id === "b") as BlockElement).link).toBeNull();
	});

	it("deleting a block removes attached connectors only", () => {
		const out = deleteElements(scene(), ["b"]);
		expect(out.map((e) => e.id).sort()).toEqual(["F", "G", "a", "c", "free"].sort());
	});

	it("moving a frame carries its children", () => {
		const els = scene();
		const set = expandMoveSet(els, ["F"]);
		expect([...set].sort()).toEqual(["F", "a", "b"]);
		const moved = translateElements(els, set, 10, 20);
		const a = moved.find((e) => e.id === "a") as BlockElement;
		expect([a.x, a.y]).toEqual([50, 60]);
		expect(moved.find((e) => e.id === "c")).toBe(els.find((e) => e.id === "c"));
	});

	it("assigns blocks to the topmost frame containing their center", () => {
		let els: DrawElement[] = [frame("F", 0, 0, 500, 500), frame("Top", 100, 100, 300, 300), block("x", 150, 150)];
		els = assignFrames(els, ["x"]);
		expect((els[2] as BlockElement).frameId).toBe("Top");
		els = updateElements(els, new Map([["x", { x: 2000 }]]));
		els = assignFrames(els, ["x"]);
		expect((els[2] as BlockElement).frameId).toBeNull();
	});

	it("refreshes membership after a frame resize", () => {
		let els = scene();
		els = updateElements(els, new Map([["F", { width: 250 }]]));
		els = refreshFrameMembership(els, "F");
		expect((els.find((e) => e.id === "b") as BlockElement).frameId).toBeNull();
		expect((els.find((e) => e.id === "a") as BlockElement).frameId).toBe("F");
	});

	it("updateElements keeps identity of untouched and unchanged elements", () => {
		const els = scene();
		const out = updateElements(els, new Map([["a", { x: 40 }], ["b", { x: 1 }]]));
		expect(out[2]).toBe(els[2]);
		expect(out[3]).not.toBe(els[3]);
		expect(out[4]).toBe(els[4]);
	});

	it("copies frames with their content and remaps references", () => {
		const els = scene();
		const picked = collectForCopy(els, ["F", "G"]);
		expect(picked.map((e) => e.id).sort()).toEqual(["F", "G", "a", "ab", "b", "bc", "c"].sort());
		const { elements, idMap } = cloneElements(picked, 50, 0);
		const b2 = elements.find((e) => e.id === idMap.get("b")) as BlockElement;
		expect(b2.frameId).toBe(idMap.get("F"));
		expect(b2.link).toBe(frameLink(idMap.get("G") as string));
		expect(b2.x).toBe(350);
		const ab2 = elements.find((e) => e.id === idMap.get("ab"));
		expect(ab2).toMatchObject({ from: { id: idMap.get("a") }, to: { id: idMap.get("b") } });
	});

	it("re-assigns frames for pasted blocks whose frame was not copied", () => {
		const els = scene();
		const { elements } = cloneElements(collectForCopy(els, ["a"]), 1000, 0);
		const next = insertClones(els, elements, new Set(elements.map((e) => e.id)));
		const pasted = next[next.length - 1] as BlockElement;
		expect(pasted.frameId).toBe("G");
	});

	it("drops connectors whose ends are not copied", () => {
		const { elements } = cloneElements(collectForCopy(scene(), ["a", "ab"]), 0, 0);
		expect(elements.map((e) => e.type)).toEqual(["block"]);
	});

	it("round-trips clipboard payloads", () => {
		const payload = JSON.stringify(makeClipboardPayload([block("a", 0, 0)]));
		expect(readClipboardPayload(payload)).toHaveLength(1);
		expect(readClipboardPayload("hello")).toBeNull();
		expect(readClipboardPayload('{"type":"other"}')).toBeNull();
	});

	it("reorders within a layer", () => {
		const els = [block("a", 0, 0), frame("F", 0, 0, 10, 10), block("b", 0, 0), block("c", 0, 0)];
		expect(reorderElements(els, new Set(["a"]), "front").map((e) => e.id)).toEqual(["F", "b", "c", "a"]);
		expect(reorderElements(els, new Set(["c"]), "back").map((e) => e.id)).toEqual(["c", "a", "F", "b"]);
		expect(reorderElements(els, new Set(["a"]), "forward").map((e) => e.id)).toEqual(["F", "b", "a", "c"]);
		expect(reorderElements(els, new Set(["c"]), "backward").map((e) => e.id)).toEqual(["a", "F", "c", "b"]);
	});

	it("moves frames in frame order", () => {
		const els = scene();
		const out = moveFrameOrder(els, "G", -1);
		expect(out.filter((e) => e.type === "frame").map((e) => e.id)).toEqual(["G", "F"]);
		expect(moveFrameOrder(els, "F", -1)).toEqual(els);
	});
});

describe("history", () => {
	it("undoes and redoes snapshots", () => {
		const h = new History(3);
		const s0 = { elements: [], selection: [] };
		const s1 = { elements: [block("a", 0, 0)], selection: ["a"] };
		h.push(s0);
		expect(h.canUndo).toBe(true);
		expect(h.undo(s1)).toBe(s0);
		expect(h.redo(s0)).toBe(s1);
		expect(h.redo(s1)).toBeNull();
	});

	it("caps the number of entries and clears redo on push", () => {
		const h = new History(2);
		const s = (n: number) => ({ elements: [], selection: [String(n)] });
		h.push(s(1));
		h.push(s(2));
		h.push(s(3));
		expect(h.undo(s(4))?.selection).toEqual(["3"]);
		expect(h.undo(s(3))?.selection).toEqual(["2"]);
		expect(h.undo(s(2))).toBeNull();
		h.push(s(9));
		expect(h.canRedo).toBe(false);
	});
});
