import { beforeAll, describe, expect, it } from "vitest";
import { exportStructuredJson } from "../src/export/json";
import { createEmptyDrawing, parseDrawing, serializeDrawing } from "../src/model/file";
import { traceDependencies, traceMembers } from "../src/model/graph";
import { applyDrawingTheme, DRAWING_THEMES, drawingThemeById } from "../src/model/themes";
import type { BlockElement, ConnectorElement, DrawElement } from "../src/model/types";
import { LIGHT_THEME, PALETTES, paletteById, shadeColor } from "../src/render/colors";
import { blockDepth, blockPaintBounds, flowDirection, renderConnector, type RenderOptions } from "../src/render/elements";
import { toSvgString, type VNode } from "../src/render/vnode";
import { fileStamp } from "../src/model/ids";
import { fontDefinitionById, fontStack, PRESENTATION_FONTS } from "../src/render/fonts";
import { contentBounds, sceneToSvg } from "../src/render/scene";
import { layoutBlockText, titleWeight, useEstimatedTextMeasure } from "../src/render/text";
import { buildWorkbook } from "../src/export/workbook/layout";
import type { SheetModel } from "../src/export/workbook/model";
import { sampleDrawing } from "./fixtures/sample";
import { block, connector, frame } from "./helpers";

beforeAll(() => useEstimatedTextMeasure());

const theme = (id: string) => {
	const t = drawingThemeById(id);
	if (!t) throw new Error(id);
	return t;
};

describe("file format", () => {
	it("defaults the new fields for drawings saved by older versions", () => {
		const d = parseDrawing(
			JSON.stringify({
				type: "block-draw",
				version: 1,
				elements: [
					{ type: "block", id: "a", title: "A", style: { fill: "#fff" } },
					{ type: "block", id: "b", title: "B" },
					{ type: "connector", id: "c", from: { id: "a" }, to: { id: "b" } },
				],
			}),
		);
		const a = d.elements[0] as BlockElement;
		const c = d.elements[2] as ConnectorElement;
		expect(a.tag).toBe("");
		expect(a.style.threeD).toBe(false);
		expect(a.style.fontFamily).toBe("inter");
		expect(c.style.threeD).toBe(false);
		expect(c.style.flow).toBe(false);
	});

	it("round-trips 3D, flow and tags", () => {
		const elements: DrawElement[] = [
			block("a", 0, 0, { tag: "Service", style: { ...block("x", 0, 0).style, threeD: true } }),
			block("b", 300, 0),
			connector("c", "a", "b", { style: { ...connector("x", "a", "b").style, threeD: true, flow: true } }),
		];
		const back = parseDrawing(serializeDrawing({ ...createEmptyDrawing(), elements }));
		expect(back.elements).toEqual(elements);
	});

	it("exports the tag in structured JSON", () => {
		const json = exportStructuredJson({ ...createEmptyDrawing(), elements: [block("a", 0, 0, { tag: "PostgreSQL" })] });
		expect(json.unframed.blocks[0].tag).toBe("PostgreSQL");
	});
});

describe("dependency trace", () => {
	// a → b → c, b → d, e → a, f isolated, c → b (cycle b ↔ c)
	const els: DrawElement[] = [
		block("a", 0, 0),
		block("b", 0, 0),
		block("c", 0, 0),
		block("d", 0, 0),
		block("e", 0, 0),
		block("f", 0, 0),
		connector("ab", "a", "b"),
		connector("bc", "b", "c"),
		connector("bd", "b", "d"),
		connector("ea", "e", "a"),
		connector("cb", "c", "b"),
	];

	it("walks downstream and upstream separately", () => {
		const t = traceDependencies(els, "a");
		expect([...t.downstream].sort()).toEqual(["b", "c", "d"]);
		expect([...t.upstream].sort()).toEqual(["e"]);
		expect(traceMembers(t).has("f")).toBe(false);
		expect(t.connectors.has("ea")).toBe(true);
	});

	it("handles cycles without looping forever", () => {
		const t = traceDependencies(els, "b");
		expect([...t.downstream].sort()).toEqual(["c", "d"]);
		expect([...t.upstream].sort()).toEqual(["a", "c", "e"]);
		expect(t.connectors.has("cb")).toBe(true);
	});
});

