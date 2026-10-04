import { snap, unionBounds, type Point } from "../geometry/geom";
import { traceDependencies, type DependencyTrace } from "../model/graph";
import { History, type HistoryEntry } from "../model/history";
import { indexById, updateElements, type ElementPatch, type ZOrderMode } from "../model/ops";
import {
	DEFAULT_BLOCK_STYLE,
	DEFAULT_CONNECTOR_STYLE,
	DEFAULT_FRAME_STYLE,
	isBlock,
	isBox,
	isConnector,
	isFrame,
	type AnchorSide,
	type BlockElement,
	type BlockShape,
	type BlockStyle,
	type Bounds,
	type ConnectorElement,
	type ConnectorStyle,
	type DrawElement,
	type FrameElement,
	type FrameStyle,
	type Routing,
	type Side,
} from "../model/types";
import type { DrawingThemeId } from "../model/themes";
import type { PaletteId } from "../render/colors";
import { clearTextMeasureCache } from "../render/text";
import { ClipboardController } from "./clipboard";
import { shortcut } from "./commands";
import { showContextMenu } from "./contextMenu";
import { addBlockAt, addFrame, addFrameAfterContent, connect, createConnectedBlock, insertBlocks, makeBlock } from "./create";
import {
	alignSelection,
	applyBlockStyle,
	applyConnectorStyle,
	applyFrameStyle,
	applyRouting,
	applyShape,
	applyTheme,
	deleteSelection,
	distributeSelection,
	duplicateSelection,
	nudge,
	reorderSelection,
	reverseConnector,
	toggle3D,
} from "./edits";
import { el, svgEl } from "./dom";
import type { EditorHost } from "./host";
import { blockAt, hitTest, sideNear } from "./hitTest";
import { KeyboardController } from "./keyboard";
import { describeLink, editLink, findFrame, followLink, linkToFrame, navigateBack, navigateToFrame, stepFrame } from "./navigation";
import { PointerController } from "./pointer";
import { Presenter } from "./Presenter";
import { SceneRenderer } from "./renderer";
import { FramesPanel } from "./ui/FramesPanel";
import { HelpPanel } from "./ui/HelpPanel";
import { PropsPanel } from "./ui/PropsPanel";
import { TextEditor } from "./ui/TextEditor";
import { TOOL_HINTS, Toolbar } from "./ui/Toolbar";
import { ZoomControls } from "./ui/ZoomControls";
import { ViewportController } from "./viewport";
import {
	DEFAULT_EDITOR_OPTIONS,
	type EditorOptions,
	type Hit,
	type Tool,
	type Viewport,
} from "./types";

export interface CommitOptions {
	selection?: Iterable<string>;
	/** State to record in history (defaults to the state before this commit). */
	before?: HistoryEntry;
	/** Skip recording an undo step. */
	skipHistory?: boolean;
}

export interface CurrentStyle {
	shape: BlockShape;
	block: BlockStyle;
	connector: ConnectorStyle;
	routing: Routing;
	frame: FrameStyle;
}

/**
 * Excalidraw-style editor for block diagrams. Owns the DOM, the element list (immutable
 * snapshots), selection, viewport and undo history. Independent from Obsidian: everything
 * environment-specific goes through {@link EditorHost}.
 */
export class Editor {
	readonly root: HTMLDivElement;
	readonly canvas: HTMLDivElement;
	readonly svg: SVGSVGElement;
	readonly viewportG: SVGGElement;
	readonly renderer: SceneRenderer;
	readonly pointer: PointerController;
	readonly keyboard: KeyboardController;
	readonly textEditor: TextEditor;
	readonly toolbar: Toolbar;
	readonly props: PropsPanel;
	readonly framesPanel: FramesPanel;
	readonly zoomControls: ZoomControls;
	readonly help: HelpPanel;
	readonly presenter: Presenter;
	readonly view: ViewportController;
	readonly clipboard: ClipboardController;
	private readonly hintEl: HTMLDivElement;
	private readonly emptyEl: HTMLDivElement;

