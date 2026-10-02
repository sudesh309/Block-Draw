import { Notice, normalizePath, requestUrl, TFile, type App } from "obsidian";
import { exportWorkbookToGoogleSheets } from "../export/gsheets/exporter";
import {
	AppsScriptTransport,
	RestSheetsTransport,
	type HttpClient,
	type SheetsTransport,
} from "../export/gsheets/transport";
import { exportJsonText } from "../export/json";
import { buildWorkbook } from "../export/workbook/layout";
import { writeXlsx } from "../export/workbook/xlsx";
import { parseLink } from "../model/links";
import { isFrame, type DrawingFile } from "../model/types";
import { LIGHT_THEME } from "../render/colors";
import { sceneToSvg } from "../render/scene";
import type { GoogleAuth } from "./googleAuth";
import type { BlockDrawSettings } from "./settings";

/** Obsidian's requestUrl as a plain HTTP client (no CORS, works on mobile). */
export const obsidianHttp: HttpClient = async (req) => {
	const res = await requestUrl({
		url: req.url,
		method: req.method,
		headers: req.headers,
		contentType: req.contentType,
		body: req.body,
		throw: false,
	});
	let text = "";
	try {
		text = res.text;
	} catch {
		text = "";
	}
	return { status: res.status, text };
};

export interface ExportContext {
	app: App;
	settings: BlockDrawSettings;
	auth: GoogleAuth;
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim() || "Drawing";

/** Path for an exported file: the export folder from settings, or next to the drawing. */
export async function exportPath(ctx: ExportContext, source: TFile, name: string): Promise<string> {
	const folder = ctx.settings.exportFolder.trim() ? normalizePath(ctx.settings.exportFolder.trim()) : (source.parent?.path ?? "");
	if (folder && folder !== "/" && !ctx.app.vault.getAbstractFileByPath(folder)) {
		await ctx.app.vault.createFolder(folder).catch(() => undefined);
	}
	return normalizePath(folder && folder !== "/" ? `${folder}/${name}` : name);
}

async function writeText(app: App, path: string, text: string): Promise<TFile> {
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) {
		await app.vault.modify(existing, text);
		return existing;
	}
	return app.vault.create(path, text);
}

async function writeBinary(app: App, path: string, data: ArrayBuffer): Promise<TFile> {
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) {
		await app.vault.modifyBinary(existing, data);
		return existing;
	}
	return app.vault.createBinary(path, data);
}

const toArrayBuffer = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;

/* ------------------------------------------------------------------ JSON */

export async function exportJsonFile(ctx: ExportContext, source: TFile, drawing: DrawingFile): Promise<TFile> {
	const text = exportJsonText(drawing, ctx.settings.jsonFormat, source.basename);
	const path = await exportPath(ctx, source, `${safeName(source.basename)}.json`);
	const file = await writeText(ctx.app, path, text);
	new Notice(`Exported JSON to ${file.path}`);
	return file;
}

export async function copyJson(ctx: ExportContext, source: TFile, drawing: DrawingFile): Promise<void> {
	await navigator.clipboard.writeText(exportJsonText(drawing, ctx.settings.jsonFormat, source.basename));
	new Notice("Drawing JSON copied to the clipboard.");
}

/* ----------------------------------------------------------- spreadsheets */

function workbookFor(ctx: ExportContext, source: TFile, drawing: DrawingFile) {
	const s = ctx.settings.sheets;
	const vault = ctx.app.vault.getName();
	return buildWorkbook(drawing, {
		title: source.basename,
		cellSize: s.cellSize,
		cellPixels: s.cellPixels,
		includeIndex: s.includeIndex,
		includeDataSheets: s.includeDataSheets,
		includeUnframed: s.includeUnframed,
		resolveNoteUrl: (linktext) => {
			const parsed = parseLink(`[[${linktext}]]`);
			if (!parsed || parsed.kind !== "note") return null;
			const target = ctx.app.metadataCache.getFirstLinkpathDest(parsed.path, source.path);
			const file = target ? target.path : parsed.path;
			return `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(file)}`;
		},
	});
}

export async function exportXlsxFile(ctx: ExportContext, source: TFile, drawing: DrawingFile): Promise<TFile> {
	const bytes = writeXlsx(workbookFor(ctx, source, drawing));
	const path = await exportPath(ctx, source, `${safeName(source.basename)}.xlsx`);
	const file = await writeBinary(ctx.app, path, toArrayBuffer(bytes));
	new Notice(`Exported workbook to ${file.path}`);
	return file;
}

