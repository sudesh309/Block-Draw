import type { JsonExportFormat } from "../export/json";

export type SheetsMethod = "apps-script" | "oauth";

export interface SheetsSettings {
	method: SheetsMethod;
	appsScriptUrl: string;
	appsScriptSecret: string;
	oauthClientId: string;
	oauthClientSecret: string;
	/** Canvas units per spreadsheet cell. */
	cellSize: number;
	/** Pixel size of each spreadsheet cell. */
	cellPixels: number;
	includeIndex: boolean;
	includeDataSheets: boolean;
	includeUnframed: boolean;
	/** Re-exporting a drawing updates the spreadsheet it was exported to before. */
	updateExisting: boolean;
	openAfterExport: boolean;
}

export interface BlockDrawSettings {
	/** Folder for new drawings; empty = Obsidian's "default location for new notes". */
	newFileFolder: string;
	newFilePrefix: string;
	gridSize: number;
	snapToGrid: boolean;
	showGrid: boolean;
	/** Folder for exported files; empty = next to the drawing. */
	exportFolder: string;
	jsonFormat: JsonExportFormat;
	/** Download Inter, Roboto, Open Sans, Montserrat and Lato from Google Fonts. Off by default: nothing is requested. */
	webFonts: boolean;
	sheets: SheetsSettings;
}

export const DEFAULT_SETTINGS: BlockDrawSettings = {
	newFileFolder: "",
	newFilePrefix: "Drawing",
	gridSize: 20,
	snapToGrid: true,
	showGrid: true,
	exportFolder: "",
	jsonFormat: "structured",
	webFonts: false,
	sheets: {
		method: "apps-script",
		appsScriptUrl: "",
		appsScriptSecret: "",
		oauthClientId: "",
		oauthClientSecret: "",
		cellSize: 20,
		cellPixels: 20,
		includeIndex: true,
		includeDataSheets: true,
		includeUnframed: true,
		updateExisting: true,
		openAfterExport: true,
	},
};

export function mergeSettings(saved: unknown): BlockDrawSettings {
	const s = (saved && typeof saved === "object" ? saved : {}) as Partial<BlockDrawSettings>;
	return {
		...DEFAULT_SETTINGS,
		...s,
		// Only a literal `true` may switch on anything that contacts a server.
		webFonts: s.webFonts === true,
		sheets: { ...DEFAULT_SETTINGS.sheets, ...(s.sheets ?? {}) },
	};
}
