import { strFromU8, unzipSync } from "fflate";
import { beforeAll, describe, it } from "vitest";
import { assignSheetIds, buildSheetsRequests } from "../src/export/gsheets/requests";
import { exportJsonText } from "../src/export/json";
import { buildWorkbook } from "../src/export/workbook/layout";
import type { WorkbookModel } from "../src/export/workbook/model";
import { writeXlsx } from "../src/export/workbook/xlsx";
import { BLOCK_SHAPES } from "../src/model/types";
import { LIGHT_THEME } from "../src/render/colors";
import { sceneToSvg } from "../src/render/scene";
import { useEstimatedTextMeasure } from "../src/render/text";
import { expectGolden } from "./golden";
import { block, connector } from "./helpers";
import { fullDrawing } from "./fixtures/full";
import { sampleDrawing } from "./fixtures/sample";

/*
 * Golden files for every export and for the renderer. They change only on purpose: a refactor that
 * moves code must leave all of them byte-identical.
 */

beforeAll(() => useEstimatedTextMeasure());

const NOW = new Date("2026-10-01T12:00:00Z");

/** One tag per line, so a change shows up as a readable diff. */
const tagPerLine = (xml: string) => xml.replace(/></g, ">\n<") + "\n";

function workbook(): WorkbookModel {
	return buildWorkbook(sampleDrawing(), {
		title: "Checkout",
		resolveNoteUrl: (t) => `obsidian://open?vault=Vault&file=${encodeURIComponent(t)}`,
	});
}

const compareKeys = (a: unknown, b: unknown): number => {
	if (typeof a === "number" && typeof b === "number") return a - b;
	const [ar, ac] = String(a).split(":").map(Number);
	const [br, bc] = String(b).split(":").map(Number);
	return ar - br || ac - bc;
};

const sorted = <K, V>(m: Map<K, V>) => [...m.entries()].sort(([a], [b]) => compareKeys(a, b));

/** One line per sheet property group and per cell, so the file stays small and diffs stay readable. */
function workbookText(model: WorkbookModel): string {
	const lines = [`workbook ${JSON.stringify(model.title)}`];
	for (const { cells, colWidths, rowHeights, ...sheet } of model.sheets) {
		lines.push(`sheet ${JSON.stringify(sheet)}`, `  colWidths ${JSON.stringify(sorted(colWidths))}`, `  rowHeights ${JSON.stringify(sorted(rowHeights))}`);
		for (const [key, cell] of sorted(cells)) lines.push(`  ${key} ${JSON.stringify(cell)}`);
	}
	return lines.join("\n") + "\n";
}

/** One request per line. */
const requestsText = (requests: unknown[]) => "[\n" + requests.map((r) => JSON.stringify(r)).join(",\n") + "\n]\n";

describe("exports (golden)", () => {
	it("structured JSON", () => {
		expectGolden("export/structured-sample.json", exportJsonText(sampleDrawing(), "structured"));
		expectGolden("export/structured-full.json", exportJsonText(fullDrawing(), "structured"));
	});

	it("raw JSON is the drawing file itself", () => {
		expectGolden("drawing.blockdraw", exportJsonText(fullDrawing(), "raw"));
	});

	it("workbook layout", () => {
		expectGolden("export/workbook.txt", workbookText(workbook()));
	});

	it("Excel file contents", () => {
		const parts = unzipSync(writeXlsx(workbook(), { now: NOW }));
		const text = Object.keys(parts)
			.sort()
			.map((path) => `=== ${path}\n${tagPerLine(strFromU8(parts[path]))}`)
			.join("");
		expectGolden("export/workbook.xlsx.txt", text);
	});

	it("Google Sheets requests", () => {
		const model = workbook();
		expectGolden("export/sheets-requests.json", requestsText(buildSheetsRequests(model, assignSheetIds(model))));
	});
});

describe("renderer (golden)", () => {
	for (const shape of BLOCK_SHAPES) {
		it(`draws a ${shape} block and links meeting it from three directions`, () => {
			const els = [
				block("t", 300, 200, { title: `A ${shape}`, tag: "Tag", description: "Two lines of description text", shape }),
				block("a", 0, 200, { title: "Left" }),
				block("b", 0, 0, { title: "Above left" }),
				block("c", 600, 420, { title: "Below right" }),
				connector("ea", "a", "t"),
				connector("eb", "b", "t", { routing: "straight" }),
				connector("ec", "c", "t", { routing: "curved" }),
			];
			expectGolden(`render/shape-${shape}.svg`, tagPerLine(sceneToSvg(els, { theme: LIGHT_THEME }).svg));
		});
	}

	it("draws the full drawing", () => {
		expectGolden("render/drawing.svg", tagPerLine(sceneToSvg(fullDrawing().elements, { theme: LIGHT_THEME }).svg));
	});
});