export function sheetsTransport(ctx: ExportContext): SheetsTransport {
	const s = ctx.settings.sheets;
	if (s.method === "oauth") {
		return new RestSheetsTransport(() => ctx.auth.accessToken(), obsidianHttp);
	}
	if (!s.appsScriptUrl.trim()) {
		throw new Error("Set up Google Sheets export first: Settings → Block Draw → Google Sheets.");
	}
	return new AppsScriptTransport(s.appsScriptUrl.trim(), s.appsScriptSecret, obsidianHttp);
}

/**
 * Exports every frame as a tab of one Google Sheets workbook. Returns the export info that
 * the caller stores in the drawing so the next export updates the same spreadsheet.
 */
export async function exportGoogleSheets(
	ctx: ExportContext,
	source: TFile,
	drawing: DrawingFile,
	opts: { forceNew?: boolean } = {},
): Promise<{ spreadsheetId: string; url: string; exportedAt: string; sheetIds: number[] }> {
	const transport = sheetsTransport(ctx);
	const previous = drawing.exports?.googleSheet;
	const target =
		!opts.forceNew && ctx.settings.sheets.updateExisting && previous?.spreadsheetId
			? { spreadsheetId: previous.spreadsheetId, sheetIds: previous.sheetIds ?? [] }
			: null;
	const notice = new Notice("Exporting to Google Sheets…", 0);
	try {
		const result = await exportWorkbookToGoogleSheets(workbookFor(ctx, source, drawing), transport, {
			target,
			onProgress: (m) => notice.setMessage(`Google Sheets: ${m}`),
		});
		notice.hide();
		const frames = drawing.elements.filter(isFrame).length;
		new Notice(
			`${result.created ? "Created" : "Updated"} the Google Sheet for “${source.basename}” (${frames} frame${frames === 1 ? "" : "s"}).`,
		);
		if (ctx.settings.sheets.openAfterExport) window.open(result.url);
		return { spreadsheetId: result.spreadsheetId, url: result.url, exportedAt: new Date().toISOString(), sheetIds: result.sheetIds };
	} catch (e) {
		notice.hide();
		throw e;
	}
}

/* ------------------------------------------------------------- images */

/** `webFonts` makes the SVG load the Google Fonts stylesheet when it is opened, so only pass it for SVG files. */
export function drawingSvg(drawing: DrawingFile, frameId?: string | null, webFonts = false): { svg: string; width: number; height: number } {
	const { svg, width, height } = sceneToSvg(drawing.elements, { theme: LIGHT_THEME, frameId, padding: 32, webFonts });
	return { svg, width, height };
}

export async function exportSvgFile(ctx: ExportContext, source: TFile, drawing: DrawingFile, frameId?: string | null): Promise<TFile> {
	const frame = frameId ? drawing.elements.find((e) => e.id === frameId) : null;
	const suffix = isFrame(frame) ? ` - ${safeName(frame.title)}` : "";
	const path = await exportPath(ctx, source, `${safeName(source.basename)}${suffix}.svg`);
	const file = await writeText(ctx.app, path, drawingSvg(drawing, frameId, ctx.settings.webFonts).svg);
	new Notice(`Exported SVG to ${file.path}`);
	return file;
}

/** Rasterizes the SVG export at 2× for crisp images. */
export async function svgToPng(svg: string, width: number, height: number, scale = 2): Promise<ArrayBuffer> {
	const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	try {
		const img = new Image();
		await new Promise<void>((resolve, reject) => {
			img.onload = () => resolve();
			img.onerror = () => reject(new Error("Could not render the drawing as an image."));
			img.src = url;
		});
		const canvas = createEl("canvas");
		canvas.width = Math.max(1, Math.round(width * scale));
		canvas.height = Math.max(1, Math.round(height * scale));
		const g = canvas.getContext("2d");
		if (!g) throw new Error("Canvas is not available.");
		g.scale(scale, scale);
		g.drawImage(img, 0, 0, width, height);
		const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
		if (!png) throw new Error("PNG encoding failed.");
		return await png.arrayBuffer();
	} finally {
		URL.revokeObjectURL(url);
	}
}

export async function exportPngFile(ctx: ExportContext, source: TFile, drawing: DrawingFile, frameId?: string | null): Promise<TFile> {
	const frame = frameId ? drawing.elements.find((e) => e.id === frameId) : null;
	const suffix = isFrame(frame) ? ` - ${safeName(frame.title)}` : "";
	const { svg, width, height } = drawingSvg(drawing, frameId);
	const png = await svgToPng(svg, width, height);
	const path = await exportPath(ctx, source, `${safeName(source.basename)}${suffix}.png`);
	const file = await writeBinary(ctx.app, path, png);
	new Notice(`Exported PNG to ${file.path}`);
	return file;
}