	elements: readonly DrawElement[] = [];
	byId = new Map<string, DrawElement>();
	selection = new Set<string>();
	tool: Tool = "select";
	toolShape: BlockShape = "rounded";
	vp: Viewport = { x: 0, y: 0, zoom: 1 };
	hoverId: string | null = null;
	editingId: string | null = null;
	navStack: Viewport[] = [];
	/** Block whose upstream/downstream dependencies are highlighted, if any. */
	traceRootId: string | null = null;
	/** Swatch set shown in the properties panel. */
	palette: PaletteId = "classic";
	readonly history = new History();
	options: EditorOptions;
	current: CurrentStyle = {
		shape: "rounded",
		block: { ...DEFAULT_BLOCK_STYLE },
		connector: { ...DEFAULT_CONNECTOR_STYLE },
		routing: "elbow",
		frame: { ...DEFAULT_FRAME_STYLE },
	};

	/** Called after every committed (undoable) change; the host saves the file. */
	onChange: ((elements: readonly DrawElement[]) => void) | null = null;
	/** Called when the viewport changes (the host may remember it). */
	onViewportChange: ((vp: Viewport) => void) | null = null;

	private renderQueued = false;
	/** Set once destroy() ran; pending animations and async work check it. */
	destroyed = false;
	private resizeObserver: ResizeObserver | null = null;
	private readonly cleanup: (() => void)[] = [];
	/** Document and window the editor lives in (may be an Obsidian popout window). */
	readonly doc: Document;
	readonly win: Window;

	constructor(
		parent: HTMLElement,
		readonly host: EditorHost,
		options: Partial<EditorOptions> = {},
	) {
		this.options = { ...DEFAULT_EDITOR_OPTIONS, ...options };
		this.doc = parent.ownerDocument ?? document;
		this.win = this.doc.defaultView ?? window;
		this.root = el("div", "bd-editor", parent);
		this.root.tabIndex = 0;
		if (this.options.readOnly) this.root.classList.add("bd-readonly");
		this.canvas = el("div", "bd-canvas", this.root);
		this.svg = svgEl("svg", { class: "bd-svg" }, this.canvas);
		this.viewportG = svgEl("g", { class: "bd-viewport" }, this.svg);
		this.renderer = new SceneRenderer(this, this.viewportG);
		this.view = new ViewportController(this);
		this.emptyEl = el("div", "bd-empty-hint", this.root);
		el("div", "bd-empty-title", this.emptyEl, "Start your block drawing");
		el(
			"div",
			"bd-empty-text",
			this.emptyEl,
			"Double-click to add a block · drag from a block's edge dot to connect · press F to draw a frame",
		);
		this.hintEl = el("div", "bd-hint", this.root);

		this.textEditor = new TextEditor(this);
		this.toolbar = new Toolbar(this);
		this.props = new PropsPanel(this);
		this.framesPanel = new FramesPanel(this);
		this.zoomControls = new ZoomControls(this);
		this.help = new HelpPanel(this);
		this.presenter = new Presenter(this);
		this.pointer = new PointerController(this);
		this.keyboard = new KeyboardController(this);

		this.clipboard = new ClipboardController(this);

		if (typeof ResizeObserver !== "undefined") {
			this.resizeObserver = new ResizeObserver(() => this.resize());
			this.resizeObserver.observe(this.root);
		} else {
			this.win.requestAnimationFrame(() => this.resize());
		}
		this.view.applyGridClass();
		this.requestRender();
	}

	/** Adds a DOM listener that is removed on destroy. */
	listen(target: EventTarget, type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions): void {
		target.addEventListener(type, fn, opts);
		this.cleanup.push(() => target.removeEventListener(type, fn, opts));
	}

	/** Gives the canvas keyboard focus (so tool shortcuts work right away). */
	focus(): void {
		const active = this.doc.activeElement;
		if (!active || !this.root.contains(active) || active === this.doc.body) {
			this.root.focus({ preventScroll: true });
		}
	}

	destroy(): void {
		this.presenter.stop();
		this.destroyed = true;
		this.resizeObserver?.disconnect();
		this.view.stopAnimation();
		this.textEditor.cancel();
		for (const fn of this.cleanup) fn();
		this.root.remove();
	}