describe("drawing themes", () => {
	const els: DrawElement[] = [
		frame("f", -20, -20, 800, 300),
		block("a", 0, 0, { frameId: "f", style: { ...block("x", 0, 0).style, fill: "#a5d8ff" } }),
		block("b", 300, 0, { frameId: "f", style: { ...block("x", 0, 0).style, fill: "#b2f2bb" } }),
		block("c", 600, 0, { frameId: "f", style: { ...block("x", 0, 0).style, fill: "#b2f2bb" } }),
		block("t", 0, 200, { shape: "text", style: { ...block("x", 0, 0).style, fill: "transparent" } }),
		connector("ab", "a", "b"),
		connector("bc", "b", "c"),
	];
	const byId = (list: DrawElement[]) => new Map(list.map((e) => [e.id, e]));

	it("keeps color groups and raises everything for 3D themes", () => {
		const out = byId(applyDrawingTheme(els, theme("futuristic")));
		const a = out.get("a") as BlockElement;
		const b = out.get("b") as BlockElement;
		const c = out.get("c") as BlockElement;
		expect(b.style.fill).toBe(c.style.fill);
		expect(a.style.fill).not.toBe(b.style.fill);
		expect(a.style.threeD && b.style.threeD).toBe(true);
		expect((out.get("ab") as ConnectorElement).style.stroke).toBe(a.style.stroke);
		expect((out.get("ab") as ConnectorElement).style.threeD).toBe(true);
		expect((out.get("t") as BlockElement).style.fill).toBe("transparent");
		expect(out.get("f")).toMatchObject({ style: { fill: "#0f172a", stroke: "#22d3ee" } });
	});

	it("only touches the given ids and never moves anything", () => {
		const out = applyDrawingTheme(els, theme("minimal"), new Set(["a"]));
		const m = byId(out);
		expect((m.get("a") as BlockElement).style.fill).toBe("#ffffff");
		expect(m.get("b")).toBe(els[2]);
		expect(m.get("ab")).toBe(els[5]);
		for (const el of out) if (el.type === "block") expect([el.x, el.y]).toEqual([(byId(els).get(el.id) as BlockElement).x, (byId(els).get(el.id) as BlockElement).y]);
	});

	it("every theme and palette is well formed", () => {
		for (const t of DRAWING_THEMES) {
			expect(t.fills.length).toBeGreaterThan(0);
			expect(t.strokes.length).toBeGreaterThan(0);
		}
		expect(PALETTES.map((p) => p.id)).toEqual(["classic", "3d", "minimal", "futuristic"]);
		expect(paletteById("nope").id).toBe("classic");
		expect(paletteById("3d").id).toBe("3d");
		expect(paletteById("executive").id).toBe("3d");
		expect(drawingThemeById("3d")?.name).toBe("3D");
		expect(drawingThemeById("executive")?.name).toBe("3D");
	});
});

describe("3D rendering", () => {
	it("extrudes 3D blocks and grows the painted bounds", () => {
		const flat = block("a", 0, 0);
		const raised = block("a", 0, 0, { style: { ...flat.style, threeD: true } });
		expect(blockDepth(flat)).toBe(0);
		expect(blockDepth(raised)).toBeGreaterThan(4);
		expect(blockPaintBounds(raised).height).toBeGreaterThan(raised.height);
		expect(contentBounds([raised])?.height).toBeGreaterThan(contentBounds([flat])?.height ?? 0);
		const svg = sceneToSvg([raised], { theme: LIGHT_THEME }).svg;
		expect(svg).toContain("linearGradient");
		expect(svg).toContain('class="bd-block bd-3d"');
		expect(sceneToSvg([flat], { theme: LIGHT_THEME }).svg).not.toContain("linearGradient");
	});

	it("gives 3D links a shadow and sheen, and marks flowing links", () => {
		const els: DrawElement[] = [
			block("a", 0, 0),
			block("b", 400, 0),
			connector("c", "a", "b", { style: { ...connector("x", "a", "b").style, threeD: true, flow: true } }),
		];
		const svg = sceneToSvg(els, { theme: LIGHT_THEME }).svg;
		expect(svg).toContain("bd-connector-shadow");
		expect(svg).toContain("bd-connector-sheen");
		expect(svg).toContain("bd-connector bd-flow bd-3d");
	});

	it("never extrudes text-only blocks", () => {
		const t = block("t", 0, 0, { shape: "text", style: { ...block("x", 0, 0).style, threeD: true } });
		expect(blockDepth(t)).toBe(0);
	});

	it("shades colors toward black or white", () => {
		expect(shadeColor("#ffffff", 0.5)).toBe("#808080");
		expect(shadeColor("#000000", -1)).toBe("#ffffff");
		expect(shadeColor("default", 0.3)).toBeNull();
	});
});

