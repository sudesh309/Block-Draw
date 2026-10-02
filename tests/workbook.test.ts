import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";
import { buildWorkbook, ORIGIN_COL, ORIGIN_ROW, SHEET_KEYS } from "../src/export/workbook/layout";
import { cellKey, sanitizeSheetTitle, TitleAllocator, columnLetter, type SheetModel } from "../src/export/workbook/model";
import { writeXlsx } from "../src/export/workbook/xlsx";
import { useEstimatedTextMeasure } from "../src/render/text";
import { sampleDrawing } from "./fixtures/sample";

beforeAll(() => useEstimatedTextMeasure());

const NOW = new Date("2026-10-01T12:00:00Z");

function build(extra = {}) {
	return buildWorkbook(sampleDrawing(), {
		title: "Checkout",
		resolveNoteUrl: (t) => `obsidian://open?vault=Vault&file=${encodeURIComponent(t)}`,
		...extra,
	});
}

const sheetByKey = (wb: ReturnType<typeof build>, key: string) => wb.sheets.find((s) => s.key === key) as SheetModel;

describe("sheet titles", () => {
	it("sanitizes and de-duplicates", () => {
		expect(sanitizeSheetTitle("a/b:c*d?[e]", "x")).toBe("a b c d e");
		expect(sanitizeSheetTitle("   ", "Frame 3")).toBe("Frame 3");
		expect(sanitizeSheetTitle("x".repeat(40), "f")).toHaveLength(31);
		expect(sanitizeSheetTitle("'quoted'", "f")).toBe("quoted");
		const t = new TitleAllocator();
		expect(t.take("Index", "a")).toBe("Index");
		expect(t.take("index", "a")).toBe("index (2)");
		expect(t.take("y".repeat(31), "a")).toHaveLength(31);
		expect(t.take("y".repeat(31), "a")).toBe("y".repeat(27) + " (2)");
	});

	it("names columns like spreadsheets do", () => {
		expect(columnLetter(0)).toBe("A");
		expect(columnLetter(25)).toBe("Z");
		expect(columnLetter(26)).toBe("AA");
		expect(columnLetter(701)).toBe("ZZ");
		expect(columnLetter(702)).toBe("AAA");
	});
});

