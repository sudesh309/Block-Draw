import {
	center,
	clamp,
	dist,
	snap,
	SIDE_DIR,
	SIDES,
	add,
	scale,
	unionBounds,
	type Point,
} from "../geometry/geom";
import { distanceToRoute } from "../geometry/routing";
import { shapeContains, sideAnchor } from "../geometry/shapes";
import { traceDependencies, type DependencyTrace } from "../model/graph";
import { History, type HistoryEntry } from "../model/history";
import { newId } from "../model/ids";
import { frameLink, parseLink } from "../model/links";
import {
	assignFrames,
	cloneElements,
	collectForCopy,
	deleteElements,
	expandMoveSet,
	indexById,
	insertClones,
	makeClipboardPayload,
	readClipboardPayload,
	refreshFrameMembership,
	reorderElements,
	translateElements,
	updateElements,
	type ElementPatch,
	type ZOrderMode,
} from "../model/ops";
import {
	DEFAULT_BLOCK_SIZE,
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
import { applyDrawingTheme, DRAWING_THEMES, drawingThemeById, type DrawingThemeId } from "../model/themes";
import type { PaletteId } from "../render/colors";
import { contentBounds } from "../render/scene";
import { blockCommentBadgeBox, connectorCommentBadgeRect, frameTitleMetrics, labelBox } from "../render/elements";
import { layoutBlockText } from "../render/text";
import { el, svgEl } from "./dom";
import type { EditorHost, MenuItemSpec } from "./host";
import { KeyboardController } from "./keyboard";
import { PointerController } from "./pointer";
import { Presenter } from "./Presenter";
import { CONNECT_HANDLE_OFFSET, CONNECT_HANDLE_RADIUS, handlePosition, RESIZE_HANDLE_SIZE, SceneRenderer } from "./renderer";
import { FramesPanel } from "./ui/FramesPanel";
import { HelpPanel } from "./ui/HelpPanel";
import { PropsPanel } from "./ui/PropsPanel";
import { TextEditor } from "./ui/TextEditor";
import { Toolbar } from "./ui/Toolbar";
import { ZoomControls } from "./ui/ZoomControls";
import {
	DEFAULT_EDITOR_OPTIONS,
	HANDLES,
	MAX_ZOOM,
	MIN_ZOOM,
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
	private destroyed = false;
	private animation: number | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private lastSize = { width: 0, height: 0 };
	/** View change requested before the canvas had a size (applied on first layout). */
	private pendingView: (() => void) | null = null;
	private internalClipboard: string | null = null;
	private pasteCount = 0;
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

		this.listen(this.doc, "copy", (e) => this.onClipboardEvent(e as ClipboardEvent, "copy"));
		this.listen(this.doc, "cut", (e) => this.onClipboardEvent(e as ClipboardEvent, "cut"));
		this.listen(this.doc, "paste", (e) => this.onClipboardEvent(e as ClipboardEvent, "paste"));

		if (typeof ResizeObserver !== "undefined") {
			this.resizeObserver = new ResizeObserver(() => this.resize());
			this.resizeObserver.observe(this.root);
		} else {
			this.win.requestAnimationFrame(() => this.resize());
		}
		this.applyGridClass();
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
		if (this.animation !== null) this.win.cancelAnimationFrame(this.animation);
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

	/**
	 * Runs a viewport change now if the canvas is laid out, otherwise on its first layout.
	 * Only the latest pending change is kept (e.g. "go to frame" wins over "zoom to fit").
	 */
	whenSized(fn: () => void): void {
		const r = this.svg.getBoundingClientRect();
		if (r.width > 0 && r.height > 0 && this.lastSize.width > 0) {
			this.pendingView = null;
			fn();
		} else {
			this.pendingView = fn;
		}
	}

	getElements(): readonly DrawElement[] {
		return this.elements;
	}

	setOptions(partial: Partial<EditorOptions>): void {
		this.options = { ...this.options, ...partial };
		this.applyGridClass();
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

	/* =========================================================== viewport */

	viewSize(): { width: number; height: number } {
		const r = this.svg.getBoundingClientRect();
		return { width: r.width || this.root.clientWidth || 800, height: r.height || this.root.clientHeight || 600 };
	}

	clientToScreen(clientX: number, clientY: number): Point {
		const r = this.svg.getBoundingClientRect();
		return { x: clientX - r.left, y: clientY - r.top };
	}

	screenToWorld(p: Point): Point {
		return { x: (p.x - this.vp.x) / this.vp.zoom, y: (p.y - this.vp.y) / this.vp.zoom };
	}

	worldToScreen(p: Point): Point {
		return { x: p.x * this.vp.zoom + this.vp.x, y: p.y * this.vp.zoom + this.vp.y };
	}

	clientToWorld(clientX: number, clientY: number): Point {
		return this.screenToWorld(this.clientToScreen(clientX, clientY));
	}

	setViewport(vp: Viewport, opts: { silent?: boolean } = {}): void {
		this.vp = { x: vp.x, y: vp.y, zoom: clamp(vp.zoom, MIN_ZOOM, MAX_ZOOM) };
		this.applyGridClass();
		this.textEditor.reposition();
		if (!opts.silent) this.onViewportChange?.(this.vp);
		this.requestRender();
	}

	panBy(dx: number, dy: number): void {
		this.stopAnimation();
		this.setViewport({ ...this.vp, x: this.vp.x + dx, y: this.vp.y + dy });
	}

	zoomAt(factor: number, screen?: Point): void {
		this.stopAnimation();
		const size = this.viewSize();
		const s = screen ?? { x: size.width / 2, y: size.height / 2 };
		const zoom = clamp(this.vp.zoom * factor, MIN_ZOOM, MAX_ZOOM);
		const w = this.screenToWorld(s);
		this.setViewport({ zoom, x: s.x - w.x * zoom, y: s.y - w.y * zoom });
	}

	zoomTo(zoom: number): void {
		this.zoomAt(zoom / this.vp.zoom);
	}

	/** Viewport that shows `b` centered with padding. */
	viewportFor(b: Bounds, padding = 48, maxZoom = 2): Viewport {
		const size = this.viewSize();
		const zoom = clamp(
			Math.min((size.width - padding * 2) / Math.max(b.width, 1), (size.height - padding * 2) / Math.max(b.height, 1)),
			MIN_ZOOM,
			maxZoom,
		);
		const c = center(b);
		return { zoom, x: size.width / 2 - c.x * zoom, y: size.height / 2 - c.y * zoom };
	}

	zoomToBounds(b: Bounds, opts: { animate?: boolean; padding?: number; maxZoom?: number } = {}): void {
		const target = this.viewportFor(b, opts.padding ?? 48, opts.maxZoom ?? 2);
		if (opts.animate === false) this.setViewport(target);
		else this.animateTo(target);
	}

	zoomToFit(opts: { animate?: boolean; maxZoom?: number } = {}): void {
		const b = contentBounds(this.elements);
		if (!b) {
			const size = this.viewSize();
			this.setViewport({ x: size.width / 2, y: size.height / 2, zoom: 1 });
			return;
		}
		this.zoomToBounds(b, { animate: opts.animate, maxZoom: opts.maxZoom ?? 1 });
	}

	zoomToSelection(): void {
		const b = this.selectionBounds();
		if (b) this.zoomToBounds(b, { maxZoom: 1.5 });
	}

	private animateTo(target: Viewport, duration = 320): void {
		this.stopAnimation();
		const start = { ...this.vp };
		const t0 = performance.now();
		const step = (now: number) => {
			if (this.destroyed) return;
			const t = Math.min(1, (now - t0) / duration);
			const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
			// interpolate zoom geometrically so the motion feels uniform
			const zoom = start.zoom * Math.pow(target.zoom / start.zoom, e);
			this.setViewport({ zoom, x: start.x + (target.x - start.x) * e, y: start.y + (target.y - start.y) * e }, { silent: t < 1 });
			this.animation = t < 1 ? this.win.requestAnimationFrame(step) : null;
		};
		this.animation = this.win.requestAnimationFrame(step);
	}

	private stopAnimation(): void {
		if (this.animation !== null) {
			this.win.cancelAnimationFrame(this.animation);
			this.animation = null;
		}
	}

	resize(): void {
		const r = this.root.getBoundingClientRect();
		if (r.width === 0 || r.height === 0) return;
		const first = this.lastSize.width === 0;
		// keep the center of the view stable when the pane is resized
		if (!first) {
			this.vp = {
				...this.vp,
				x: this.vp.x + (r.width - this.lastSize.width) / 2,
				y: this.vp.y + (r.height - this.lastSize.height) / 2,
			};
		}
		this.lastSize = { width: r.width, height: r.height };
		if (first && this.pendingView) {
			const apply = this.pendingView;
			this.pendingView = null;
			apply();
		}
		this.textEditor.reposition();
		this.requestRender();
	}

	private applyGridClass(): void {
		const gs = this.options.gridSize * this.vp.zoom;
		const step = gs < 10 ? gs * 5 : gs;
		this.canvas.style.setProperty("--bd-grid-step", `${step}px`);
		this.canvas.style.setProperty("--bd-grid-x", `${this.vp.x}px`);
		this.canvas.style.setProperty("--bd-grid-y", `${this.vp.y}px`);
		this.canvas.classList.toggle("bd-show-grid", this.options.showGrid && step >= 6);
	}

	/* ============================================================ frames */

	/** Pans/zooms to a frame. Pushes the current view so "Back" can return to it. */
	navigateToFrame(frameId: string, opts: { remember?: boolean; select?: boolean; animate?: boolean } = {}): boolean {
		const frame = this.byId.get(frameId);
		if (!isFrame(frame)) {
			this.host.notice("That frame no longer exists.");
			return false;
		}
		if (opts.remember !== false) {
			this.navStack.push({ ...this.vp });
			if (this.navStack.length > 50) this.navStack.shift();
		}
		const t = frameTitleMetrics(frame, 1);
		this.zoomToBounds({ x: frame.x, y: t.y - t.size, width: frame.width, height: frame.height + (frame.y - t.y + t.size) }, {
			animate: opts.animate,
			padding: 40,
			maxZoom: 1,
		});
		if (opts.select) this.selection = new Set([frame.id]);
		this.requestRender();
		return true;
	}

	/** Finds a frame by id or (case-insensitive) title. */
	findFrame(ref: string): FrameElement | null {
		const direct = this.byId.get(ref);
		if (isFrame(direct)) return direct;
		const needle = ref.trim().toLowerCase();
		return this.frames().find((f) => f.title.trim().toLowerCase() === needle) ?? null;
	}

	navigateBack(): void {
		const vp = this.navStack.pop();
		if (vp) this.animateTo(vp);
		this.requestRender();
	}

	/** Steps to the next/previous frame in frame order. */
	stepFrame(delta: 1 | -1): void {
		const frames = this.frames();
		if (!frames.length) return;
		const size = this.viewSize();
		const centerWorld = this.screenToWorld({ x: size.width / 2, y: size.height / 2 });
		let idx = frames.findIndex((f) => this.selection.has(f.id));
		if (idx < 0) {
			idx = frames.findIndex((f) => centerWorld.x >= f.x && centerWorld.x <= f.x + f.width && centerWorld.y >= f.y && centerWorld.y <= f.y + f.height);
		}
		const next = idx < 0 ? (delta > 0 ? 0 : frames.length - 1) : (idx + delta + frames.length) % frames.length;
		this.navigateToFrame(frames[next].id, { remember: false, select: true });
	}

	/** Follows a block's link: frames are navigated in place, other links go to the host. */
	followLink(blockId: string, newLeaf = false): void {
		const block = this.byId.get(blockId);
		if (!isBlock(block) || !block.link) return;
		const parsed = parseLink(block.link);
		if (!parsed) return;
		if (parsed.kind === "frame") this.navigateToFrame(parsed.frameId);
		else this.host.openLink(block.link, newLeaf);
	}

	/** Shows or hides a block's or connector's comment callout on the canvas. */
	toggleComment(id: string): void {
		const el = this.byId.get(id);
		if (!isBlock(el) && !isConnector(el)) return;
		this.updateElement(id, { commentOpen: !el.commentOpen });
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
		const theme = drawingThemeById(id);
		if (!theme || this.options.readOnly) return;
		const scope = this.selection.size ? new Set(this.selection) : undefined;
		this.commit(applyDrawingTheme(this.elements, theme, scope));
		this.current.block = {
			...this.current.block,
			fill: theme.fills[0],
			stroke: theme.strokes[0],
			strokeWidth: theme.strokeWidth,
			textColor: "auto",
			threeD: theme.threeD,
		};
		this.current.connector = {
			...this.current.connector,
			stroke: theme.connector === "source" ? theme.strokes[0] : theme.connector,
			strokeWidth: theme.connectorWidth,
			threeD: theme.threeD,
		};
		this.current.frame = { fill: theme.frameFill, stroke: theme.frameStroke };
		this.palette = id === "futuristic" ? "futuristic" : id === "classic" ? "classic" : id === "minimal" ? "minimal" : "3d";
		this.props.refresh();
		this.host.notice(`Applied the ${theme.name} theme to ${scope ? "the selection" : "the drawing"}. Undo with Ctrl/Cmd+Z.`);
	}

	/** Turns the 3D effect on or off for the selected blocks and connectors (all when none). */
	toggle3D(): void {
		if (this.options.readOnly) return;
		const targets = this.selection.size ? this.selectedElements() : this.elements;
		const items = targets.filter((e): e is BlockElement | ConnectorElement => isBlock(e) || isConnector(e));
		if (!items.length) return;
		const on = !items.every((e) => e.style.threeD);
		const patches = new Map<string, ElementPatch>();
		for (const e of items) patches.set(e.id, { style: { ...e.style, threeD: on } } as ElementPatch);
		this.commit(updateElements(this.elements, patches));
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
		const z = this.vp.zoom;
		const selected = this.selectedElements();
		const tolerance = 6 / z;

		if (!this.options.readOnly && this.tool === "select") {
			if (selected.length === 1) {
				const only = selected[0];
				if (isBox(only)) {
					const s = (RESIZE_HANDLE_SIZE + 6) / z;
					for (const handle of HANDLES) {
						const hp = handlePosition(only, handle, 4 / z);
						if (Math.abs(p.x - hp.x) <= s / 2 && Math.abs(p.y - hp.y) <= s / 2) return { kind: "resize", id: only.id, handle };
					}
				} else if (isConnector(only)) {
					const r = this.renderer.route(only);
					if (r) {
						if (dist(p, r.route.start) <= 9 / z) return { kind: "conn-end", id: only.id, end: "from" };
						if (dist(p, r.route.end) <= 9 / z) return { kind: "conn-end", id: only.id, end: "to" };
					}
				}
			}
		}
		const handleBlock = this.connectHandleBlockId();
		if (handleBlock) {
			const b = this.byId.get(handleBlock);
			if (isBlock(b)) {
				for (const side of SIDES) {
					const hp = add(sideAnchor(b.shape, b, side), scale(SIDE_DIR[side], CONNECT_HANDLE_OFFSET / z));
					if (dist(p, hp) <= (CONNECT_HANDLE_RADIUS + 4) / z) return { kind: "conn-handle", id: b.id, side };
				}
			}
		}

		// Connector comment badges and labels sit above blocks.
		for (let i = this.elements.length - 1; i >= 0; i--) {
			const e = this.elements[i];
			if (!isConnector(e)) continue;
			const r = this.renderer.route(e);
			if (!r) continue;
			if (e.comment.trim()) {
				const badge = connectorCommentBadgeRect(e, r.route);
				if (p.x >= badge.x && p.x <= badge.x + badge.width && p.y >= badge.y && p.y <= badge.y + badge.height) {
					return { kind: "comment-badge", id: e.id };
				}
			}
			if (!e.label.trim()) continue;
			const box = labelBox(e, r.route);
			if (p.x >= box.x && p.x <= box.x + box.width && p.y >= box.y && p.y <= box.y + box.height) {
				return { kind: "connector", id: e.id, label: true };
			}
		}

		for (let i = this.elements.length - 1; i >= 0; i--) {
			const e = this.elements[i];
			if (!isBlock(e)) continue;
			if (e.link && p.x >= e.x + e.width - 22 && p.x <= e.x + e.width && p.y >= e.y && p.y <= e.y + 22) {
				if (shapeContains("rectangle", e, p)) return { kind: "link-badge", id: e.id };
			}
			if (e.comment.trim()) {
				const b = blockCommentBadgeBox(e);
				if (p.x >= e.x + b.x && p.x <= e.x + b.x + b.size && p.y >= e.y + b.y && p.y <= e.y + b.y + b.size) {
					return { kind: "comment-badge", id: e.id };
				}
			}
			if (shapeContains(e.shape, e, p)) return { kind: "block", id: e.id };
		}

		let bestConn: { id: string; d: number } | null = null;
		for (const e of this.elements) {
			if (!isConnector(e)) continue;
			const r = this.renderer.route(e);
			if (!r) continue;
			const d = distanceToRoute(r.route, p);
			if (d <= Math.max(tolerance, e.style.strokeWidth) && (!bestConn || d < bestConn.d)) bestConn = { id: e.id, d };
		}
		if (bestConn) return { kind: "connector", id: bestConn.id, label: false };

		for (let i = this.elements.length - 1; i >= 0; i--) {
			const e = this.elements[i];
			if (!isFrame(e)) continue;
			const t = frameTitleMetrics(e, z);
			if (p.x >= t.x && p.x <= t.x + Math.max(t.width, 40 / z) && p.y >= t.y - t.size && p.y <= t.y + t.size * 0.35) {
				return { kind: "frame", id: e.id, title: true };
			}
			const inside = p.x >= e.x && p.x <= e.x + e.width && p.y >= e.y && p.y <= e.y + e.height;
			const nearEdge =
				inside &&
				(p.x - e.x <= tolerance || e.x + e.width - p.x <= tolerance || p.y - e.y <= tolerance || e.y + e.height - p.y <= tolerance);
			const outsideNear =
				!inside &&
				p.x >= e.x - tolerance &&
				p.x <= e.x + e.width + tolerance &&
				p.y >= e.y - tolerance &&
				p.y <= e.y + e.height + tolerance;
			if (nearEdge || outsideNear) return { kind: "frame", id: e.id, title: false };
		}
		return null;
	}

	/** Topmost block at a point (used as drop target while connecting). */
	blockAt(p: Point, exclude?: string, margin = 0): BlockElement | null {
		for (let i = this.elements.length - 1; i >= 0; i--) {
			const e = this.elements[i];
			if (isBlock(e) && e.id !== exclude && shapeContains(e.shape, e, p, margin)) return e;
		}
		return null;
	}

	/** Side whose anchor is close to `p` (to pin a connector end), or "auto". */
	sideNear(block: BlockElement, p: Point): AnchorSide {
		const r = 14 / this.vp.zoom;
		for (const side of SIDES) {
			if (dist(sideAnchor(block.shape, block, side), p) <= r) return side;
		}
		return "auto";
	}

	/* ========================================================== creation */

	snapValue(v: number): number {
		return this.options.snapToGrid ? snap(v, this.options.gridSize) : v;
	}

	snapPoint(p: Point): Point {
		return { x: this.snapValue(p.x), y: this.snapValue(p.y) };
	}

	makeBlock(bounds: Bounds, patch: Partial<BlockElement> = {}): BlockElement {
		return {
			id: newId(),
			type: "block",
			x: bounds.x,
			y: bounds.y,
			width: Math.max(20, bounds.width),
			height: Math.max(20, bounds.height),
			title: "",
			description: "",
			shape: this.toolShape,
			frameId: null,
			link: null,
			tag: "",
			comment: "",
			commentOpen: false,
			style: { ...this.current.block },
			...patch,
		};
	}

	/** Adds a default-size block centered on `p` and starts editing its title. */
	addBlockAt(p: Point, opts: { shape?: BlockShape; edit?: boolean } = {}): BlockElement {
		const shape = opts.shape ?? (this.tool === "block" ? this.toolShape : this.current.shape);
		const { width, height } = DEFAULT_BLOCK_SIZE;
		const topLeft = this.snapPoint({ x: p.x - width / 2, y: p.y - height / 2 });
		const block = this.makeBlock({ x: topLeft.x, y: topLeft.y, width, height }, { shape });
		this.insertBlocks([block]);
		if (opts.edit !== false) this.textEditor.start(block.id);
		return this.byId.get(block.id) as BlockElement;
	}

	insertBlocks(blocks: BlockElement[], extra: DrawElement[] = []): void {
		const next = assignFrames([...this.elements, ...blocks, ...extra], blocks.map((b) => b.id));
		this.commit(next, { selection: blocks.map((b) => b.id) });
	}

	addFrame(bounds: Bounds, opts: { edit?: boolean } = {}): FrameElement {
		const n = this.frames().length + 1;
		let title = `Frame ${n}`;
		const titles = new Set(this.frames().map((f) => f.title.toLowerCase()));
		for (let i = n; titles.has(title.toLowerCase()); i++) title = `Frame ${i + 1}`;
		const frame: FrameElement = {
			id: newId(),
			type: "frame",
			...bounds,
			title,
			description: "",
			style: { ...this.current.frame },
		};
		// Frames go below existing frames' content in the array but after other frames.
		const next = refreshFrameMembership([...this.elements, frame], frame.id);
		this.commit(next, { selection: [frame.id] });
		if (opts.edit) this.textEditor.start(frame.id);
		return frame;
	}

	/** Adds a frame to the right of all existing content and navigates to it. */
	addFrameAfterContent(): FrameElement {
		const b = contentBounds(this.elements);
		const size = this.viewSize();
		const width = Math.max(480, Math.round((size.width * 0.6) / this.vp.zoom / 20) * 20);
		const height = Math.max(320, Math.round((size.height * 0.6) / this.vp.zoom / 20) * 20);
		const x = b ? this.snapValue(b.x + b.width + 80) : 0;
		const y = b ? this.snapValue(b.y + 40) : 0;
		const frame = this.addFrame({ x, y, width, height });
		this.navigateToFrame(frame.id, { remember: false, select: true });
		return frame;
	}

	connect(fromId: string, toId: string, opts: { fromSide?: AnchorSide; toSide?: AnchorSide; select?: boolean } = {}): ConnectorElement | null {
		if (fromId === toId) return null;
		const conn: ConnectorElement = {
			id: newId(),
			type: "connector",
			from: { id: fromId, side: opts.fromSide ?? "auto" },
			to: { id: toId, side: opts.toSide ?? "auto" },
			label: "",
			routing: this.current.routing,
			comment: "",
			commentOpen: false,
			style: { ...this.current.connector },
		};
		this.commit([...this.elements, conn], { selection: opts.select ? [conn.id] : this.selection });
		return conn;
	}

	/**
	 * Creates a new block next to `fromId` (in direction `side`, or at `at`) connected to it,
	 * then starts editing its title. Mirrors draw.io's quick-connect.
	 */
	createConnectedBlock(fromId: string, side: Side | null, at?: Point): BlockElement | null {
		const from = this.byId.get(fromId);
		if (!isBlock(from)) return null;
		const gap = 80;
		let x: number;
		let y: number;
		if (at) {
			x = at.x - from.width / 2;
			y = at.y - from.height / 2;
		} else {
			const s = side ?? "right";
			x = s === "right" ? from.x + from.width + gap : s === "left" ? from.x - from.width - gap : from.x;
			y = s === "bottom" ? from.y + from.height + gap : s === "top" ? from.y - from.height - gap : from.y;
		}
		const pos = this.snapPoint({ x, y });
		const block: BlockElement = {
			...this.makeBlock({ x: pos.x, y: pos.y, width: from.width, height: from.height }),
			shape: from.shape,
			style: { ...from.style },
		};
		const conn: ConnectorElement = {
			id: newId(),
			type: "connector",
			from: { id: from.id, side: "auto" },
			to: { id: block.id, side: "auto" },
			label: "",
			routing: this.current.routing,
			comment: "",
			commentOpen: false,
			style: { ...this.current.connector },
		};
		this.insertBlocks([block], [conn]);
		this.textEditor.start(block.id);
		return block;
	}

	/* ============================================================ edits */

	deleteSelection(): void {
		if (!this.selection.size) return;
		this.commit(deleteElements(this.elements, this.selection), { selection: [] });
	}

	duplicateSelection(): void {
		if (!this.selection.size) return;
		const picked = collectForCopy(this.elements, this.selection);
		if (!picked.length) return;
		const offset = this.options.gridSize || 20;
		const { elements, idMap } = cloneElements(picked, offset, offset);
		const next = insertClones(this.elements, elements, new Set(elements.map((e) => e.id)));
		const newSel = [...this.selection].map((id) => idMap.get(id)).filter((id): id is string => !!id);
		this.commit(next, { selection: newSel });
	}

	copySelectionText(): string | null {
		if (!this.selection.size) return null;
		const picked = collectForCopy(this.elements, this.selection);
		const selectedConnectors = this.selectedConnectors().filter((c) => !picked.includes(c));
		if (!picked.length && !selectedConnectors.length) return null;
		const text = JSON.stringify(makeClipboardPayload(picked));
		this.internalClipboard = text;
		this.pasteCount = 0;
		return text;
	}

	/** Pastes Block Draw elements or plain text (as a new block) at `at` (world). */
	pasteText(text: string, at?: Point): void {
		const els = readClipboardPayload(text);
		if (els) {
			const valid = els.filter((e) => e && typeof e === "object" && typeof e.id === "string");
			const boxes = valid.filter(isBox);
			const b = unionBounds(boxes);
			let dx = 0;
			let dy = 0;
			if (b) {
				if (at) {
					const target = this.snapPoint({ x: at.x - b.width / 2, y: at.y - b.height / 2 });
					dx = target.x - b.x;
					dy = target.y - b.y;
				} else {
					this.pasteCount++;
					dx = dy = (this.options.gridSize || 20) * this.pasteCount;
				}
			}
			const { elements, idMap } = cloneElements(valid, dx, dy);
			const next = insertClones(this.elements, elements, new Set(elements.map((e) => e.id)));
			this.commit(next, { selection: [...idMap.values()].filter((id) => next.some((e) => e.id === id)) });
			return;
		}
		const clean = text.trim().slice(0, 2000);
		if (!clean) return;
		const size = this.viewSize();
		const p = at ?? this.screenToWorld({ x: size.width / 2, y: size.height / 2 });
		const block = this.makeBlock({ x: 0, y: 0, ...DEFAULT_BLOCK_SIZE }, { title: clean, shape: this.current.shape });
		const pos = this.snapPoint({ x: p.x - block.width / 2, y: p.y - block.height / 2 });
		const grown = fitBlockHeight({ ...block, x: pos.x, y: pos.y });
		this.insertBlocks([grown]);
	}

	pasteInternal(at?: Point): boolean {
		if (!this.internalClipboard) return false;
		this.pasteText(this.internalClipboard, at);
		return true;
	}

	private onClipboardEvent(e: ClipboardEvent, kind: "copy" | "cut" | "paste"): void {
		if (this.destroyed || this.options.readOnly) return;
		if (this.doc.activeElement !== this.root) return;
		if (kind === "paste") {
			const text = e.clipboardData?.getData("text/plain") ?? "";
			e.preventDefault();
			if (text) this.pasteText(text);
			else this.pasteInternal();
			return;
		}
		const text = this.copySelectionText();
		if (!text) return;
		e.preventDefault();
		e.clipboardData?.setData("text/plain", text);
		if (kind === "cut") this.deleteSelection();
	}

	nudge(dx: number, dy: number): void {
		const ids = [...this.selection];
		if (!ids.length) return;
		const moveSet = expandMoveSet(this.elements, ids);
		if (!moveSet.size) return;
		let next = translateElements(this.elements, moveSet, dx, dy);
		const direct = ids.filter((id) => {
			const e = this.byId.get(id);
			return isBlock(e) && !(e.frameId && moveSet.has(e.frameId) && this.selection.has(e.frameId));
		});
		next = assignFrames(next, direct);
		this.commit(next);
	}

	reorderSelection(mode: ZOrderMode): void {
		if (!this.selection.size) return;
		this.commit(reorderElements(this.elements, this.selection, mode));
	}

	updateElement(id: string, patch: ElementPatch, opts: CommitOptions = {}): void {
		this.commit(updateElements(this.elements, new Map([[id, patch]])), opts);
	}

	/** Applies a block style change to the selected blocks and remembers it for new blocks. */
	applyBlockStyle(patch: Partial<BlockStyle>): void {
		this.current.block = { ...this.current.block, ...patch };
		const patches = new Map<string, ElementPatch>();
		for (const b of this.selectedBlocks()) patches.set(b.id, { style: { ...b.style, ...patch } });
		if (patches.size) this.commit(updateElements(this.elements, patches));
		else this.requestRender();
	}

	applyShape(shape: BlockShape): void {
		this.current.shape = shape;
		if (this.tool === "block") this.toolShape = shape;
		const patches = new Map<string, ElementPatch>();
		for (const b of this.selectedBlocks()) patches.set(b.id, { shape });
		if (patches.size) this.commit(updateElements(this.elements, patches));
		else this.requestRender();
	}

	applyConnectorStyle(patch: Partial<ConnectorStyle>): void {
		this.current.connector = { ...this.current.connector, ...patch };
		const patches = new Map<string, ElementPatch>();
		for (const c of this.selectedConnectors()) patches.set(c.id, { style: { ...c.style, ...patch } });
		if (patches.size) this.commit(updateElements(this.elements, patches));
		else this.requestRender();
	}

	applyRouting(routing: Routing): void {
		this.current.routing = routing;
		const patches = new Map<string, ElementPatch>();
		for (const c of this.selectedConnectors()) patches.set(c.id, { routing });
		if (patches.size) this.commit(updateElements(this.elements, patches));
		else this.requestRender();
	}

	applyFrameStyle(patch: Partial<FrameStyle>): void {
		this.current.frame = { ...this.current.frame, ...patch };
		const patches = new Map<string, ElementPatch>();
		for (const f of this.selectedFrames()) patches.set(f.id, { style: { ...f.style, ...patch } });
		if (patches.size) this.commit(updateElements(this.elements, patches));
	}

	reverseConnector(id: string): void {
		const c = this.byId.get(id);
		if (!isConnector(c)) return;
		this.updateElement(id, {
			from: c.to,
			to: c.from,
			style: { ...c.style, startArrow: c.style.endArrow, endArrow: c.style.startArrow },
		});
	}

	/** Opens the link picker for a block. */
	async editLink(blockId: string): Promise<void> {
		const block = this.byId.get(blockId);
		if (!isBlock(block)) return;
		const result = await this.host.pickLink({
			current: block.link,
			frames: this.frames(),
			ownFrameId: block.frameId,
		});
		if (result === undefined || this.destroyed) return;
		const fresh = this.byId.get(blockId);
		if (!isBlock(fresh)) return;
		this.updateElement(blockId, { link: result });
	}

	linkToFrame(blockId: string, frameId: string | null): void {
		this.updateElement(blockId, { link: frameId ? frameLink(frameId) : null });
	}

	describeLink(link: string | null): string {
		const parsed = parseLink(link);
		if (!parsed) return "";
		if (parsed.kind === "frame") {
			const f = this.byId.get(parsed.frameId);
			return isFrame(f) ? `Frame: ${f.title}` : "Frame: (missing)";
		}
		if (parsed.kind === "url") return parsed.url;
		return this.host.describeLink?.(link as string) ?? parsed.display;
	}

	/** Aligns selected boxes (blocks and frames). */
	alignSelection(mode: "left" | "center" | "right" | "top" | "middle" | "bottom"): void {
		const boxes = this.elements.filter((e): e is BlockElement | FrameElement => isBox(e) && this.selection.has(e.id));
		if (boxes.length < 2) return;
		const ub = unionBounds(boxes) as Bounds;
		let next = this.elements;
		for (const b of boxes) {
			let dx = 0;
			let dy = 0;
			if (mode === "left") dx = ub.x - b.x;
			if (mode === "right") dx = ub.x + ub.width - (b.x + b.width);
			if (mode === "center") dx = ub.x + ub.width / 2 - (b.x + b.width / 2);
			if (mode === "top") dy = ub.y - b.y;
			if (mode === "bottom") dy = ub.y + ub.height - (b.y + b.height);
			if (mode === "middle") dy = ub.y + ub.height / 2 - (b.y + b.height / 2);
			if (dx || dy) next = translateElements(next, expandMoveSet(next, [b.id]), dx, dy);
		}
		next = assignFrames(next, boxes.filter(isBlock).map((b) => b.id));
		this.commit(next);
	}

	distributeSelection(axis: "h" | "v"): void {
		const boxes = this.elements.filter((e): e is BlockElement | FrameElement => isBox(e) && this.selection.has(e.id));
		if (boxes.length < 3) return;
		const sorted = [...boxes].sort((a, b) => (axis === "h" ? a.x - b.x : a.y - b.y));
		const first = sorted[0];
		const last = sorted[sorted.length - 1];
		const total = sorted.reduce((s, b) => s + (axis === "h" ? b.width : b.height), 0);
		const span = axis === "h" ? last.x + last.width - first.x : last.y + last.height - first.y;
		const gap = (span - total) / (sorted.length - 1);
		let cursor = axis === "h" ? first.x : first.y;
		let next = this.elements;
		for (const b of sorted) {
			const delta = cursor - (axis === "h" ? b.x : b.y);
			if (delta) next = translateElements(next, expandMoveSet(next, [b.id]), axis === "h" ? delta : 0, axis === "v" ? delta : 0);
			cursor += (axis === "h" ? b.width : b.height) + gap;
		}
		this.commit(assignFrames(next, sorted.filter(isBlock).map((b) => b.id)));
	}

	/* ======================================================= context menu */

	showContextMenu(screen: { x: number; y: number }, world: Point): void {
		const items: MenuItemSpec[] = [];
		const sel = this.selectedElements();
		const blocks = sel.filter(isBlock);
		const frames = sel.filter(isFrame);
		const connectors = sel.filter(isConnector);
		const ro = this.options.readOnly;

		if (sel.length === 0) {
			if (!ro) {
				items.push({ title: "Add block here", icon: "block", onClick: () => this.addBlockAt(world) });
				items.push({
					title: "Add frame here",
					icon: "frame",
					onClick: () => {
						const p = this.snapPoint(world);
						this.addFrame({ x: p.x, y: p.y, width: 480, height: 320 }, { edit: true });
					},
				});
				items.push({ title: "Paste", icon: "duplicate", onClick: () => void this.pasteFromSystem(world), separator: true });
				items.push({ title: "Select all", onClick: () => this.selectAll() });
			}
			items.push({ title: "Zoom to fit", icon: "fit", onClick: () => this.zoomToFit({ animate: true }), separator: true });
			items.push({ title: "Present", icon: "present", onClick: () => this.presenter.start() });
			if (!ro) {
				DRAWING_THEMES.forEach((t, i) => {
					items.push({
						title: `Theme: ${t.name}`,
						icon: "palette",
						onClick: () => this.applyTheme(t.id),
						...(i === 0 ? { separator: true } : {}),
					});
				});
				const allOn = this.elements.length > 0 && this.elements.filter((e) => isBlock(e) || isConnector(e)).every((e) => e.style.threeD);
				items.push({ title: "3D effect", icon: "cube", checked: allOn, onClick: () => this.toggle3D() });
			}
			items.push({
				separator: true,
				title: "Show grid",
				icon: "grid",
				checked: this.options.showGrid,
				onClick: () => this.setOptions({ showGrid: !this.options.showGrid }),
			});
			items.push({
				title: "Snap to grid",
				icon: "snap",
				checked: this.options.snapToGrid,
				onClick: () => this.setOptions({ snapToGrid: !this.options.snapToGrid }),
			});
			this.host.showMenu(items, screen);
			return;
		}

		if (blocks.length === 1 && sel.length === 1) {
			const b = blocks[0];
			if (b.link) items.push({ title: `Open link (${this.describeLink(b.link)})`, icon: "follow-link", onClick: () => this.followLink(b.id) });
			items.push({
				title: this.traceRootId === b.id ? "Hide dependencies" : "Trace dependencies",
				icon: "trace",
				onClick: () => this.toggleTrace(b.id),
			});
			if (!ro) {
				items.push({ title: "Edit text", icon: "edit", onClick: () => this.textEditor.start(b.id) });
				items.push({ title: b.link ? "Change link…" : "Link to frame or note…", icon: "link", onClick: () => void this.editLink(b.id) });
				if (b.link) items.push({ title: "Remove link", icon: "unlink", onClick: () => this.updateElement(b.id, { link: null }) });
				if (b.comment) {
					items.push({ title: b.commentOpen ? "Hide comment" : "Show comment", onClick: () => this.toggleComment(b.id) });
					items.push({ title: "Remove comment", onClick: () => this.updateElement(b.id, { comment: "", commentOpen: false }) });
				}
			}
		}
		if (frames.length === 1 && sel.length === 1) {
			const f = frames[0];
			items.push({ title: "Zoom to frame", icon: "fit", onClick: () => this.navigateToFrame(f.id) });
			if (!ro) items.push({ title: "Rename frame", icon: "edit", onClick: () => this.textEditor.start(f.id) });
		}
		if (connectors.length === 1 && sel.length === 1 && !ro) {
			const c = connectors[0];
			items.push({ title: c.label ? "Edit label" : "Add label", icon: "edit", onClick: () => this.textEditor.start(c.id) });
			if (c.comment) {
				items.push({ title: c.commentOpen ? "Hide comment" : "Show comment", onClick: () => this.toggleComment(c.id) });
				items.push({ title: "Remove comment", onClick: () => this.updateElement(c.id, { comment: "", commentOpen: false }) });
			}
			items.push({ title: "Reverse direction", onClick: () => this.reverseConnector(c.id) });
			for (const r of ["elbow", "straight", "curved"] as Routing[]) {
				items.push({
					title: `${r[0].toUpperCase()}${r.slice(1)} line`,
					checked: c.routing === r,
					onClick: () => this.applyRouting(r),
					separator: r === "elbow",
				});
			}
		}
		if (!ro) {
			if (blocks.length || connectors.length) {
				const allOn = [...blocks, ...connectors].every((e) => e.style.threeD);
				items.push({ title: "3D effect", icon: "cube", checked: allOn, onClick: () => this.toggle3D(), separator: true });
			}
			items.push({ title: "Duplicate", icon: "duplicate", onClick: () => this.duplicateSelection(), separator: true });
			items.push({
				title: "Copy",
				onClick: () => {
					const text = this.copySelectionText();
					if (text) void navigator.clipboard?.writeText(text).catch(() => undefined);
				},
			});
			items.push({ title: "Bring to front", icon: "front", onClick: () => this.reorderSelection("front"), separator: true });
			items.push({ title: "Send to back", icon: "back_layer", onClick: () => this.reorderSelection("back") });
			items.push({ title: "Delete", icon: "trash", warning: true, onClick: () => this.deleteSelection(), separator: true });
		}
		this.host.showMenu(items, screen);
	}

	async pasteFromSystem(at?: Point): Promise<void> {
		try {
			const text = await navigator.clipboard.readText();
			if (text) {
				this.pasteText(text, at);
				return;
			}
		} catch {
			// clipboard API unavailable: fall back to the in-editor clipboard
		}
		if (!this.pasteInternal(at)) this.host.notice("Nothing to paste.");
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
		this.applyGridClass();
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
			text = `${name}: ${trace.upstream.size} upstream (amber) · ${trace.downstream.size} downstream (green) — Esc to clear`;
		} else if (!this.options.readOnly) {
			const busy = this.pointer.hint();
			if (busy) text = busy;
			else if (this.editingId) text = "Enter to finish · Shift+Enter for a new line";
			else if (this.tool === "block") text = "Click or drag to add a block";
			else if (this.tool === "frame") text = "Drag to draw a frame — blocks inside it become part of it";
			else if (this.tool === "connector") text = "Drag from one block to another to connect them";
			else if (this.tool === "pan") text = "Drag to move around";
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

/** Grows a block so its text fits (never shrinks it). */
export function fitBlockHeight(block: BlockElement): BlockElement {
	const need = layoutBlockText(block).requiredHeight;
	if (need <= block.height) return block;
	return { ...block, height: Math.ceil(need / 10) * 10 };
}

function sameElements(a: readonly DrawElement[], b: readonly DrawElement[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