describe("tags", () => {
	it("lays out the tag above the title, in capitals", () => {
		const b = block("a", 0, 0, { title: "Orders", tag: "Service · Java" });
		const layout = layoutBlockText(b);
		expect(layout.lines[0]).toMatchObject({ text: "SERVICE · JAVA", tag: true });
		expect(layout.lines[1].text).toBe("Orders");
		expect(layout.lines[0].size).toBeLessThan(layout.lines[1].size);
		expect(layout.requiredHeight).toBeGreaterThan(layoutBlockText(block("a", 0, 0, { title: "Orders" })).requiredHeight);
	});
});

describe("presentation fonts", () => {
	it("defines the 10 most used business presentation fonts", () => {
		expect(PRESENTATION_FONTS).toHaveLength(10);
		const ids = PRESENTATION_FONTS.map((f) => f.id);
		expect(ids).toEqual([
			"inter",
			"segoe",
			"roboto",
			"arial",
			"calibri",
			"aptos",
			"opensans",
			"montserrat",
			"lato",
			"georgia",
		]);
		for (const f of PRESENTATION_FONTS) {
			expect(f.name.length).toBeGreaterThan(0);
			expect(f.stack.length).toBeGreaterThan(0);
			expect(f.tagline.length).toBeGreaterThan(0);
		}
	});

	it("resolves unknown font ids safely to inter", () => {
		expect(fontDefinitionById("unknown").id).toBe("inter");
		expect(fontDefinitionById(null).id).toBe("inter");
		expect(fontStack("georgia")).toContain("Georgia");
		expect(fontStack("aptos")).toContain("Aptos");
	});

	it("round-trips custom font families across serialization", () => {
		const elements: DrawElement[] = [
			block("a", 0, 0, { style: { ...block("x", 0, 0).style, fontFamily: "montserrat" } }),
			block("b", 200, 0, { style: { ...block("x", 0, 0).style, fontFamily: "georgia" } }),
		];
		const parsed = parseDrawing(serializeDrawing({ ...createEmptyDrawing(), elements }));
		const a = parsed.elements[0] as BlockElement;
		const b = parsed.elements[1] as BlockElement;
		expect(a.style.fontFamily).toBe("montserrat");
		expect(b.style.fontFamily).toBe("georgia");
	});

	it("renders chosen font stack in SVG text elements", () => {
		const b = block("a", 0, 0, {
			title: "Quarterly Review",
			description: "Revenue up 24%",
			tag: "Finance",
			style: { ...block("x", 0, 0).style, fontFamily: "georgia" },
		});
		const svg = sceneToSvg([b], { theme: LIGHT_THEME }).svg;
		expect(svg).toContain("Georgia");
		expect(svg).toContain("Quarterly Review");
		expect(svg).toContain("Revenue up 24%");
	});
});


