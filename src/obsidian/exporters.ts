import type { TFile } from "obsidian";
import type { Capability } from "../kernel/settings";
import { parseDrawing, serializeDrawing } from "../model/file";
import type { DrawingFile } from "../model/types";
import type { BlockDrawView } from "./BlockDrawView";
import { copyJson, exportGoogleSheets, exportJsonFile, exportPngFile, exportSvgFile, exportXlsxFile, type ExportContext } from "./exports";

export interface ExportJob {
	file: TFile;
	drawing: DrawingFile;
	/** The frame to export on its own (exports that can do that), or null for the whole drawing. */
	frameId: string | null;
	/** The drawing's open view, if any: unsaved edits are exported and export info is kept there. */
	view: BlockDrawView | null;
}

/** One row of the EXPORTERS table. */
export interface ExporterDef {
	/** Title in menus. */
	label: string;
	/** Title while one frame is selected, for exports that can export a single frame. */
	frameLabel?: (frameTitle: string) => string;
	/** Lucide icon name. */
	icon: string;
	/** Command palette entry. Never change an id: people bind hotkeys to it. */
	command: { id: string; name: string };
	/** The drawing's export menu ("view") and the file explorer's menu for drawings ("file"). */
	menus: readonly ("view" | "file")[];
	/** Starts a new section in the export menu. */
	separator?: boolean;
	/** Hosts it connects to. Together with the settings' needs they are the network allow-list. */
	needs?: readonly Capability[];
	run(ctx: ExportContext, job: ExportJob): Promise<void>;
}

const GOOGLE_SHEETS_HOSTS: readonly Capability[] = ["net:sheets.googleapis.com", "net:oauth2.googleapis.com", "net:script.google.com"];

async function toGoogleSheets(ctx: ExportContext, { file, drawing, view }: ExportJob, forceNew: boolean): Promise<void> {
	const info = await exportGoogleSheets(ctx, file, drawing, { forceNew });
	// Remember the spreadsheet so the next export updates it in place.
	if (view) {
		view.updateMeta((m) => ({ ...m, exports: { ...m.exports, googleSheet: info } }));
	} else {
		await ctx.app.vault.process(file, (text) => {
			const d = parseDrawing(text);
			return serializeDrawing({ ...d, exports: { ...d.exports, googleSheet: info } });
		});
	}
}

/**
 * The EXPORTERS table: every way a drawing leaves Block Draw. The export menu, the file explorer's
 * menu, the command palette and the network allow-list all come from these rows; their order is
 * the menu order.
 */
export const EXPORTERS = {
	gsheet: {
		label: "Export to Google Sheets",
		icon: "sheet",
		command: { id: "export-google-sheets", name: "Export to Google Sheets" },
		menus: ["view", "file"],
		needs: GOOGLE_SHEETS_HOSTS,
		run: (ctx, job) => toGoogleSheets(ctx, job, false),
	},
	"gsheet-new": {
		label: "Export to a new Google Sheet",
		icon: "sheet",
		command: { id: "export-google-sheets-new", name: "Export to a new Google Sheet" },
		menus: [],
		needs: GOOGLE_SHEETS_HOSTS,
		run: (ctx, job) => toGoogleSheets(ctx, job, true),
	},
	xlsx: {
		label: "Export Excel workbook (.xlsx)",
		icon: "sheet",
		command: { id: "export-xlsx", name: "Export Excel workbook (.xlsx)" },
		menus: ["view", "file"],
		run: async (ctx, { file, drawing }) => {
			await exportXlsxFile(ctx, file, drawing);
		},
	},
	json: {
		label: "Export JSON",
		icon: "braces",
		command: { id: "export-json", name: "Export JSON" },
		menus: ["view", "file"],
		separator: true,
		run: async (ctx, { file, drawing }) => {
			await exportJsonFile(ctx, file, drawing);
		},
	},
	"copy-json": {
		label: "Copy JSON to clipboard",
		icon: "braces",
		command: { id: "copy-json", name: "Copy JSON to clipboard" },
		menus: ["view"],
		run: (ctx, { file, drawing }) => copyJson(ctx, file, drawing),
	},
	png: {
		label: "Export as PNG",
		frameLabel: (title) => `Export frame “${title}” as PNG`,
		icon: "image",
		command: { id: "export-png", name: "Export as PNG (selected frame or whole drawing)" },
		menus: ["view"],
		separator: true,
		run: async (ctx, { file, drawing, frameId }) => {
			await exportPngFile(ctx, file, drawing, frameId);
		},
	},
	svg: {
		label: "Export as SVG",
		frameLabel: (title) => `Export frame “${title}” as SVG`,
		icon: "image",
		command: { id: "export-svg", name: "Export as SVG (selected frame or whole drawing)" },
		menus: ["view"],
		run: async (ctx, { file, drawing, frameId }) => {
			await exportSvgFile(ctx, file, drawing, frameId);
		},
	},
} satisfies Record<string, ExporterDef>;

export type ExportKind = keyof typeof EXPORTERS;

/** The rows in menu order. */
export const exporterRows = (): [ExportKind, ExporterDef][] => Object.entries(EXPORTERS) as [ExportKind, ExporterDef][];
