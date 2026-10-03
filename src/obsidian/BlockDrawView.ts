import { Menu, Notice, Platform, TextFileView, type IconName, type WorkspaceLeaf } from "obsidian";
import { Editor } from "../editor/Editor";
import type { EditorHost, LinkPickOptions, MenuItemSpec } from "../editor/host";
import type { Viewport } from "../editor/types";
import { createEmptyDrawing, DrawingParseError, parseDrawing, serializeDrawing } from "../model/file";
import { parseLink } from "../model/links";
import { isFrame, type DrawingFile, type DrawingMeta } from "../model/types";
import { LinkPickerModal } from "./LinkPickerModal";
import type { BlockDrawHost } from "./plugin";

export const VIEW_TYPE = "block-draw-view";
export const VIEW_ICON = "workflow";

/** Maps the editor's internal icon names to Lucide icons bundled with Obsidian. */
const MENU_ICONS: Record<string, IconName> = {
	block: "square",
	frame: "frame",
	duplicate: "copy",
	trash: "trash-2",
	link: "link",
	unlink: "unlink",
	"follow-link": "external-link",
	edit: "pencil",
	fit: "maximize",
	grid: "grid",
	snap: "magnet",
	front: "bring-to-front",
	back_layer: "send-to-back",
	json: "braces",
	sheet: "sheet",
	image: "image",
	export: "download",
	present: "presentation",
	trace: "git-fork",
	cube: "box",
	palette: "palette",
};

/** Remembers the last viewport per file while Obsidian is running. */
const viewportCache = new Map<string, Viewport>();

export class BlockDrawView extends TextFileView {
	editor: Editor | null = null;
	/** Everything in the file except the elements (kept on save). */
	private meta: DrawingMeta = createEmptyDrawing();
	private loadError: string | null = null;
	private errorEl: HTMLElement | null = null;
	private rawData = "";
	private pendingSubpath: string | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		readonly plugin: BlockDrawHost,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getIcon(): IconName {
		return VIEW_ICON;
	}

	getDisplayText(): string {
		return this.file?.basename ?? "Block drawing";
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("bd-view-container");
		this.ensureEditor();
	}

	async onClose(): Promise<void> {
		this.rememberViewport();
		this.editor?.destroy();
		this.editor = null;
	}

	private ensureEditor(): Editor {
		if (this.editor) return this.editor;
		const s = this.plugin.settings;
		this.editor = new Editor(this.contentEl, this.makeHost(), {
			gridSize: s.gridSize,
			snapToGrid: s.snapToGrid,
			showGrid: s.showGrid,
			webFonts: s.webFonts,
		});
		this.editor.onChange = () => this.requestSave();
		this.editor.onViewportChange = () => this.rememberViewport();
		return this.editor;
	}

	private rememberViewport(): void {
		if (this.file && this.editor) viewportCache.set(this.file.path, { ...this.editor.vp });
	}

	/** Re-applies plugin settings (grid etc.) after they change. */
	applySettings(): void {
		const s = this.plugin.settings;
		this.editor?.setOptions({ gridSize: s.gridSize, snapToGrid: s.snapToGrid, showGrid: s.showGrid, webFonts: s.webFonts });
	}

	/* --------------------------------------------------------- file data */

	setViewData(data: string, clear: boolean): void {
		const editor = this.ensureEditor();
		this.rawData = data;
		let drawing: DrawingFile;
		try {
			drawing = parseDrawing(data);
		} catch (e) {
			this.showLoadError(e instanceof DrawingParseError ? e.message : String(e));
			return;
		}
		this.showLoadError(null);
		const { elements, ...meta } = drawing;
		this.meta = meta;
		const cached = clear && this.file ? viewportCache.get(this.file.path) : undefined;
		editor.load(elements, { resetHistory: clear, fit: clear && !cached });
		if (cached) editor.whenSized(() => editor.setViewport(cached, { silent: true }));
		if (this.pendingSubpath) this.applySubpath(this.pendingSubpath);
		if (clear && this.app.workspace.getActiveViewOfType(BlockDrawView) === this) editor.focus();
	}

	getViewData(): string {
		// Never overwrite a file we could not read.
		if (this.loadError || !this.editor) return this.rawData;
		return serializeDrawing({ ...this.meta, elements: [...this.editor.getElements()] });
	}

	clear(): void {
		this.meta = createEmptyDrawing();
		this.editor?.load([], { resetHistory: true });
	}

	/** Current drawing (elements from the editor plus file metadata). */
	getDrawing(): DrawingFile {
		return { ...this.meta, elements: [...(this.editor?.getElements() ?? [])] };
	}

	/** Updates non-element file data (e.g. export info) and saves. */
	updateMeta(update: (meta: DrawingMeta) => DrawingMeta): void {
		this.meta = update(this.meta);
		this.requestSave();
	}