	/* ================================================================ data */

	/** Replaces the drawing (e.g. when a file is opened or changed on disk). */
	load(elements: readonly DrawElement[], opts: { resetHistory?: boolean; fit?: boolean } = {}): void {
		this.textEditor.cancel();
		if (opts.resetHistory !== false) {
			this.history.clear();
			this.navStack = [];
		} else if (this.elements !== elements) {
			this.history.push(this.snapshot());
		}
		this.setElements(elements);
		this.selection = new Set([...this.selection].filter((id) => this.byId.has(id)));
		if (opts.resetHistory !== false) this.selection.clear();
		this.renderer.reset();
		if (opts.fit !== false) this.whenSized(() => this.zoomToFit({ animate: false, maxZoom: 1 }));
		this.requestRender();
	}

	/** Redraws every element from scratch, e.g. once web fonts changed how wide the text is. */
	relayout(): void {
		clearTextMeasureCache();
		this.renderer.reset();
		this.requestRender();
	}

	/** Runs a viewport change now if the canvas is laid out, otherwise on its first layout. */
	whenSized(fn: () => void): void {
		this.view.whenSized(fn);
	}

	getElements(): readonly DrawElement[] {
		return this.elements;
	}

	setOptions(partial: Partial<EditorOptions>): void {
		this.options = { ...this.options, ...partial };
		this.view.applyGridClass();
		this.requestRender();
	}

	private setElements(next: readonly DrawElement[]): void {
		this.elements = next;
		this.byId = indexById(next);
	}

	snapshot(): HistoryEntry {
		return { elements: this.elements, selection: [...this.selection] };
	}

	/** Applies a change as one undoable step and notifies the host. */
	commit(next: readonly DrawElement[], opts: CommitOptions = {}): void {
		const before = opts.before ?? this.snapshot();
		const changed = next !== before.elements && !sameElements(next, before.elements);
		if (opts.selection) this.selection = new Set(opts.selection);
		this.setElements(next);
		this.selection = new Set([...this.selection].filter((id) => this.byId.has(id)));
		if (changed) {
			if (!opts.skipHistory) this.history.push(before);
			this.onChange?.(this.elements);
		}
		this.requestRender();
	}

	/** Updates elements without recording history (used while dragging). */
	setTransient(next: readonly DrawElement[]): void {
		this.setElements(next);
		this.requestRender();
	}

	undo(): void {
		if (this.pointer.isBusy()) return;
		this.textEditor.commit();
		const entry = this.history.undo(this.snapshot());
		if (entry) this.restore(entry);
	}

	redo(): void {
		if (this.pointer.isBusy()) return;
		this.textEditor.commit();
		const entry = this.history.redo(this.snapshot());
		if (entry) this.restore(entry);
	}

	private restore(entry: HistoryEntry): void {
		this.setElements(entry.elements);
		this.selection = new Set(entry.selection.filter((id) => this.byId.has(id)));
		this.onChange?.(this.elements);
		this.requestRender();
	}

	/* =========================================================== queries */

	frames(): FrameElement[] {
		return this.elements.filter(isFrame);
	}

	selectedElements(): DrawElement[] {
		return this.elements.filter((e) => this.selection.has(e.id));
	}

	selectedBlocks(): BlockElement[] {
		return this.elements.filter((e): e is BlockElement => isBlock(e) && this.selection.has(e.id));
	}

	selectedConnectors(): ConnectorElement[] {
		return this.elements.filter((e): e is ConnectorElement => isConnector(e) && this.selection.has(e.id));
	}

	selectedFrames(): FrameElement[] {
		return this.elements.filter((e): e is FrameElement => isFrame(e) && this.selection.has(e.id));
	}

	/** Block whose connection dots are shown (hovered block, or the single selected block). */
	connectHandleBlockId(): string | null {
		if (this.options.readOnly || this.editingId) return null;
		if (this.tool !== "select" && this.tool !== "connector") return null;
		if (this.pointer.isBusy() && !this.pointer.isConnecting()) return null;
		if (this.pointer.isConnecting()) return null;
		if (this.hoverId && isBlock(this.byId.get(this.hoverId))) return this.hoverId;
		if (this.selection.size === 1) {
			const only = this.byId.get([...this.selection][0]);
			if (isBlock(only)) return only.id;
		}
		return null;
	}

