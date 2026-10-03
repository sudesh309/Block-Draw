import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeElements, parseDrawing, serializeDrawing } from "../src/model/file";
import type { DrawElement } from "../src/model/types";
import { expectGolden } from "./golden";
import { fullDrawing } from "./fixtures/full";

const legacy = readFileSync(join(__dirname, "fixtures", "legacy-0.1.0.blockdraw"), "utf8");
const formatDoc = readFileSync(join(__dirname, "..", "docs", "FORMAT.md"), "utf8");

describe("the .blockdraw format", () => {
	it("writes a drawing exactly as the golden file says", () => {
		expectGolden("drawing.blockdraw", serializeDrawing(fullDrawing()));
	});

	it("reads back what it writes, byte for byte", () => {
		const text = serializeDrawing(fullDrawing());
		expect(serializeDrawing(parseDrawing(text))).toBe(text);
	});

	it("opens a 0.1.0 file, fills in every newer field and repairs bad values", () => {
		expectGolden("legacy-0.1.0.normalized.blockdraw", serializeDrawing(parseDrawing(legacy)));
	});

	it("keeps top-level keys it does not know", () => {
		expect(parseDrawing(serializeDrawing(fullDrawing())).futureKey).toEqual({ keptBy: "older releases" });
		expect(parseDrawing(legacy).futureKey).toBe("kept as is");
	});
});

/* ------------------------------------------------- docs/FORMAT.md stays true */

type Row = { field: string; defaultCell: string };

/** The rows of the first table after a `### <heading>` line. */
function tableRows(heading: string): Row[] {
	const start = formatDoc.indexOf(`\n### ${heading}\n`);
	expect(start, `FORMAT.md has a "${heading}" section`).toBeGreaterThan(-1);
	const rows: Row[] = [];
	for (const line of formatDoc.slice(start).split("\n").slice(2)) {
		if (line.startsWith("#")) break;
		const m = /^\| `([^`]+)` \| [^|]+ \| ([^|]+) \|/.exec(line);
		if (m) rows.push({ field: m[1], defaultCell: m[2].trim() });
	}
	return rows;
}

/** Dotted paths of every leaf value, e.g. "style.fill". */
function leafPaths(value: unknown, prefix = ""): string[] {
	if (value === null || typeof value !== "object") return [prefix];
	return Object.entries(value).flatMap(([k, v]) => leafPaths(v, prefix ? `${prefix}.${k}` : k));
}

const get = (obj: unknown, path: string): unknown =>
	path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);

function withValue(raw: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
	const [head, ...rest] = path.split(".");
	if (!rest.length) return { ...raw, [head]: value };
	const inner = (raw[head] && typeof raw[head] === "object" ? raw[head] : {}) as Record<string, unknown>;
	return { ...raw, [head]: withValue(inner, rest.join("."), value) };
}

const RAW: Record<"block" | "frame" | "connector", Record<string, unknown>> = {
	block: { type: "block", id: "x" },
	frame: { type: "frame", id: "x" },
	connector: { type: "connector", id: "x", from: { id: "a" }, to: { id: "b" } },
};

/** Normalizes one raw element (with two blocks for a connector to point at). */
function normalizeOne(raw: Record<string, unknown>): DrawElement {
	const all = normalizeElements([{ type: "block", id: "a" }, { type: "block", id: "b" }, raw]);
	const el = all.find((e) => e.id === raw.id);
	if (!el) throw new Error(`element ${JSON.stringify(raw)} was dropped`);
	return el;
}

const SECTIONS = [
	["Block", "block"],
	["Frame", "frame"],
	["Connector", "connector"],
] as const;

describe("docs/FORMAT.md", () => {
	for (const [heading, type] of SECTIONS) {
		it(`documents every ${type} field, and its default matches the parser`, () => {
			const rows = tableRows(heading);
			const el = normalizeOne(RAW[type]);
			expect(rows.map((r) => r.field).sort()).toEqual(leafPaths(el).sort());
			for (const row of rows) {
				const literal = /^`(.*)`$/.exec(row.defaultCell);
				if (!literal) continue; // "required", "a new random id"
				expect(get(el, row.field), `default of ${type}.${row.field}`).toEqual(JSON.parse(literal[1]));
			}
		});
	}

	it("lists value sets that the parser accepts, and nothing else falls through", () => {
		const start = formatDoc.indexOf("\n## Value sets\n");
		expect(start).toBeGreaterThan(-1);
		const lines = formatDoc.slice(start).split("\n").filter((l) => /^\| [a-z]/.test(l));
		expect(lines.length).toBeGreaterThan(5);
		for (const line of lines) {
			const [, usedBy, values] = line.split("|").map((c) => c.trim()).filter(Boolean);
			const ticks = (cell: string) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
			for (const path of ticks(usedBy)) {
				const types = (Object.keys(RAW) as (keyof typeof RAW)[]).filter((t) => get(normalizeOne(RAW[t]), path) !== undefined);
				expect(types.length, `${path} belongs to an element`).toBeGreaterThan(0);
				for (const type of types) {
					for (const value of ticks(values)) {
						expect(get(normalizeOne(withValue(RAW[type], path, value)), path), `${type}.${path} = ${value}`).toBe(value);
					}
					const fallback = get(normalizeOne(RAW[type]), path);
					expect(get(normalizeOne(withValue(RAW[type], path, "not-a-value")), path)).toBe(fallback);
				}
			}
		}
	});
});
