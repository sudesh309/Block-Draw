import { beforeAll, describe, expect, it } from "vitest";
import { exportStructuredJson } from "../src/export/json";
import { createEmptyDrawing, parseDrawing, serializeDrawing } from "../src/model/file";
import { traceDependencies, traceMembers } from "../src/model/graph";
import { applyDrawingTheme, DRAWING_THEMES, drawingThemeById } from "../src/model/themes";
import type { BlockElement, ConnectorElement, DrawElement } from "../src/model/types";
import { LIGHT_THEME, PALETTES, paletteById, shadeColor } from "../src/render/colors";
import { blockDepth, blockPaintBounds } from "../src/render/elements";
import { fontDefinitionById, fontStack, PRESENTATION_FONTS } from "../src/render/fonts";
import { contentBounds, sceneToSvg } from "../src/render/scene";
import { layoutBlockText, useEstimatedTextMeasure } from "../src/render/text";
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
		const json = exportStructuredJson({ ...createEmptyDrawing(), elements: [block("a", 0, 0, { tag: "PostgreSQL" })] }, { name: "x" });
		expect(json.unframed.blocks[0].tag).toBe("PostgreSQL");
		expect(json.unframed.blocks[0].style.threeD).toBe(false);
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

