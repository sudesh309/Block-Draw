import type { JsonExportFormat } from "../export/json";
import { settingDefaults, type SettingDef } from "../kernel/settings";

export type SheetsMethod = "apps-script" | "oauth";

/** "auto" is on for phones and tablets, off on computers. */
export type TabletMode = "auto" | "on" | "off";

export interface SheetsSettings {
	method: SheetsMethod;
	appsScriptUrl: string;
	/** Kept in the device's secret store, not in data.json. */
	appsScriptSecret: string;
	oauthClientId: string;
	/** Kept in the device's secret store, not in data.json. */
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
	/** Touch and pen behavior for drawing on a tablet or phone. */
	tabletMode: TabletMode;
	sheets: SheetsSettings;
}

/** Dotted path of every setting, e.g. "sheets.cellSize". */
type Leaves<T, P extends string = ""> = {
	[K in keyof T & string]: T[K] extends object ? Leaves<T[K], `${P}${K}.`> : `${P}${K}`;
}[keyof T & string];

export type SettingKey = Leaves<BlockDrawSettings>;

/**
 * The SETTINGS table: one row per setting. Defaults, validation, what is saved in data.json (only
 * values that differ from the default, never secrets) and the controls in the settings tab all come
 * from these rows (kernel/settings.ts). Where a row appears in the tab is up to SettingTab.ts.
 */
export const SETTINGS: readonly (SettingDef & { key: SettingKey })[] = [
	{
		key: "newFileFolder",
		type: "folder",
		name: "Folder for new drawings",
		desc: "Leave empty to use the default location for new notes.",
		default: "",
		placeholder: "Drawings",
	},
	{
		key: "newFilePrefix",
		type: "text",
		name: "File name prefix",
		desc: "New drawings are named with this prefix followed by the date and time.",
		default: "Drawing",
		emptyAs: "Drawing",
	},
	{
		key: "gridSize",
		type: "slider",
		name: "Grid size",
		desc: "Spacing of the background grid and of snapping, in pixels at 100% zoom.",
		default: 20,
		min: 5,
		max: 50,
		step: 5,
	},
	{ key: "snapToGrid", type: "toggle", name: "Snap to grid", default: true },
	{ key: "showGrid", type: "toggle", name: "Show grid", default: true },
	{
		key: "webFonts",
		type: "toggle",
		name: "Load web fonts from Google Fonts",
		desc: "Off: Block Draw never contacts Google for fonts, and uses the fonts installed on your device. On: Inter, Roboto, Open Sans, Montserrat and Lato are downloaded so they show everywhere, and exported SVG files load them too (PNG images always use installed fonts).",
		default: false,
		needs: ["net:fonts.googleapis.com", "net:fonts.gstatic.com"],
	},
	{
		key: "tabletMode",
		type: "choice",
		name: "Tablet mode",
		desc: "On: moving a finger or pen across a drawing draws, and no longer opens Obsidian's sidebars or pull-down menu. To open a sidebar from a drawing, swipe in from the very edge of the screen. Automatic: on for phones and tablets.",
		default: "auto",
		options: [
			{ value: "auto", label: "Automatic" },
			{ value: "on", label: "On" },
			{ value: "off", label: "Off" },
		],
	},
	{
		key: "exportFolder",
		type: "folder",
		name: "Export folder",
		desc: "Where JSON, Excel, SVG and PNG exports are saved. Leave empty to save next to the drawing.",
		default: "",
		placeholder: "Exports",
	},
	{
		key: "jsonFormat",
		type: "choice",
		name: "JSON format",
		desc: "Structured: frames with their blocks and connections, links resolved. Raw: the drawing file itself.",
		default: "structured",
		options: [
			{ value: "structured", label: "Structured" },
			{ value: "raw", label: "Raw drawing" },
		],
	},
	{
		key: "sheets.method",
		type: "choice",
		name: "Connection method",
		desc: "The Apps Script bridge needs no Google Cloud project and also works on mobile. Signing in with a Google account calls the Google Sheets API directly (desktop only).",
		default: "apps-script",
		options: [
			{ value: "apps-script", label: "Apps Script web app" },
			{ value: "oauth", label: "Google account" },
		],
	},
	{
		key: "sheets.appsScriptSecret",
		type: "secret",
		secretName: "apps-script-secret",
		name: "Apps Script secret",
		desc: "Shared with the bridge code so only this plugin can use your web app.",
		default: "",
	},
	{
		key: "sheets.appsScriptUrl",
		type: "text",
		name: "Web app address",
		desc: "The deployment URL, ending in /exec.",
		default: "",
		placeholder: "https://script.google.com/macros/s/…/exec",
	},
	{ key: "sheets.oauthClientId", type: "text", name: "OAuth client ID", default: "" },
	{ key: "sheets.oauthClientSecret", type: "secret", secretName: "oauth-client-secret", name: "OAuth client secret", default: "" },
	{
		key: "sheets.cellSize",
		type: "slider",
		name: "Cell size",
		desc: "Canvas pixels represented by one spreadsheet cell. Larger values make smaller sheets.",
		default: 20,
		min: 10,
		max: 60,
		step: 5,
	},
	{
		key: "sheets.cellPixels",
		type: "slider",
		name: "Cell width in the sheet",
		desc: "Width and height of each grid cell in the spreadsheet, in pixels.",
		default: 20,
		min: 10,
		max: 40,
		step: 2,
	},
	{ key: "sheets.includeIndex", type: "toggle", name: "Index tab", desc: "A first tab listing every frame with a link to its tab.", default: true },
	{
		key: "sheets.includeDataSheets",
		type: "toggle",
		name: "Block and connection tables",
		desc: "Tabs listing every block and connection as filterable rows.",
		default: true,
	},
	{
		key: "sheets.includeUnframed",
		type: "toggle",
		name: "Blocks outside frames",
		desc: "Put blocks that are not inside a frame on a separate tab named Unframed.",
		default: true,
	},
	{
		key: "sheets.updateExisting",
		type: "toggle",
		name: "Update the same spreadsheet",
		desc: "Exporting a drawing again replaces the tabs it created before instead of making a new spreadsheet. Tabs you added yourself are kept.",
		default: true,
	},
	{
		key: "sheets.openAfterExport",
		type: "toggle",
		name: "Open after export",
		desc: "Open the spreadsheet in your browser when the export finishes.",
		default: true,
	},
];

export const DEFAULT_SETTINGS: BlockDrawSettings = settingDefaults<BlockDrawSettings>(SETTINGS);

export function settingDef(key: SettingKey): SettingDef {
	const def = SETTINGS.find((d) => d.key === key);
	if (!def) throw new Error(`No setting "${key}"`);
	return def;
}

/** Whether tablet mode applies on this device (`isMobile`: a phone or tablet). */
export function tabletModeOn(mode: TabletMode, isMobile: boolean): boolean {
	return mode === "on" || (mode === "auto" && isMobile);
}
