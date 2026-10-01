import { TitleAllocator, type WorkbookModel } from "../workbook/model";
import { assignSheetIds, buildSheetsRequests, chunkRequests, type SheetsRequest } from "./requests";
import { SheetsError, type SheetsTransport, type SpreadsheetInfo } from "./transport";

export interface GoogleSheetTarget {
	spreadsheetId: string;
	/** Sheets created by previous exports; only these are replaced on re-export. */
	sheetIds?: number[];
}

export interface GoogleSheetResult {
	spreadsheetId: string;
	url: string;
	created: boolean;
	sheetIds: number[];
}

/**
 * Writes a workbook to Google Sheets: creates a new spreadsheet, or updates one exported
 * before (replacing the sheets this plugin created and leaving any others untouched).
 */
export async function exportWorkbookToGoogleSheets(
	model: WorkbookModel,
	transport: SheetsTransport,
	opts: { target?: GoogleSheetTarget | null; onProgress?: (message: string) => void } = {},
): Promise<GoogleSheetResult> {
	const progress = opts.onProgress ?? (() => undefined);
	let info: SpreadsheetInfo | null = null;
	let created = false;
	if (opts.target?.spreadsheetId) {
		progress("Opening the existing spreadsheet…");
		try {
			info = await transport.get(opts.target.spreadsheetId);
		} catch (e) {
			if (!(e instanceof SheetsError && e.notFound)) throw e;
			info = null;
		}
	}
	if (!info) {
		progress("Creating a new spreadsheet…");
		info = await transport.create(model.title);
		created = true;
	}

	// On a fresh spreadsheet everything is ours to replace (the default "Sheet1").
	const managed = new Set(created ? info.sheets.map((s) => s.sheetId) : (opts.target?.sheetIds ?? []));
	const keep = info.sheets.filter((s) => !managed.has(s.sheetId));
	const remove = info.sheets.filter((s) => managed.has(s.sheetId));

	// Our titles must not clash with sheets the user added to the spreadsheet themselves.
	const titles = new TitleAllocator();
	for (const s of keep) titles.take(s.title, s.title);
	const sheets = model.sheets.map((s) => ({ ...s, title: titles.take(s.title, s.title) }));
	const finalModel: WorkbookModel = { ...model, sheets };

	const sheetIds = assignSheetIds(finalModel, keep.map((s) => s.sheetId));
	const reserved = new Set([...info.sheets.map((s) => s.sheetId), ...sheetIds.values()]);
	let tmpId = 1 + Math.floor(Math.random() * 1_000_000_000);
	while (reserved.has(tmpId)) tmpId++;

	// Phase 1: a temporary sheet keeps the spreadsheet non-empty while old sheets go away.
	progress("Clearing the previous export…");
	const phase1: SheetsRequest[] = [
		{ addSheet: { properties: { sheetId: tmpId, title: `Block Draw ${tmpId}`, index: 0 } } },
		...remove.map((s) => ({ deleteSheet: { sheetId: s.sheetId } })),
	];
	await transport.batchUpdate(info.spreadsheetId, phase1);

	// Phase 2: add and fill our sheets (in front of any sheets the user added), then drop the
	// temporary one. The spreadsheet title is only set on creation so a rename in Drive sticks.
	const requests: SheetsRequest[] = [...buildSheetsRequests(finalModel, sheetIds, 0), { deleteSheet: { sheetId: tmpId } }];
	const batches = chunkRequests(requests);
	for (let i = 0; i < batches.length; i++) {
		progress(batches.length > 1 ? `Writing sheets (${i + 1}/${batches.length})…` : "Writing sheets…");
		await transport.batchUpdate(info.spreadsheetId, batches[i]);
	}

	const first = sheetIds.get(finalModel.sheets[0]?.key ?? "");
	const base = info.spreadsheetUrl.replace(/#.*$/, "");
	return {
		spreadsheetId: info.spreadsheetId,
		url: first !== undefined ? `${base}#gid=${first}` : base,
		created,
		sheetIds: [...sheetIds.values()],
	};
}