	/* ====================================================== viewport (view) */

	viewSize(): { width: number; height: number } {
		return this.view.viewSize();
	}

	clientToScreen(clientX: number, clientY: number): Point {
		return this.view.clientToScreen(clientX, clientY);
	}

	screenToWorld(p: Point): Point {
		return this.view.screenToWorld(p);
	}

	worldToScreen(p: Point): Point {
		return this.view.worldToScreen(p);
	}

	clientToWorld(clientX: number, clientY: number): Point {
		return this.view.clientToWorld(clientX, clientY);
	}

	setViewport(vp: Viewport, opts: { silent?: boolean } = {}): void {
		this.view.setViewport(vp, opts);
	}

	panBy(dx: number, dy: number): void {
		this.view.panBy(dx, dy);
	}

	zoomAt(factor: number, screen?: Point): void {
		this.view.zoomAt(factor, screen);
	}

	zoomTo(zoom: number): void {
		this.view.zoomTo(zoom);
	}

	viewportFor(b: Bounds, padding = 48, maxZoom = 2): Viewport {
		return this.view.viewportFor(b, padding, maxZoom);
	}

	zoomToBounds(b: Bounds, opts: { animate?: boolean; padding?: number; maxZoom?: number } = {}): void {
		this.view.zoomToBounds(b, opts);
	}

	zoomToFit(opts: { animate?: boolean; maxZoom?: number } = {}): void {
		this.view.zoomToFit(opts);
	}

	zoomToSelection(): void {
		this.view.zoomToSelection();
	}

	resize(): void {
		this.view.resize();
	}

	/* ============================================================ frames */

	/** Pans/zooms to a frame. Pushes the current view so "Back" can return to it. */
	navigateToFrame(frameId: string, opts: { remember?: boolean; select?: boolean; animate?: boolean } = {}): boolean {
		return navigateToFrame(this, frameId, opts);
	}

	/** Finds a frame by id or (case-insensitive) title. */
	findFrame(ref: string): FrameElement | null {
		return findFrame(this, ref);
	}

	navigateBack(): void {
		navigateBack(this);
	}

	/** Steps to the next/previous frame in frame order. */
	stepFrame(delta: 1 | -1): void {
		stepFrame(this, delta);
	}

	/** Follows a block's link: frames are navigated in place, other links go to the host. */
	followLink(blockId: string, newLeaf = false): void {
		followLink(this, blockId, newLeaf);
	}

	/** Shows or hides a block's description on the canvas; the text itself is kept. */
	toggleDescription(id: string): void {
		const el = this.byId.get(id);
		if (isBlock(el)) this.updateElement(id, { descriptionOpen: !el.descriptionOpen });
	}

	/**
	 * Shows or hides a block's or connector's comment callout. While presenting this only
	 * changes what is on screen; otherwise the open state is saved with the drawing.
	 */
	toggleComment(id: string): void {
		const el = this.byId.get(id);
		if (!isBlock(el) && !isConnector(el)) return;
		if (this.presenter.isActive()) this.presenter.toggleComment(id);
		else this.updateElement(id, { commentOpen: !el.commentOpen });
	}

	/* ===================================================== dependencies */

	/** Highlights everything a block depends on and everything that depends on it. */
	traceBlock(id: string): void {
		if (!isBlock(this.byId.get(id))) return;
		this.traceRootId = id;
		this.requestRender();
	}

	toggleTrace(id: string): void {
		if (this.traceRootId === id) this.clearTrace();
		else this.traceBlock(id);
	}

	clearTrace(): void {
		if (this.traceRootId === null) return;
		this.traceRootId = null;
		this.requestRender();
	}

	/** The active trace, recomputed from the current elements (null when off). */
	currentTrace(): DependencyTrace | null {
		if (this.traceRootId && !isBlock(this.byId.get(this.traceRootId))) this.traceRootId = null;
		return this.traceRootId ? traceDependencies(this.elements, this.traceRootId) : null;
	}

