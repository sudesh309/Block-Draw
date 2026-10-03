import { describe, expect, it } from "vitest";
import { EXPORTERS, exporterRows } from "../src/obsidian/exporters";

describe("the EXPORTERS table", () => {
	it("keeps the command ids of 0.4.6, so hotkeys people bound still work", () => {
		expect(exporterRows().map(([, ex]) => ex.command.id)).toEqual([
			"export-google-sheets",
			"export-google-sheets-new",
			"export-xlsx",
			"export-json",
			"copy-json",
			"export-png",
			"export-svg",
		]);
	});

	it("puts the same entries in the same order in each menu", () => {
		const menu = (where: "view" | "file") => exporterRows().filter(([, ex]) => ex.menus.includes(where)).map(([, ex]) => ex.label);
		expect(menu("view")).toEqual(["Export to Google Sheets", "Export Excel workbook (.xlsx)", "Export JSON", "Copy JSON to clipboard", "Export as PNG", "Export as SVG"]);
		expect(menu("file")).toEqual(["Export to Google Sheets", "Export Excel workbook (.xlsx)", "Export JSON"]);
		expect(EXPORTERS.png.frameLabel("Checkout")).toBe("Export frame “Checkout” as PNG");
	});

	it("declares the hosts each export connects to", () => {
		for (const [kind, ex] of exporterRows()) {
			for (const need of ex.needs ?? []) expect(need, kind).toMatch(/^net:[a-z0-9.-]+$/);
		}
		expect(EXPORTERS.gsheet.needs).toContain("net:sheets.googleapis.com");
		expect("needs" in EXPORTERS.xlsx).toBe(false);
	});
});