describe("workbook layout", () => {
	it("creates index, one sheet per frame, an unframed sheet and data sheets", () => {
		const wb = build();
		expect(wb.sheets.map((s) => s.title)).toEqual(["Index", "Checkout flow", "Payment details", "Unframed", "Blocks", "Connections"]);
		expect(wb.sheets.map((s) => s.key)).toEqual(["index", "frame:f1", "frame:f2", "unframed", "blocks", "connections"]);
	});

	it("respects the include options", () => {
		const wb = build({ includeIndex: false, includeDataSheets: false, includeUnframed: false });
		expect(wb.sheets.map((s) => s.title)).toEqual(["Checkout flow", "Payment details"]);
	});

	it("draws blocks as merged, filled, outlined cells", () => {
		const s = sheetByKey(build(), "frame:f1");
		// "Cart" at (40,60) 160x80 → grid (2,3) .. (10,7) with 20px cells
		const cart = s.cells.get(cellKey(ORIGIN_ROW + 3, ORIGIN_COL + 2));
		expect(cart?.value).toBe("Cart");
		expect(cart?.style?.bg).toBe("#a5d8ff");
		expect(s.merges).toContainEqual({ row: ORIGIN_ROW + 3, col: ORIGIN_COL + 2, rows: 4, cols: 8 });
		expect(s.outlines).toContainEqual({
			range: { row: ORIGIN_ROW + 3, col: ORIGIN_COL + 2, rows: 4, cols: 8 },
			line: { style: "medium", color: "#1e1e1e" },
		});
		expect(s.hideGridlines).toBe(true);
		expect(s.defaultColWidth).toBe(20);
	});

	it("gives linked blocks a link cell that points at the frame's sheet", () => {
		const s = sheetByKey(build(), "frame:f1");
		const find = (text: string) => [...s.cells.entries()].find(([, c]) => c.value === text);
		const [mainKey, main] = find("Service · Java\nPayment\nCard, wallet or invoice") ?? [];
		expect(main?.link).toBeUndefined();
		expect(main?.runs?.[1]).toMatchObject({ start: "Service · Java\n".length, bold: true }); // the title, below the tag
		expect(main?.note).toContain("→ Card form [Payment details] (submit)");
		const [linkKey, link] = find("→ Payment details") ?? [];
		expect(link?.link).toEqual({ type: "sheet", sheetKey: "frame:f2" });
		// the link cell is the block's last row, inside the same outline
		const [mr, mc] = (mainKey as string).split(":").map(Number);
		const [lr, lc] = (linkKey as string).split(":").map(Number);
		expect([lr, lc]).toEqual([mr + 3, mc]);
		expect(s.merges).toContainEqual({ row: mr, col: mc, rows: 3, cols: 8 });
		expect(s.merges).toContainEqual({ row: lr, col: lc, rows: 1, cols: 8 });
		expect(s.outlines.some((o) => o.range.row === mr && o.range.rows === 4)).toBe(true);
	});

	it("turns note links into URLs through the resolver", () => {
		const s = sheetByKey(build(), "unframed");
		const link = [...s.cells.values()].find((c) => c.value === "→ Checkout");
		expect(link?.link).toEqual({ type: "url", url: "obsidian://open?vault=Vault&file=Specs%2FCheckout" });
	});

	it("keeps small linked blocks in a single linked cell", () => {
		const d = sampleDrawing();
		const pay = d.elements.find((e) => e.id === "pay") as { height: number };
		pay.height = 20;
		const s = buildWorkbook(d, { title: "x" }).sheets.find((x) => x.key === "frame:f1") as SheetModel;
		const cell = [...s.cells.values()].find((c) => typeof c.value === "string" && c.value.includes("\nPayment\n"));
		expect(cell?.link).toEqual({ type: "sheet", sheetKey: "frame:f2" });
		expect(cell?.value).toContain("→ Payment details");
	});

	it("routes connectors along cell borders with arrowheads and labels", () => {
		const s = sheetByKey(build(), "frame:f1");
		const values = [...s.cells.values()].map((c) => c.value);
		expect(values).toContain("yes");
		expect(values).toContain("no");
		expect(values.filter((v) => v === "►" || v === "▼" || v === "▲" || v === "◄").length).toBe(4);
		const bordered = [...s.cells.values()].filter((c) => c.style?.borders && !c.value);
		expect(bordered.length).toBeGreaterThan(10);
		// no merge overlaps another
		const occupied = new Set<string>();
		for (const m of s.merges) {
			for (let r = m.row; r < m.row + m.rows; r++) {
				for (let c = m.col; c < m.col + m.cols; c++) {
					const k = cellKey(r, c);
					expect(occupied.has(k)).toBe(false);
					occupied.add(k);
				}
			}
		}
	});

	it("keeps all content inside the sheet grid", () => {
		for (const s of build().sheets) {
			for (const key of s.cells.keys()) {
				const [r, c] = key.split(":").map(Number);
				expect(r).toBeLessThan(s.rowCount);
				expect(c).toBeLessThan(s.colCount);
			}
			for (const m of s.merges) {
				expect(m.row + m.rows).toBeLessThanOrEqual(s.rowCount);
				expect(m.col + m.cols).toBeLessThanOrEqual(s.colCount);
			}
		}
	});

	it("lists frames with links on the index sheet", () => {
		const s = sheetByKey(build(), SHEET_KEYS.index);
		const frameCell = s.cells.get(cellKey(1, 1));
		expect(frameCell).toMatchObject({ value: "Checkout flow", link: { type: "sheet", sheetKey: "frame:f1" } });
		expect(s.cells.get(cellKey(1, 4))?.value).toBe("Payment details");
		expect(s.cells.get(cellKey(2, 4))?.value).toBe("Checkout flow");
	});

	it("tabulates blocks and connections, without any internal element id", () => {
		const wb = build();
		const blocks = sheetByKey(wb, SHEET_KEYS.blocks);
		expect(blocks.filter).toEqual({ row: 0, col: 0, rows: 9, cols: 9 });
		expect(blocks.cells.get(cellKey(1, 1))?.value).toBe("Cart");
		expect(blocks.cells.get(cellKey(1, 8))?.value).toBe("Confirm totals before moving on");
		const blockHeaders = Array.from({ length: 9 }, (_, i) => blocks.cells.get(cellKey(0, i))?.value);
		expect(blockHeaders).toEqual(["Frame", "Block", "Tag", "Description", "Shape", "Links to", "Outgoing", "Incoming", "Comment"]);
		expect([...blocks.cells.values()].some((c) => c.value === "cart")).toBe(false);
		const conns = sheetByKey(wb, SHEET_KEYS.connections);
		expect(conns.filter).toEqual({ row: 0, col: 0, rows: 8, cols: 6 });
		expect(conns.cells.get(cellKey(2, 2))?.value).toBe("yes");
		expect(conns.cells.get(cellKey(2, 5))?.value).toBe("Requires 3-D Secure");
		const connHeaders = Array.from({ length: 6 }, (_, i) => conns.cells.get(cellKey(0, i))?.value);
		expect(connHeaders).toEqual(["From frame", "From", "Label", "To", "To frame", "Comment"]);
	});

	it("gives each frame a textual block table beside its grid", () => {
		const s = sheetByKey(build(), "frame:f1");
		const [key] = [...s.cells].find(([, c]) => c.value === "Block Title") ?? [];
		const [headerRow, startCol] = (key as string).split(":").map(Number);
		expect(headerRow).toBe(0);
		const headers = Array.from({ length: 6 }, (_, i) => s.cells.get(cellKey(0, startCol + i))?.value);
		expect(headers).toEqual(["Block Title", "Tag", "LinkTo", "LinkFrom", "Block Description", "Notes"]);
		const rowOf = (title: string) =>
			[...s.cells].find(([k, c]) => c.value === title && Number(k.split(":")[1]) === startCol)?.[0].split(":").map(Number)[0];
		const cartRow = rowOf("Cart") as number;
		const cols = (row: number, i: number) => s.cells.get(cellKey(row, startCol + i))?.value;
		expect(cols(cartRow, 1)).toBe(""); // Tag (Cart has none)
		expect(cols(cartRow, 2)).toContain("Logged in?"); // LinkTo: Cart's outgoing connection
		expect(cols(cartRow, 4)).toBe(""); // Block Description (Cart has none)
		expect(cols(cartRow, 5)).toBe("Confirm totals before moving on"); // Notes
		const payRow = rowOf("Payment") as number;
		expect(cols(payRow, 1)).toBe("Service · Java"); // Tag
		expect(cols(payRow, 3)).toContain("Logged in?"); // LinkFrom
		expect(cols(payRow, 4)).toBe("Card, wallet or invoice");
	});

	it("surfaces comments as cell notes on the frame grid", () => {
		const s = sheetByKey(build(), "frame:f1");
		const cart = s.cells.get(cellKey(ORIGIN_ROW + 3, ORIGIN_COL + 2));
		expect(cart?.note).toContain("Comment: Confirm totals before moving on");
		// a note on a block that already had one (from its outgoing connection) keeps both.
		expect(cart?.note).toContain("Outgoing:");
		const label = [...s.cells.values()].find((c) => c.value === "yes");
		expect(label?.note).toBe("Comment: Requires 3-D Secure");
	});

	describe("content that is not about the diagram", () => {
		const drawingName = "My Private Drawing 2026-10-02";
		const allText = (extra = {}) => {
			const wb = build({ title: drawingName, ...extra });
			return wb.sheets.flatMap((sheet) => [sheet.title, ...[...sheet.cells.values()].map((c) => String(c.value ?? ""))]);
		};

		it("leaves colors, sizes and line styles out of the tables", () => {
			const wb = build();
			for (const key of [SHEET_KEYS.blocks, SHEET_KEYS.connections]) {
				const values = [...sheetByKey(wb, key).cells.values()].map((c) => String(c.value ?? ""));
				expect(values.filter((v) => /^#[0-9a-f]{6}$/i.test(v)), `${key}: color codes`).toEqual([]);
				expect(values.filter((v) => /^\d+×\d+$/.test(v)), `${key}: sizes`).toEqual([]);
				expect(values.filter((v) => ["Fill", "Size", "Line", "none", "elbow", "curved", "straight"].includes(v)), `${key}: style columns`).toEqual([]);
			}
		});

		it("never prints the drawing's name or the export date inside a sheet", () => {
			const text = allText();
			expect(text.filter((t) => t.includes(drawingName))).toEqual([]);
			expect(text.filter((t) => /Exported from|Obsidian \(Block Draw\)/.test(t))).toEqual([]);
			expect(text.filter((t) => /\b20\d\d-\d\d-\d\d\b/.test(t))).toEqual([]);
		});

		it("calls the blocks outside every frame 'Unframed', never 'Canvas'", () => {
			const wb = build();
			expect(wb.sheets.map((x) => x.title)).not.toContain("Canvas");
			expect(allText().filter((t) => /canvas/i.test(t))).toEqual([]);
			const blocks = sheetByKey(wb, SHEET_KEYS.blocks);
			const spec = [...blocks.cells].find(([, c]) => c.value === "Spec")?.[0].split(":").map(Number)[0] as number;
			expect(blocks.cells.get(cellKey(spec, 0))?.value).toBe("Unframed");
		});

		it("starts the index with its table", () => {
			const index = sheetByKey(build(), SHEET_KEYS.index);
			expect(Array.from({ length: 6 }, (_, i) => index.cells.get(cellKey(0, i))?.value)).toEqual([
				"#",
				"Frame",
				"Blocks",
				"Connections",
				"Links to",
				"Description",
			]);
			expect(index.frozenRows).toBe(1);
			expect(index.merges).toEqual([]);
		});
	});

	describe("tags", () => {
		it("are in the blocks table, next to the block", () => {
			const blocks = sheetByKey(build(), SHEET_KEYS.blocks);
			const rowOf = (title: string) =>
				[...blocks.cells].find(([k, c]) => c.value === title && Number(k.split(":")[1]) === 1)?.[0].split(":").map(Number)[0] as number;
			expect(blocks.cells.get(cellKey(rowOf("Payment"), 2))?.value).toBe("Service · Java");
			expect(blocks.cells.get(cellKey(rowOf("Orders DB"), 2))?.value).toBe("PostgreSQL");
			expect(blocks.cells.get(cellKey(rowOf("Cart"), 2))?.value).toBe("");
		});

		it("are drawn above the title in the block's cell on the frame sheet", () => {
			const s = sheetByKey(build(), "frame:f1");
			const cell = [...s.cells.values()].find((c) => String(c.value).includes("\nPayment\n") && c.style?.bg);
			expect(String(cell?.value).startsWith("Service · Java\nPayment")).toBe(true);
			// the tag run is smaller and italic, the title keeps its own run
			const [tag, title] = cell?.runs ?? [];
			expect(tag).toMatchObject({ start: 0, italic: true });
			expect(title?.start).toBe("Service · Java\n".length);
			expect((tag?.fontSize ?? 99) <= (title?.fontSize ?? 0)).toBe(true);
			// blocks without a tag start with their title
			const cart = [...s.cells.values()].find((c) => String(c.value).startsWith("Cart") && c.style?.bg);
			expect(String(cart?.value)).toBe("Cart");
		});
	});

	it("scales huge frames down to a bounded grid", () => {
		const d = sampleDrawing();
		const f = d.elements[0] as { width: number };
		f.width = 20000;
		const s = buildWorkbook(d, { title: "x" }).sheets.find((x) => x.key === "frame:f1") as SheetModel;
		expect(s.colCount).toBeLessThan(200);
	});

	it("handles an empty drawing", () => {
		const wb = buildWorkbook({ type: "block-draw", version: 1, elements: [] }, { title: "Empty", includeIndex: false, includeDataSheets: false });
		expect(wb.sheets).toHaveLength(1);
	});
});

describe("xlsx writer", () => {
	it("writes a valid package with sheets, styles, links and comments", () => {
		const wb = build();
		const bytes = writeXlsx(wb, { now: NOW });
		const files = unzipSync(bytes);
		const names = Object.keys(files).sort();
		expect(names).toContain("[Content_Types].xml");
		expect(names).toContain("xl/workbook.xml");
		expect(names).toContain("xl/worksheets/sheet2.xml");
		expect(names).toContain("xl/comments2.xml");
		const workbook = strFromU8(files["xl/workbook.xml"]);
		expect(workbook).toContain('<sheet name="Checkout flow" sheetId="2" r:id="rId2"/>');
		const sheet2 = strFromU8(files["xl/worksheets/sheet2.xml"]);
		expect(sheet2).toContain("<mergeCells");
		expect(sheet2).toContain(`location="'Payment details'!A1"`);
		expect(sheet2).toContain('showGridLines="0"');
		const canvasRels = strFromU8(files["xl/worksheets/_rels/sheet4.xml.rels"]);
		expect(canvasRels).toContain('Target="obsidian://open?vault=Vault&amp;file=Specs%2FCheckout"');
		// every XML part is well-formed enough to have a single root and no raw ampersands
		for (const [name, data] of Object.entries(files)) {
			const text = strFromU8(data);
			expect(text.includes("& ") || /&(?!amp;|lt;|gt;|quot;|apos;)/.test(text), name).toBe(false);
		}
		if (process.env.BD_WRITE_SAMPLES) {
			const out = join(__dirname, "output");
			mkdirSync(out, { recursive: true });
			writeFileSync(join(out, "sample.xlsx"), bytes);
		}
	});
});