	private showLoadError(message: string | null): void {
		this.loadError = message;
		this.errorEl?.remove();
		this.errorEl = null;
		if (this.editor) this.editor.root.style.display = message ? "none" : "";
		if (!message) return;
		this.errorEl = this.contentEl.createDiv({ cls: "bd-load-error" });
		this.errorEl.createEl("h3", { text: "This drawing could not be opened" });
		this.errorEl.createEl("p", { text: message });
		this.errorEl.createEl("p", { text: "The file was left unchanged. Fix it in a text editor or restore it from a backup." });
	}

	onResize(): void {
		this.editor?.resize();
	}

	/* ---------------------------------------------------- frame subpaths */

	setEphemeralState(state: unknown): void {
		super.setEphemeralState(state);
		const subpath = (state as { subpath?: string } | null)?.subpath;
		if (subpath) {
			this.pendingSubpath = subpath;
			if (this.editor && this.file) this.applySubpath(subpath);
		}
	}

	/** `#Frame title` or `#^frameId` from a link like [[Drawing.blockdraw#Overview]]. */
	private applySubpath(subpath: string): void {
		const editor = this.editor;
		if (!editor) return;
		const ref = decodeURIComponent(subpath.replace(/^#\^?/, "")).trim();
		this.pendingSubpath = null;
		if (!ref) return;
		const frame = editor.findFrame(ref);
		if (frame) {
			editor.whenSized(() => editor.navigateToFrame(frame.id, { remember: false, select: true, animate: false }));
		} else {
			new Notice(`No frame named “${ref}” in this drawing.`);
		}
	}

	/* -------------------------------------------------------- pane menu */

	onPaneMenu(menu: Menu, source: string): void {
		super.onPaneMenu(menu, source);
		for (const item of this.exportItems()) {
			menu.addItem((mi) => {
				mi.setTitle(item.title).onClick(item.onClick);
				if (item.icon) mi.setIcon(MENU_ICONS[item.icon] ?? item.icon);
				mi.setSection("action");
			});
		}
	}

	exportItems(): MenuItemSpec[] {
		const p = this.plugin;
		const frameId = () => {
			const sel = this.editor?.selectedFrames() ?? [];
			return sel.length === 1 ? sel[0].id : null;
		};
		const frameTitle = () => {
			const id = frameId();
			const f = id ? this.editor?.byId.get(id) : null;
			return isFrame(f) ? f.title : null;
		};
		const items: MenuItemSpec[] = [
			{ title: "Export to Google Sheets", icon: "sheet", onClick: () => void p.runExport(this, "gsheet") },
			{ title: "Export Excel workbook (.xlsx)", icon: "sheet", onClick: () => void p.runExport(this, "xlsx") },
			{ title: "Export JSON", icon: "json", onClick: () => void p.runExport(this, "json"), separator: true },
			{ title: "Copy JSON to clipboard", icon: "json", onClick: () => void p.runExport(this, "copy-json") },
			{
				title: frameTitle() ? `Export frame “${frameTitle()}” as PNG` : "Export as PNG",
				icon: "image",
				onClick: () => void p.runExport(this, "png", frameId()),
				separator: true,
			},
			{
				title: frameTitle() ? `Export frame “${frameTitle()}” as SVG` : "Export as SVG",
				icon: "image",
				onClick: () => void p.runExport(this, "svg", frameId()),
			},
		];
		const info = this.meta.exports?.googleSheet;
		if (info?.url) {
			items.splice(1, 0, { title: "Open the exported Google Sheet", icon: "follow-link", onClick: () => window.open(info.url) });
		}
		return items;
	}

	/* ------------------------------------------------------- editor host */

	private makeHost(): EditorHost {
		return {
			isMac: Platform.isMacOS,
			showMenu: (items, position) => {
				const menu = new Menu();
				for (const item of items) {
					if (item.separator) menu.addSeparator();
					menu.addItem((mi) => {
						mi.setTitle(item.title).onClick(() => item.onClick());
						if (item.icon) mi.setIcon(MENU_ICONS[item.icon] ?? item.icon);
						if (item.checked !== undefined) mi.setChecked(item.checked);
						if (item.disabled) mi.setDisabled(true);
						if (item.warning) mi.setWarning(true);
					});
				}
				menu.showAtPosition(position);
			},
			notice: (message) => new Notice(message),
			openLink: (link, newLeaf) => {
				const parsed = parseLink(link);
				if (!parsed) return;
				if (parsed.kind === "url") window.open(parsed.url);
				else if (parsed.kind === "note") void this.app.workspace.openLinkText(parsed.linktext, this.file?.path ?? "", newLeaf);
			},
			pickLink: (options: LinkPickOptions) =>
				new LinkPickerModal(this.app, { ...options, sourcePath: this.file?.path ?? "" }).openAndWait(),
			describeLink: (link) => {
				const parsed = parseLink(link);
				if (!parsed || parsed.kind !== "note") return link;
				const dest = this.app.metadataCache.getFirstLinkpathDest(parsed.path, this.file?.path ?? "");
				if (!dest) return `${parsed.display} (not created yet)`;
				return parsed.display !== parsed.linktext.replace(/^.*\//, "") ? parsed.display : `${dest.basename}${parsed.subpath}`;
			},
			exportMenu: () => this.exportItems(),
		};
	}
}
