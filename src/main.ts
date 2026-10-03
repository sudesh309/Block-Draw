import { normalizePath, Notice, Plugin, TFile, TFolder, type Editor as MarkdownEditor } from "obsidian";
import { createEmptyDrawing, parseDrawing, serializeDrawing } from "./model/file";
import { fileStamp } from "./model/ids";
import { DRAWING_THEMES } from "./model/themes";
import { FILE_EXTENSION, type DrawingFile } from "./model/types";
import { BlockDrawView, VIEW_ICON, VIEW_TYPE } from "./obsidian/BlockDrawView";
import { registerEmbeds } from "./obsidian/embed";
import {
	copyJson,
	exportGoogleSheets,
	exportJsonFile,
	exportPngFile,
	exportSvgFile,
	exportXlsxFile,
	type ExportContext,
} from "./obsidian/exports";
import { GoogleAuth } from "./obsidian/googleAuth";
import type { BlockDrawHost, ExportKind } from "./obsidian/plugin";
import { BlockDrawSettingTab } from "./obsidian/SettingTab";
import { loadSettings, settingsToSave, type SecretStore, type StoredSettings } from "./kernel/settings";
import { deviceSecrets, vaultTag } from "./obsidian/secrets";
import { SETTINGS, type BlockDrawSettings } from "./obsidian/settings";
import { WebFontLoader } from "./obsidian/webFonts";

export default class BlockDrawPlugin extends Plugin implements BlockDrawHost {
	settings!: BlockDrawSettings;
	/** What data.json holds besides the settings, and which secrets could not leave it. */
	private stored: StoredSettings = { unknown: {}, inVault: new Set() };
	private secrets!: SecretStore;
	auth!: GoogleAuth;
	webFonts!: WebFontLoader;
	/** Value of the "Load web fonts" setting that was last applied. */
	private webFontsOn = false;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.auth = new GoogleAuth(this.app, () => ({
			clientId: this.settings.sheets.oauthClientId,
			clientSecret: this.settings.sheets.oauthClientSecret,
		}));

		this.registerView(VIEW_TYPE, (leaf) => new BlockDrawView(leaf, this));
		this.registerExtensions([FILE_EXTENSION], VIEW_TYPE);
		registerEmbeds(this);

		this.addRibbonIcon(VIEW_ICON, "Create new block drawing", () => void this.createDrawing());
		this.registerCommands();
		this.registerMenus();
		this.addSettingTab(new BlockDrawSettingTab(this.app, this));