	/* ============================================================ themes */

	/**
	 * Restyles the selection (or the whole drawing when nothing is selected) with a theme, as
	 * one undo step, and makes it the style for new elements.
	 */
	applyTheme(id: DrawingThemeId): void {
		applyTheme(this, id);
	}

	/** Turns the 3D effect on or off for the selected blocks and connectors (all when none). */
	toggle3D(): void {
		toggle3D(this);
	}

	/* ========================================================= selection */

	setSelection(ids: Iterable<string>): void {
		this.selection = new Set([...ids].filter((id) => this.byId.has(id)));
		this.requestRender();
	}

	toggleSelection(id: string): void {
		const next = new Set(this.selection);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		this.setSelection(next);
	}

	selectAll(): void {
		this.setSelection(this.elements.map((e) => e.id));
	}

	clearSelection(): void {
		if (this.selection.size) this.setSelection([]);
	}

	selectionBounds(): Bounds | null {
		const list: Bounds[] = [];
		for (const e of this.selectedElements()) {
			if (isBox(e)) list.push(e);
			else {
				const r = this.renderer.route(e);
				if (r) list.push(r.route.bounds);
			}
		}
		return unionBounds(list);
	}

	setTool(tool: Tool, shape?: BlockShape): void {
		if (this.options.readOnly && tool !== "select" && tool !== "pan") return;
		this.textEditor.commit();
		this.tool = tool;
		if (shape) this.toolShape = shape;
		else if (tool === "block") this.toolShape = this.current.shape;
		this.root.dataset.tool = tool;
		this.requestRender();
	}

	/* ========================================================= hit tests */

	/** What is under a world point? Handles first, then blocks, connectors and frames. */
	hitTest(p: Point): Hit | null {
		return hitTest(this, p);
	}

	/** Topmost block at a point (used as drop target while connecting). */
	blockAt(p: Point, exclude?: string, margin = 0): BlockElement | null {
		return blockAt(this, p, exclude, margin);
	}

	/** Side whose anchor is close to `p` (to pin a connector end), or "auto". */
	sideNear(block: BlockElement, p: Point): AnchorSide {
		return sideNear(this, block, p);
	}

	/* ========================================================== creation */

	snapValue(v: number): number {
		return this.options.snapToGrid ? snap(v, this.options.gridSize) : v;
	}

	snapPoint(p: Point): Point {
		return { x: this.snapValue(p.x), y: this.snapValue(p.y) };
	}

	makeBlock(bounds: Bounds, patch: Partial<BlockElement> = {}): BlockElement {
		return makeBlock(this, bounds, patch);
	}

	/** Adds a default-size block centered on `p` and starts editing its title. */
	addBlockAt(p: Point, opts: { shape?: BlockShape; edit?: boolean } = {}): BlockElement {
		return addBlockAt(this, p, opts);
	}

	insertBlocks(blocks: BlockElement[], extra: DrawElement[] = []): void {
		insertBlocks(this, blocks, extra);
	}

	addFrame(bounds: Bounds, opts: { edit?: boolean } = {}): FrameElement {
		return addFrame(this, bounds, opts);
	}

	/** Adds a frame to the right of all existing content and navigates to it. */
	addFrameAfterContent(): FrameElement {
		return addFrameAfterContent(this);
	}

	connect(fromId: string, toId: string, opts: { fromSide?: AnchorSide; toSide?: AnchorSide; select?: boolean } = {}): ConnectorElement | null {
		return connect(this, fromId, toId, opts);
	}

	/**
	 * Creates a new block next to `fromId` (in direction `side`, or at `at`) connected to it,
	 * then starts editing its title. Mirrors draw.io's quick-connect.
	 */
	createConnectedBlock(fromId: string, side: Side | null, at?: Point): BlockElement | null {
		return createConnectedBlock(this, fromId, side, at);
	}

	/* ============================================================ edits */

	deleteSelection(): void {
		deleteSelection(this);
	}