describe("hiding a block's description", () => {
	const withDescription = (open: boolean) => block("a", 0, 0, { title: "Orders", description: "Handles checkout", descriptionOpen: open });

	it("is shown for drawings saved before the toggle existed", () => {
		const d = parseDrawing(
			JSON.stringify({ type: "block-draw", version: 1, elements: [{ type: "block", id: "a", title: "A", description: "text" }] }),
		);
		expect((d.elements[0] as BlockElement).descriptionOpen).toBe(true);
	});

	it("round-trips through the file format", () => {
		const elements: DrawElement[] = [withDescription(false), block("b", 300, 0, { description: "x" })];
		const back = parseDrawing(serializeDrawing({ ...createEmptyDrawing(), elements }));
		expect(back.elements).toEqual(elements);
		expect((back.elements[0] as BlockElement).descriptionOpen).toBe(false);
	});

	it("lays out the title alone, exactly like a block without a description", () => {
		const shown = layoutBlockText(withDescription(true));
		const hidden = layoutBlockText(withDescription(false));
		expect(shown.lines.map((l) => l.text)).toEqual(["Orders", "Handles checkout"]);
		expect(hidden.lines.map((l) => l.text)).toEqual(["Orders"]);
		expect(hidden.requiredHeight).toBeLessThan(shown.requiredHeight);
		expect(hidden).toEqual(layoutBlockText(block("a", 0, 0, { title: "Orders" })));
		expect(titleWeight(withDescription(true))).toBe(600);
		expect(titleWeight(withDescription(false))).toBe(500);
	});

	it("keeps the text but does not draw it in SVG exports", () => {
		expect(sceneToSvg([withDescription(true)], { theme: LIGHT_THEME }).svg).toContain("Handles checkout");
		expect(sceneToSvg([withDescription(false)], { theme: LIGHT_THEME }).svg).not.toContain("Handles checkout");
		expect(withDescription(false).description).toBe("Handles checkout");
	});

	it("is still exported as data in the JSON, without the shown/hidden flag", () => {
		const json = exportStructuredJson({ ...createEmptyDrawing(), elements: [withDescription(false)] });
		expect(json.unframed.blocks[0].description).toBe("Handles checkout");
		expect(json.unframed.blocks[0]).not.toHaveProperty("descriptionOpen");
	});

	it("leaves the workbook's drawn grid but stays in its tables", () => {
		const frameSheet = (open: boolean): SheetModel => {
			const d = sampleDrawing();
			d.elements = d.elements.map((e) => (e.id === "pay" ? { ...e, descriptionOpen: open } : e));
			const wb = buildWorkbook(d, { title: "Checkout" });
			return wb.sheets.find((s) => s.key === "frame:f1") as SheetModel;
		};
		const values = (s: SheetModel) => [...s.cells.values()].map((c) => String(c.value ?? ""));
		const drawn = (s: SheetModel) => values(s).filter((v) => v.includes("\nCard, wallet or invoice"));
		const tabled = (s: SheetModel) => values(s).filter((v) => v === "Card, wallet or invoice");
		const shown = frameSheet(true);
		expect(drawn(shown)).toHaveLength(1);
		expect(tabled(shown)).toHaveLength(1);
		const hidden = frameSheet(false);
		expect(drawn(hidden)).toHaveLength(0);
		expect(tabled(hidden)).toHaveLength(1);
	});
});

