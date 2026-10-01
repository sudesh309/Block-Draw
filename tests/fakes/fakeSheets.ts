import { validate } from "./sheetsSchema";

/**
 * In-memory stand-in for the Google Sheets API. Every request is schema-validated and the
 * semantic rules the real API enforces (and that matter for us) are checked. Batches are
 * atomic, like the real batchUpdate.
 */

export interface FakeSheet {
	sheetId: number;
	title: string;
	index: number;
	rowCount: number;
	columnCount: number;
	frozenRowCount: number;
	hideGridlines: boolean;
	merges: { r0: number; r1: number; c0: number; c1: number }[];
	cells: Map<string, Record<string, unknown>>;
	filter: boolean;
	borders: number;
}

export interface FakeSpreadsheet {
	spreadsheetId: string;
	title: string;
	sheets: FakeSheet[];
}

type GridRange = { sheetId: number; startRowIndex: number; endRowIndex: number; startColumnIndex: number; endColumnIndex: number };

export class FakeSheetsService {
	spreadsheets = new Map<string, FakeSpreadsheet>();
	calls: { method: string; count?: number }[] = [];
	private seq = 0;

	create(body: { properties?: { title?: string } }): FakeSpreadsheet {
		const errors = validate(body, "Spreadsheet");
		if (errors.length) throw new Error(`Invalid create body: ${errors.join("; ")}`);
		this.calls.push({ method: "create" });
		const id = `sheet-${++this.seq}`;
		const ss: FakeSpreadsheet = {
			spreadsheetId: id,
			title: body.properties?.title ?? "Untitled spreadsheet",
			sheets: [this.newSheet(0, "Sheet1", 0)],
		};
		this.spreadsheets.set(id, ss);
		return ss;
	}

	get(id: string): FakeSpreadsheet {
		this.calls.push({ method: "get" });
		const ss = this.spreadsheets.get(id);
		if (!ss) throw new Error("Requested entity was not found.");
		return ss;
	}