		// Google Fonts are only requested while the setting is on; turning it off (or unloading the plugin) removes them.
		this.webFonts = new WebFontLoader(this.app, () => this.relayoutViews());
		this.app.workspace.onLayoutReady(() => void this.syncWebFonts(false));
		this.registerEvent(this.app.workspace.on("window-open", (_win, win) => void this.webFonts.windowOpened(win.document)));
		this.register(() => this.webFonts.dispose());

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf?.view instanceof BlockDrawView) leaf.view.editor?.focus();
			}),
		);
	}

	async loadSettings(): Promise<void> {
		this.secrets = deviceSecrets(this.app, `block-draw-${vaultTag(this.app)}-`);
		const loaded = loadSettings<BlockDrawSettings>(SETTINGS, await this.loadData(), this.secrets);
		this.settings = loaded.values;
		this.stored = loaded;
		if (loaded.migrated.length) {
			// Secrets written by 0.4.x were in data.json, which syncs with the vault: take them out now.
			await this.saveData(settingsToSave(SETTINGS, this.settings, this.stored, this.secrets));
			new Notice("Your Google Sheets secrets were moved out of the vault into this device's secret storage. Enter them once on your other devices.", 12000);
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(settingsToSave(SETTINGS, this.settings, this.stored, this.secrets));
		if (this.settings.webFonts !== this.webFontsOn) void this.syncWebFonts(true);
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
			if (leaf.view instanceof BlockDrawView) leaf.view.applySettings();
		}
	}

	isSecretInVault(key: string): boolean {
		return this.stored.inVault.has(key);
	}

	/** Applies the "Load web fonts" setting; `notify` tells the user when the fonts cannot be downloaded. */
	private async syncWebFonts(notify: boolean): Promise<void> {
		this.webFontsOn = this.settings.webFonts;
		try {
			await this.webFonts.setEnabled(this.webFontsOn);
			this.relayoutViews();
		} catch (e) {
			console.error("Block Draw: web fonts not loaded", e);
			if (notify) new Notice("Could not download the web fonts. Check your connection, then turn the setting off and on again.");
		}
	}

	/** Measures and wraps the text of every open drawing again (the fonts it is set in changed). */
	private relayoutViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
			if (leaf.view instanceof BlockDrawView) leaf.view.editor?.relayout();
		}
	}

	exportContext(): ExportContext {
		return { app: this.app, settings: this.settings, auth: this.auth };
	}

	/* ------------------------------------------------------------ files */

	private newDrawingFolder(explicit?: string): string {
		if (explicit !== undefined) return explicit;
		if (this.settings.newFileFolder) return normalizePath(this.settings.newFileFolder);
		const active = this.app.workspace.getActiveFile();
		return this.app.fileManager.getNewFileParent(active?.path ?? "").path;
	}

	async createDrawing(folderPath?: string, opts: { open?: boolean } = {}): Promise<TFile> {
		const folder = this.newDrawingFolder(folderPath);
		if (folder && folder !== "/" && !(this.app.vault.getAbstractFileByPath(folder) instanceof TFolder)) {
			await this.app.vault.createFolder(folder);
		}
		const base = `${this.settings.newFilePrefix || "Drawing"} ${fileStamp(new Date())}`;
		const dir = folder && folder !== "/" ? `${folder}/` : "";
		let path = normalizePath(`${dir}${base}.${FILE_EXTENSION}`);
		for (let i = 2; this.app.vault.getAbstractFileByPath(path); i++) path = normalizePath(`${dir}${base} ${i}.${FILE_EXTENSION}`);
		const file = await this.app.vault.create(path, serializeDrawing(createEmptyDrawing()));
		if (opts.open !== false) await this.app.workspace.getLeaf("tab").openFile(file, { active: true });
		return file;
	}

	activeDrawingView(): BlockDrawView | null {
		return this.app.workspace.getActiveViewOfType(BlockDrawView);
	}

	/** Open view for a file, if any (exports from the file menu use it to keep unsaved edits). */
	private viewFor(file: TFile): BlockDrawView | null {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
			if (leaf.view instanceof BlockDrawView && leaf.view.file?.path === file.path) return leaf.view;
		}
		return null;
	}

	/* ---------------------------------------------------------- exports */

	async runExport(view: BlockDrawView, kind: ExportKind, frameId?: string | null): Promise<void> {
		if (!view.file) return;
		await this.exportDrawing(view.file, view.getDrawing(), kind, frameId, view);
	}

	async exportFile(file: TFile, kind: ExportKind): Promise<void> {
		const view = this.viewFor(file);
		if (view) return this.exportDrawing(file, view.getDrawing(), kind, null, view);
		let drawing: DrawingFile;
		try {
			drawing = parseDrawing(await this.app.vault.read(file));
		} catch (e) {
			new Notice(`Cannot export “${file.basename}”: ${(e as Error).message}`);
			return;
		}
		await this.exportDrawing(file, drawing, kind, null, null);
	}

	private async exportDrawing(file: TFile, drawing: DrawingFile, kind: ExportKind, frameId: string | null | undefined, view: BlockDrawView | null): Promise<void> {
		const ctx = this.exportContext();
		try {
			switch (kind) {
				case "json":
					await exportJsonFile(ctx, file, drawing);
					break;
				case "copy-json":
					await copyJson(ctx, file, drawing);
					break;
				case "xlsx":
					await exportXlsxFile(ctx, file, drawing);
					break;
				case "svg":
					await exportSvgFile(ctx, file, drawing, frameId);
					break;
				case "png":
					await exportPngFile(ctx, file, drawing, frameId);
					break;
				case "gsheet":
				case "gsheet-new": {
					const info = await exportGoogleSheets(ctx, file, drawing, { forceNew: kind === "gsheet-new" });
					// Remember the spreadsheet so the next export updates it in place.
					if (view) {
						view.updateMeta((m) => ({ ...m, exports: { ...m.exports, googleSheet: info } }));
					} else {
						await this.app.vault.process(file, (text) => {
							const d = parseDrawing(text);
							return serializeDrawing({ ...d, exports: { ...d.exports, googleSheet: info } });
						});
					}
					break;
				}
			}
		} catch (e) {
			console.error("Block Draw export failed", e);
			new Notice(`Export failed: ${(e as Error).message}`, 12000);
		}
	}

	/* --------------------------------------------------------- commands */

	private registerCommands(): void {
		this.addCommand({
			id: "create-drawing",
			name: "Create new drawing",
			callback: () => void this.createDrawing(),
		});
		this.addCommand({
			id: "create-drawing-and-link",
			name: "Create new drawing and link it in the current note",
			editorCallback: async (editor: MarkdownEditor, ctx) => {
				const source = ctx.file;
				const file = await this.createDrawing(undefined, { open: false });
				const link = this.app.fileManager.generateMarkdownLink(file, source?.path ?? "");
				editor.replaceSelection(link);
				await this.app.workspace.getLeaf("tab").openFile(file);
			},
		});
		this.addCommand({
			id: "insert-drawing-preview",
			name: "Insert preview of a drawing",
			editorCallback: (editor: MarkdownEditor, ctx) => {
				const drawings = this.app.vault.getFiles().filter((f) => f.extension === FILE_EXTENSION);
				const recent = drawings.sort((a, b) => b.stat.mtime - a.stat.mtime)[0];
				const linktext = recent ? this.app.metadataCache.fileToLinktext(recent, ctx.file?.path ?? "", false) : "My drawing.blockdraw";
				editor.replaceSelection(`\`\`\`blockdraw\nfile: ${linktext}\n\`\`\`\n`);
			},
		});

		const withView = (id: string, name: string, run: (view: BlockDrawView) => void) =>
			this.addCommand({
				id,
				name,
				checkCallback: (checking) => {
					const view = this.activeDrawingView();
					if (!view) return false;
					if (!checking) run(view);
					return true;
				},
			});
		withView("export-google-sheets", "Export to Google Sheets", (v) => void this.runExport(v, "gsheet"));
		withView("export-google-sheets-new", "Export to a new Google Sheet", (v) => void this.runExport(v, "gsheet-new"));
		withView("export-xlsx", "Export Excel workbook (.xlsx)", (v) => void this.runExport(v, "xlsx"));
		withView("export-json", "Export JSON", (v) => void this.runExport(v, "json"));
		withView("copy-json", "Copy JSON to clipboard", (v) => void this.runExport(v, "copy-json"));
		withView("export-png", "Export as PNG (selected frame or whole drawing)", (v) => {
			const f = v.editor?.selectedFrames() ?? [];
			void this.runExport(v, "png", f.length === 1 ? f[0].id : null);
		});
		withView("export-svg", "Export as SVG (selected frame or whole drawing)", (v) => {
			const f = v.editor?.selectedFrames() ?? [];
			void this.runExport(v, "svg", f.length === 1 ? f[0].id : null);
		});
		withView("zoom-to-fit", "Zoom to fit", (v) => v.editor?.zoomToFit({ animate: true }));
		withView("next-frame", "Go to next frame", (v) => v.editor?.stepFrame(1));
		withView("previous-frame", "Go to previous frame", (v) => v.editor?.stepFrame(-1));
		withView("add-frame", "Add frame", (v) => v.editor?.addFrameAfterContent());
		withView("toggle-frames-panel", "Toggle frames panel", (v) => v.editor?.framesPanel.toggle());
		withView("present", "Present drawing (one slide per frame)", (v) => v.editor?.presenter.start());
		withView("toggle-3d", "Toggle 3D effect (selection, or the whole drawing)", (v) => v.editor?.toggle3D());
		withView("trace-dependencies", "Trace dependencies of the selected block", (v) => {
			const only = v.editor?.selectedBlocks() ?? [];
			if (only.length === 1) v.editor?.toggleTrace(only[0].id);
			else new Notice("Select one block to trace its dependencies.");
		});
		for (const t of DRAWING_THEMES) {
			withView(`theme-${t.id}`, `Apply theme: ${t.name} (selection, or the whole drawing)`, (v) => v.editor?.applyTheme(t.id));
		}
	}

	private registerMenus(): void {
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (file instanceof TFolder) {
					menu.addItem((item) =>
						item
							.setTitle("New block drawing")
							.setIcon(VIEW_ICON)
							.onClick(() => void this.createDrawing(file.path)),
					);
				} else if (file instanceof TFile && file.extension === FILE_EXTENSION) {
					menu.addItem((item) =>
						item
							.setTitle("Export to Google Sheets")
							.setIcon("sheet")
							.onClick(() => void this.exportFile(file, "gsheet")),
					);
					menu.addItem((item) =>
						item
							.setTitle("Export Excel workbook (.xlsx)")
							.setIcon("sheet")
							.onClick(() => void this.exportFile(file, "xlsx")),
					);
					menu.addItem((item) =>
						item
							.setTitle("Export JSON")
							.setIcon("braces")
							.onClick(() => void this.exportFile(file, "json")),
					);
				}
			}),
		);
	}
}