describe("flow direction on links", () => {
	const a = block("a", 0, 0);
	const b = block("b", 400, 0);
	const flowing = (patch: Partial<ConnectorElement["style"]>, extra: Partial<ConnectorElement> = {}) =>
		connector("c", "a", "b", { style: { ...connector("x", "a", "b").style, flow: true, ...patch }, ...extra });
	const draw = (conn: ConnectorElement, o: Partial<RenderOptions> = {}) =>
		renderConnector(conn, a, b, { theme: LIGHT_THEME, zoom: 1, interactive: false, ...o });
	const find = (node: VNode, cls: string): VNode[] => {
		const own = String(node.attrs.class ?? "").split(" ").includes(cls) ? [node] : [];
		return [...own, ...node.children.flatMap((c) => (typeof c === "string" ? [] : find(c, cls)))];
	};
	/** Numbers of a path's data, as [x, y] pairs. */
	const points = (n: VNode): [number, number][] => {
		const nums = String(n.attrs.d).match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
		return Array.from({ length: nums.length / 2 }, (_, i) => [nums[2 * i], nums[2 * i + 1]]);
	};

	it("follows the arrowheads", () => {
		const s = connector("x", "a", "b").style;
		expect(flowDirection({ ...s, startArrow: "none", endArrow: "arrow" })).toBe("forward");
		expect(flowDirection({ ...s, startArrow: "none", endArrow: "none" })).toBe("forward");
		expect(flowDirection({ ...s, startArrow: "dot", endArrow: "none" })).toBe("backward");
		expect(flowDirection({ ...s, startArrow: "triangle", endArrow: "arrow" })).toBe("both");
	});

	it("draws a one-way link start to end, and a start-only link end to start", () => {
		const forward = find(draw(flowing({})), "bd-connector-line");
		expect(forward).toHaveLength(1);
		const [first, last] = [points(forward[0])[0], points(forward[0]).at(-1) as [number, number]];
		expect(first[0]).toBeLessThan(last[0]);

		const backward = find(draw(flowing({ startArrow: "arrow", endArrow: "none" })), "bd-connector-line");
		expect(backward).toHaveLength(1);
		const pts = points(backward[0]);
		expect(pts[0][0]).toBeGreaterThan((pts.at(-1) as [number, number])[0]);
		// the arrowheads are drawn separately, so reversing the path moves nothing visible
		expect(toSvgString(draw(flowing({ startArrow: "arrow", endArrow: "none" })))).toContain("bd-flow");
	});

	it("gives a two-way link two lanes that run against each other", () => {
		const node = draw(flowing({ startArrow: "arrow", endArrow: "arrow" }));
		const lanes = find(node, "bd-flow-lane");
		expect(lanes).toHaveLength(2);
		expect(find(node, "bd-connector-line")).toHaveLength(2);
		const [there, back] = lanes.map(points);
		// one lane runs left to right, the other right to left
		expect(there[0][0]).toBeLessThan((there.at(-1) as [number, number])[0]);
		expect(back[0][0]).toBeGreaterThan((back.at(-1) as [number, number])[0]);
		// on either side of the centre line (y = 40), the same distance away
		expect(there[0][1]).toBeGreaterThan(40);
		expect(back[0][1]).toBeLessThan(40);
		expect(there[0][1] - 40).toBeCloseTo(40 - back[0][1], 5);
		// and thinner than the single line, so the pair still reads as one link
		const w = (n: VNode) => Number(/stroke-width:([\d.]+)/.exec(String(n.attrs.style))?.[1]);
		expect(w(lanes[0])).toBeLessThan(2);
	});

	it("keeps a plain two-way link as one line unless it is flowing or traced", () => {
		const twoWay = { startArrow: "arrow", endArrow: "arrow" } as const;
		const still = draw(flowing({ ...twoWay, flow: false }));
		expect(find(still, "bd-connector-line")).toHaveLength(1);
		expect(find(still, "bd-flow-lane")).toHaveLength(0);
		const traced = draw(flowing({ ...twoWay, flow: false }), { tracedLinks: new Set(["c"]) });
		expect(find(traced, "bd-flow-lane")).toHaveLength(2);
		const elsewhere = draw(flowing({ ...twoWay, flow: false }), { tracedLinks: new Set(["other"]) });
		expect(find(elsewhere, "bd-flow-lane")).toHaveLength(0);
	});

	it("leaves one-way links exactly as they were drawn before", () => {
		const plain = toSvgString(draw(flowing({ flow: false })));
		const flowOn = toSvgString(draw(flowing({})));
		expect(plain.replace("bd-connector", "bd-connector bd-flow")).toBe(flowOn);
		expect(plain).not.toContain("bd-flow-lane");
	});

	it("shades and highlights both lanes of a raised link", () => {
		const raised = draw(flowing({ startArrow: "arrow", endArrow: "arrow", threeD: true }));
		expect(find(raised, "bd-flow-lane")).toHaveLength(2);
		expect(find(raised, "bd-connector-sheen")).toHaveLength(2);
		const shadow = find(raised, "bd-connector-shadow")[0];
		const width = Number(/stroke-width:([\d.]+)/.exec(String((shadow.children[0] as VNode).attrs.style))?.[1]);
		expect(width).toBeGreaterThan(5);
	});

	it("follows a curved route", () => {
		const curved = draw(flowing({ startArrow: "arrow", endArrow: "arrow" }, { routing: "curved" }));
		const lanes = find(curved, "bd-flow-lane");
		expect(lanes).toHaveLength(2);
		for (const lane of lanes) {
			const pts = points(lane);
			expect(pts.length).toBeGreaterThan(10);
			expect(pts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
		}
	});
});

describe("vertical title alignment", () => {
	const styled = (v: "top" | "middle" | "bottom", extra: Partial<BlockElement> = {}) =>
		block("a", 0, 0, { title: "Orders", ...extra, style: { ...block("x", 0, 0).style, textVAlign: v } });
	const firstY = (b: BlockElement) => layoutBlockText(b).lines[0].y;

	it("keeps the text centered for drawings saved before the option existed", () => {
		const d = parseDrawing(JSON.stringify({ type: "block-draw", version: 1, elements: [{ type: "block", id: "a", title: "A" }] }));
		expect((d.elements[0] as BlockElement).style.textVAlign).toBe("middle");
		const bad = parseDrawing(JSON.stringify({ type: "block-draw", version: 1, elements: [{ type: "block", id: "a", style: { textVAlign: "sideways" } }] }));
		expect((bad.elements[0] as BlockElement).style.textVAlign).toBe("middle");
	});

	it("round-trips through the file format", () => {
		const elements: DrawElement[] = [styled("top"), styled("bottom", { id: "b", x: 300 })];
		const back = parseDrawing(serializeDrawing({ ...createEmptyDrawing(), elements }));
		expect(back.elements).toEqual(elements);
	});

	it("puts a one-line title at the top, middle or bottom of the block", () => {
		// 160×80 rounded block: text area y 8..72, one 20-unit line, baseline 10 + 0.35 × 16 into the line
		const baseline = 10 + 16 * 0.35;
		expect(firstY(styled("top"))).toBeCloseTo(8 + baseline, 5);
		expect(firstY(styled("middle"))).toBeCloseTo(8 + 22 + baseline, 5);
		expect(firstY(styled("bottom"))).toBeCloseTo(72 - 20 + baseline, 5);
	});

	it("moves the whole text group, not just the title", () => {
		const group = { tag: "Service", description: "Handles checkout" };
		const lines = (v: "top" | "middle" | "bottom") => layoutBlockText(styled(v, group)).lines.map((l) => l.y);
		const [top, middle, bottom] = [lines("top"), lines("middle"), lines("bottom")];
		expect(top).toHaveLength(3);
		for (let i = 0; i < 3; i++) {
			expect(top[i]).toBeLessThan(middle[i]);
			expect(middle[i]).toBeLessThan(bottom[i]);
		}
		// the spacing between the lines is the same for every alignment
		expect(top[1] - top[0]).toBeCloseTo(bottom[1] - bottom[0], 5);
		expect(top[2] - top[1]).toBeCloseTo(bottom[2] - bottom[1], 5);
	});

	it("starts at the top edge for every alignment when the text is taller than the block", () => {
		const tall = { title: "Orders ".repeat(40) };
		const ys = (["top", "middle", "bottom"] as const).map((v) => firstY(styled(v, tall)));
		expect(ys[0]).toBeCloseTo(ys[1], 5);
		expect(ys[1]).toBeCloseTo(ys[2], 5);
	});

	it("is applied to the block's cell in the workbook grid", () => {
		const d = sampleDrawing();
		d.elements = d.elements.map((e) =>
			e.id === "cart" ? ({ ...e, style: { ...(e as BlockElement).style, textVAlign: "top" } } as DrawElement) : e,
		);
		const wb = buildWorkbook(d, { title: "Checkout" });
		const sheet = wb.sheets.find((s) => s.key === "frame:f1") as SheetModel;
		const cell = [...sheet.cells.values()].find((c) => c.value === "Cart" && c.style?.bg);
		expect(cell?.style?.vAlign).toBe("top");
		const payCell = [...sheet.cells.values()].find((c) => String(c.value).includes("\nPayment\n") && c.style?.bg);
		expect(payCell?.style?.vAlign).toBe("middle");
	});
});

describe("links above blocks", () => {
	const container = block("box", 0, 0, { title: "Platform", width: 500, height: 260 });
	const els: DrawElement[] = [
		container,
		block("web", 40, 80, { title: "Web" }),
		block("api", 300, 80, { title: "API" }),
		connector("c", "web", "api", { label: "calls" }),
	];

	it("draws links and their labels after (above) every block in exports and embeds", () => {
		const svg = sceneToSvg(els, { theme: LIGHT_THEME }).svg;
		const at = (needle: string) => svg.lastIndexOf(needle);
		expect(at('class="bd-block"')).toBeGreaterThan(-1);
		// the last block comes before the first link, and the label after the link
		expect(svg.indexOf('class="bd-connector"')).toBeGreaterThan(at('class="bd-block"'));
		expect(svg.indexOf('class="bd-connector-label"')).toBeGreaterThan(svg.indexOf('class="bd-connector"'));
	});

	it("keeps frames at the very back", () => {
		const svg = sceneToSvg([frame("f", -20, -20, 600, 320), ...els], { theme: LIGHT_THEME }).svg;
		expect(svg.indexOf('class="bd-frame"')).toBeLessThan(svg.indexOf('class="bd-block"'));
	});
});

describe("new drawing names", () => {
	it("stamps local date and time with fixed widths", () => {
		expect(fileStamp(new Date(2026, 9, 2, 9, 5, 7))).toBe("2026-10-02 09.05.07");
		expect(fileStamp(new Date(2027, 11, 31, 23, 59, 59))).toBe("2027-12-31 23.59.59");
	});
});