	duplicateSelection(): void {
		duplicateSelection(this);
	}

	nudge(dx: number, dy: number): void {
		nudge(this, dx, dy);
	}

	reorderSelection(mode: ZOrderMode): void {
		reorderSelection(this, mode);
	}

	updateElement(id: string, patch: ElementPatch, opts: CommitOptions = {}): void {
		this.commit(updateElements(this.elements, new Map([[id, patch]])), opts);
	}

	/** Applies a block style change to the selected blocks and remembers it for new blocks. */
	applyBlockStyle(patch: Partial<BlockStyle>): void {
		applyBlockStyle(this, patch);
	}

	applyShape(shape: BlockShape): void {
		applyShape(this, shape);
	}

	applyConnectorStyle(patch: Partial<ConnectorStyle>): void {
		applyConnectorStyle(this, patch);
	}

	applyRouting(routing: Routing): void {
		applyRouting(this, routing);
	}

	applyFrameStyle(patch: Partial<FrameStyle>): void {
		applyFrameStyle(this, patch);
	}

	reverseConnector(id: string): void {
		reverseConnector(this, id);
	}

	/** Opens the link picker for a block. */
	editLink(blockId: string): Promise<void> {
		return editLink(this, blockId);
	}

	linkToFrame(blockId: string, frameId: string | null): void {
		linkToFrame(this, blockId, frameId);
	}

	describeLink(link: string | null): string {
		return describeLink(this, link);
	}

	/** Aligns selected boxes (blocks and frames). */
	alignSelection(mode: "left" | "center" | "right" | "top" | "middle" | "bottom"): void {
		alignSelection(this, mode);
	}

	distributeSelection(axis: "h" | "v"): void {
		distributeSelection(this, axis);
	}

	/* ======================================================= context menu */

	showContextMenu(screen: { x: number; y: number }, world: Point): void {
		showContextMenu(this, screen, world);
	}

	/* ========================================================== rendering */

	requestRender(): void {
		if (this.renderQueued || this.destroyed) return;
		this.renderQueued = true;
		this.win.requestAnimationFrame(() => {
			this.renderQueued = false;
			if (!this.destroyed) this.renderNow();
		});
	}

	renderNow(): void {
		this.svg.setAttribute("data-zoom", String(Math.round(this.vp.zoom * 100) / 100));
		this.viewportG.setAttribute("transform", `translate(${this.vp.x},${this.vp.y}) scale(${this.vp.zoom})`);
		this.view.applyGridClass();
		this.renderer.render();
		this.toolbar.update();
		this.props.update();
		this.framesPanel.update();
		this.zoomControls.update();
		this.presenter.update();
		this.updateHint();
		this.emptyEl.classList.toggle("is-visible", this.elements.length === 0 && !this.options.readOnly);
	}

	private updateHint(): void {
		let text = "";
		const trace = this.currentTrace();
		if (trace && !this.presenter.isActive()) {
			const root = this.byId.get(trace.rootId);
			const name = isBlock(root) && root.title.trim() ? `“${root.title.trim().split("\n")[0]}”` : "this block";
			text = `${name}: ${trace.upstream.size} upstream (amber) · ${trace.downstream.size} downstream (green) — ${shortcut("cancel")} to clear`;
		} else if (!this.options.readOnly) {
			const busy = this.pointer.hint();
			if (busy) text = busy;
			else if (this.editingId) text = "Enter to finish · Shift+Enter for a new line";
			else if (TOOL_HINTS[this.tool]) text = TOOL_HINTS[this.tool] ?? "";
			else if (this.selection.size === 1) {
				const only = this.byId.get([...this.selection][0]);
				if (isBlock(only)) text = only.link ? "Ctrl/Cmd+click or the corner badge follows the link" : "Drag a side dot to connect · double-click to edit";
				else if (isFrame(only)) text = "Drag the title to move the frame with its blocks";
			}
		}
		if (this.hintEl.textContent !== text) this.hintEl.textContent = text;
		this.hintEl.classList.toggle("is-visible", !!text);
	}
}

function sameElements(a: readonly DrawElement[], b: readonly DrawElement[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