	toJson(ss: FakeSpreadsheet) {
		return {
			spreadsheetId: ss.spreadsheetId,
			spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${ss.spreadsheetId}/edit`,
			sheets: [...ss.sheets].sort((a, b) => a.index - b.index).map((s) => ({ properties: { sheetId: s.sheetId, title: s.title } })),
		};
	}

	private newSheet(sheetId: number, title: string, index: number): FakeSheet {
		return {
			sheetId,
			title,
			index,
			rowCount: 1000,
			columnCount: 26,
			frozenRowCount: 0,
			hideGridlines: false,
			merges: [],
			cells: new Map(),
			filter: false,
			borders: 0,
		};
	}

	batchUpdate(id: string, body: { requests: Record<string, unknown>[] }): void {
		const errors = validate(body, "BatchUpdateSpreadsheetRequest");
		if (errors.length) throw new Error(`Invalid batchUpdate: ${errors.slice(0, 5).join("; ")}`);
		this.calls.push({ method: "batchUpdate", count: body.requests.length });
		const ss = this.get(id);
		this.calls.pop();
		// atomic: work on a deep copy
		const work: FakeSpreadsheet = {
			...ss,
			sheets: ss.sheets.map((s) => ({ ...s, merges: [...s.merges], cells: new Map(s.cells) })),
		};
		body.requests.forEach((req, i) => {
			const kinds = Object.keys(req);
			if (kinds.length !== 1) throw new Error(`Request ${i} must have exactly one kind`);
			this.apply(work, kinds[0], (req as Record<string, Record<string, unknown>>)[kinds[0]], i);
		});
		this.spreadsheets.set(id, work);
	}

	private sheet(ss: FakeSpreadsheet, sheetId: number, i: number): FakeSheet {
		const s = ss.sheets.find((x) => x.sheetId === sheetId);
		if (!s) throw new Error(`Request ${i}: no sheet with id ${sheetId}`);
		return s;
	}

	private inGrid(s: FakeSheet, r: GridRange, i: number): void {
		if (r.startRowIndex < 0 || r.startColumnIndex < 0 || r.endRowIndex > s.rowCount || r.endColumnIndex > s.columnCount) {
			throw new Error(`Request ${i}: range outside grid of "${s.title}" (${JSON.stringify(r)} vs ${s.rowCount}x${s.columnCount})`);
		}
		if (r.endRowIndex <= r.startRowIndex || r.endColumnIndex <= r.startColumnIndex) throw new Error(`Request ${i}: empty range`);
	}

	private apply(ss: FakeSpreadsheet, kind: string, r: Record<string, unknown>, i: number): void {
		switch (kind) {
			case "addSheet": {
				const p = r.properties as {
					sheetId: number;
					title: string;
					index?: number;
					gridProperties?: { rowCount?: number; columnCount?: number; frozenRowCount?: number; hideGridlines?: boolean };
				};
				if (ss.sheets.some((s) => s.sheetId === p.sheetId)) throw new Error(`Request ${i}: duplicate sheetId ${p.sheetId}`);
				if (ss.sheets.some((s) => s.title.toLowerCase() === p.title.toLowerCase())) {
					throw new Error(`Request ${i}: A sheet with the name "${p.title}" already exists.`);
				}
				if (!p.title || p.title.length > 100) throw new Error(`Request ${i}: invalid sheet title`);
				const index = Math.min(p.index ?? ss.sheets.length, ss.sheets.length);
				for (const s of ss.sheets) if (s.index >= index) s.index++;
				const sheet = this.newSheet(p.sheetId, p.title, index);
				sheet.rowCount = p.gridProperties?.rowCount ?? 1000;
				sheet.columnCount = p.gridProperties?.columnCount ?? 26;
				sheet.frozenRowCount = p.gridProperties?.frozenRowCount ?? 0;
				sheet.hideGridlines = p.gridProperties?.hideGridlines ?? false;
				ss.sheets.push(sheet);
				return;
			}
			case "deleteSheet": {
				const s = this.sheet(ss, r.sheetId as number, i);
				if (ss.sheets.length === 1) throw new Error(`Request ${i}: You can't remove all the sheets in a document.`);
				ss.sheets = ss.sheets.filter((x) => x !== s);
				for (const x of ss.sheets) if (x.index > s.index) x.index--;
				return;
			}
			case "updateDimensionProperties": {
				const range = r.range as { sheetId: number; dimension: string; startIndex: number; endIndex: number };
				const s = this.sheet(ss, range.sheetId, i);
				const max = range.dimension === "ROWS" ? s.rowCount : s.columnCount;
				if (range.startIndex < 0 || range.endIndex > max || range.endIndex <= range.startIndex) {
					throw new Error(`Request ${i}: dimension range out of bounds`);
				}
				const px = (r.properties as { pixelSize: number }).pixelSize;
				if (!(px > 0)) throw new Error(`Request ${i}: invalid pixelSize`);
				return;
			}
			case "updateCells": {
				const start = r.start as { sheetId: number; rowIndex: number; columnIndex: number };
				const s = this.sheet(ss, start.sheetId, i);
				const rows = (r.rows as { values?: Record<string, unknown>[] }[]) ?? [];
				if (start.rowIndex + rows.length > s.rowCount) throw new Error(`Request ${i}: rows exceed grid`);
				rows.forEach((row, ri) => {
					const values = row.values ?? [];
					if (start.columnIndex + values.length > s.columnCount) throw new Error(`Request ${i}: columns exceed grid`);
					values.forEach((cell, ci) => {
						const uev = cell.userEnteredValue as { stringValue?: string } | undefined;
						const runs = cell.textFormatRuns as { startIndex: number; format: { link?: { uri: string } } }[] | undefined;
						if (runs) {
							const text = uev?.stringValue;
							if (typeof text !== "string") throw new Error(`Request ${i}: textFormatRuns on a non-string cell`);
							let prev = -1;
							for (const run of runs) {
								if (run.startIndex <= prev || run.startIndex >= text.length) throw new Error(`Request ${i}: bad run start ${run.startIndex}`);
								prev = run.startIndex;
								const uri = run.format.link?.uri;
								if (uri?.startsWith("#gid=")) {
									const gid = Number(uri.slice(5));
									if (!ss.sheets.some((x) => x.sheetId === gid)) throw new Error(`Request ${i}: link to unknown sheet ${gid}`);
								}
							}
						}
						const key = `${start.rowIndex + ri}:${start.columnIndex + ci}`;
						if (Object.keys(cell).length) s.cells.set(key, cell);
						else s.cells.delete(key);
					});
				});
				return;
			}
			case "mergeCells": {
				const range = r.range as GridRange;
				const s = this.sheet(ss, range.sheetId, i);
				this.inGrid(s, range, i);
				const m = { r0: range.startRowIndex, r1: range.endRowIndex, c0: range.startColumnIndex, c1: range.endColumnIndex };
				for (const o of s.merges) {
					if (m.r0 < o.r1 && o.r0 < m.r1 && m.c0 < o.c1 && o.c0 < m.c1) {
						throw new Error(`Request ${i}: You can't merge cells that intersect existing merges ("${s.title}")`);
					}
				}
				if (s.frozenRowCount > m.r0 && s.frozenRowCount < m.r1) throw new Error(`Request ${i}: merge crosses frozen rows`);
				s.merges.push(m);
				return;
			}
			case "updateBorders": {
				const range = r.range as GridRange;
				const s = this.sheet(ss, range.sheetId, i);
				this.inGrid(s, range, i);
				s.borders++;
				return;
			}
			case "setBasicFilter": {
				const range = (r.filter as { range: GridRange }).range;
				const s = this.sheet(ss, range.sheetId, i);
				this.inGrid(s, range, i);
				s.filter = true;
				return;
			}
			case "updateSpreadsheetProperties":
				ss.title = (r.properties as { title: string }).title;
				return;
			default:
				throw new Error(`Request ${i}: unsupported request kind ${kind}`);
		}
	}
}
