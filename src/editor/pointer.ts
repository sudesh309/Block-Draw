import { boundsFromPoints, containsPoint, dist, type Point } from "../geometry/geom";
import { boundaryPoint, sideAnchor } from "../geometry/shapes";
import type { HistoryEntry } from "../model/history";
import {
	assignFrames,
	cloneElements,
	collectForCopy,
	expandMoveSet,
	frameAt,
	insertClones,
	movingLinks,
	refreshFrameMembership,
	translateElements,
	updateElements,
} from "../model/ops";
import {
	DEFAULT_BLOCK_SIZE,
	MIN_BLOCK_SIZE,
	MIN_FRAME_SIZE,
	isBlock,
	isBox,
	isConnector,
	isFrame,
	type AnchorSide,
	type Bounds,
	type Side,
} from "../model/types";
import { h, type VNode } from "../render/vnode";
import type { Editor } from "./Editor";
import { CONNECT_HANDLE_OFFSET } from "./renderer";
import { bendHandles, dragBend, removeBend, type BendDrag } from "./routeEdit";
import type { Handle, Viewport } from "./types";

type Interaction =
	| { kind: "pan"; startScreen: Point; startVp: Viewport }
	| { kind: "marquee"; start: Point; current: Point; additive: boolean; base: Set<string>; startScreen: Point; moved: boolean }
	| {
			kind: "move";
			start: Point;
			startScreen: Point;
			moved: boolean;
			before: HistoryEntry;
			clickedId: string;
			wasSelected: boolean;
			shift: boolean;
			alt: boolean;
			moveSet: Set<string>;
			origin: Map<string, { x: number; y: number }>;
			/** Waypoints, as they were, of the links that move along with their blocks. */
			links: Map<string, Point[]>;
			anchorId: string | null;
			dropFrameId: string | null;
	  }
	| { kind: "resize"; id: string; handle: Handle; orig: Bounds; before: HistoryEntry; startScreen: Point; moved: boolean }
	| { kind: "create"; type: "block" | "frame"; start: Point; current: Point; startScreen: Point; moved: boolean }
	| { kind: "connect"; fromId: string; side: Side | null; startScreen: Point; current: Point; targetId: string | null; moved: boolean }
	| { kind: "reconnect"; connId: string; end: "from" | "to"; startScreen: Point; current: Point; targetId: string | null; moved: boolean }
	| ({ kind: "bend" } & BendDrag)
	| { kind: "pinch"; startDist: number; startMid: Point; startVp: Viewport };

const DRAG_THRESHOLD = 4;

const CURSORS: Record<Handle, string> = {
	nw: "nwse-resize",
	se: "nwse-resize",
	ne: "nesw-resize",
	sw: "nesw-resize",
	n: "ns-resize",
	s: "ns-resize",
	e: "ew-resize",
	w: "ew-resize",
};

export class PointerController {
	private state: Interaction | null = null;
	private touches = new Map<number, Point>();
	private capturedId: number | null = null;
	/** Double-tap detection for touch screens (iOS does not reliably fire dblclick). */
	private lastTap: { time: number; x: number; y: number } | null = null;
	private lastSyntheticDouble = -Infinity;

	constructor(private readonly ed: Editor) {
		const svg = ed.svg;
		ed.listen(svg, "pointerdown", (e) => this.onDown(e as PointerEvent));
		ed.listen(svg, "pointermove", (e) => this.onMove(e as PointerEvent));
		ed.listen(svg, "pointerup", (e) => this.onUp(e as PointerEvent));
		ed.listen(svg, "pointercancel", (e) => this.onCancel(e as PointerEvent));
		ed.listen(svg, "lostpointercapture", (e) => {
			if ((e as PointerEvent).pointerId === this.capturedId) this.capturedId = null;
		});
		ed.listen(svg, "pointerleave", () => {
			if (!this.state && this.ed.hoverId) {
				this.ed.hoverId = null;
				this.ed.requestRender();
			}
		});
		ed.listen(svg, "dblclick", (e) => this.onDblClick(e as MouseEvent));
		ed.listen(svg, "wheel", (e) => this.onWheel(e as WheelEvent), { passive: false });
		ed.listen(svg, "contextmenu", (e) => this.onContextMenu(e as MouseEvent));
	}

	isBusy(): boolean {
		return this.state !== null && this.state.kind !== "pan" && this.state.kind !== "pinch";
	}

	isConnecting(): boolean {
		return this.state?.kind === "connect" || this.state?.kind === "reconnect";
	}

	/** Aborts the current gesture and reverts its transient changes. */
	cancel(): boolean {
		const st = this.state;
		if (!st) return false;
		this.state = null;
		if ((st.kind === "move" || st.kind === "resize" || st.kind === "bend") && st.moved) this.ed.setTransient(st.before.elements);
		this.release();
		this.ed.requestRender();
		return true;
	}

	private capture(e: PointerEvent): void {
		try {
			this.ed.svg.setPointerCapture(e.pointerId);
			this.capturedId = e.pointerId;
		} catch {
			// capture can fail for synthetic events; dragging still works while inside the canvas
		}
	}

	private release(): void {
		if (this.capturedId !== null) {
			try {
				this.ed.svg.releasePointerCapture(this.capturedId);
			} catch {
				// already released
			}
			this.capturedId = null;
		}
	}

	/* ------------------------------------------------------------- down */

	private onDown(e: PointerEvent): void {
		const ed = this.ed;
		if (e.button !== 0 && e.button !== 1) return;
		ed.root.focus({ preventScroll: true });
		if (ed.editingId) ed.textEditor.commit();
		const screen = ed.clientToScreen(e.clientX, e.clientY);
		const world = ed.screenToWorld(screen);

		if (e.pointerType === "touch") {
			this.touches.set(e.pointerId, screen);
			if (this.touches.size >= 2) {
				this.startPinch();
				return;
			}
		}

		if (e.button === 1 || ed.tool === "pan" || ed.keyboard.spaceDown) {
			e.preventDefault();
			this.state = { kind: "pan", startScreen: screen, startVp: { ...ed.vp } };
			ed.root.classList.add("is-panning");
			this.capture(e);
			return;
		}

		if (ed.options.readOnly) {
			const hit = ed.hitTest(world);
			if (hit && (hit.kind === "link-badge" || hit.kind === "block")) {
				const b = ed.byId.get(hit.id);
				if (isBlock(b) && b.link) {
					ed.followLink(b.id, e.ctrlKey || e.metaKey);
					return;
				}
			}
			this.state = { kind: "pan", startScreen: screen, startVp: { ...ed.vp } };
			this.capture(e);
			return;
		}

		if (ed.tool === "block" || ed.tool === "frame") {
			this.state = { kind: "create", type: ed.tool, start: world, current: world, startScreen: screen, moved: false };
			this.capture(e);
			ed.requestRender();
			return;
		}

		if (ed.tool === "connector") {
			const hit = ed.hitTest(world);
			if (hit && (hit.kind === "block" || hit.kind === "link-badge" || hit.kind === "conn-handle")) {
				this.state = { kind: "connect", fromId: hit.id, side: null, startScreen: screen, current: world, targetId: null, moved: false };
				this.capture(e);
			} else if (hit && hit.kind === "connector") {
				ed.setSelection([hit.id]);
			}
			ed.requestRender();
			return;
		}

		this.downSelect(e, world, screen);
	}

	private downSelect(e: PointerEvent, world: Point, screen: Point): void {
		const ed = this.ed;
		const hit = ed.hitTest(world);
		if (!hit) {
			if (!e.shiftKey) ed.selection = new Set();
			this.state = {
				kind: "marquee",
				start: world,
				current: world,
				additive: e.shiftKey,
				base: new Set(ed.selection),
				startScreen: screen,
				moved: false,
			};
			this.capture(e);
			ed.requestRender();
			return;
		}
		switch (hit.kind) {
			case "resize": {
				const el = ed.byId.get(hit.id);
				if (!isBox(el)) return;
				this.state = {
					kind: "resize",
					id: el.id,
					handle: hit.handle,
					orig: { x: el.x, y: el.y, width: el.width, height: el.height },
					before: ed.snapshot(),
					startScreen: screen,
					moved: false,
				};
				break;
			}
			case "conn-handle":
				this.state = { kind: "connect", fromId: hit.id, side: hit.side, startScreen: screen, current: world, targetId: null, moved: false };
				break;
			case "conn-end":
				this.state = { kind: "reconnect", connId: hit.id, end: hit.end, startScreen: screen, current: world, targetId: null, moved: false };
				break;
			case "bend":
			case "bend-add":
				this.state = {
					kind: "bend",
					connId: hit.id,
					index: hit.index,
					at: hit.kind === "bend-add" ? hit.at : null,
					before: ed.snapshot(),
					startScreen: screen,
					moved: false,
				};
				break;
			case "link-badge":
				ed.followLink(hit.id, e.ctrlKey || e.metaKey);
				return;
			case "comment-badge":
				ed.toggleComment(hit.id);
				return;
			case "connector":
				if (e.shiftKey) ed.toggleSelection(hit.id);
				else ed.setSelection([hit.id]);
				return;
			case "block":
			case "frame": {
				const el = ed.byId.get(hit.id);
				if (isBlock(el) && el.link && (e.ctrlKey || e.metaKey)) {
					ed.followLink(el.id, e.shiftKey);
					return;
				}
				const wasSelected = ed.selection.has(hit.id);
				if (e.shiftKey) {
					const next = new Set(ed.selection);
					if (wasSelected) next.delete(hit.id);
					else next.add(hit.id);
					ed.selection = next;
				} else if (!wasSelected) {
					ed.selection = new Set([hit.id]);
				}
				this.state = {
					kind: "move",
					start: world,
					startScreen: screen,
					moved: false,
					before: ed.snapshot(),
					clickedId: hit.id,
					wasSelected,
					shift: e.shiftKey,
					alt: e.altKey,
					moveSet: new Set(),
					origin: new Map(),
					links: new Map(),
					anchorId: null,
					dropFrameId: null,
				};
				break;
			}
		}
		this.capture(e);
		ed.requestRender();
	}

	/* ------------------------------------------------------------- move */

	private onMove(e: PointerEvent): void {
		const ed = this.ed;
		const screen = ed.clientToScreen(e.clientX, e.clientY);
		const world = ed.screenToWorld(screen);
		if (e.pointerType === "touch" && this.touches.has(e.pointerId)) {
			this.touches.set(e.pointerId, screen);
			if (this.state?.kind === "pinch") {
				this.updatePinch();
				return;
			}
		}
		const st = this.state;
		if (!st) {
			if (e.pointerType !== "touch") this.updateHover(world);
			return;
		}
		const beyond = (start: Point) => dist(screen, start) >= DRAG_THRESHOLD;
		switch (st.kind) {
			case "pan":
				ed.setViewport({
					zoom: st.startVp.zoom,
					x: st.startVp.x + (screen.x - st.startScreen.x),
					y: st.startVp.y + (screen.y - st.startScreen.y),
				});
				return;
			case "marquee": {
				st.current = world;
				if (!st.moved && !beyond(st.startScreen)) return;
				st.moved = true;
				const rect = boundsFromPoints(st.start, st.current);
				const next = new Set(st.additive ? st.base : []);
				for (const id of this.idsInRect(rect)) next.add(id);
				ed.selection = next;
				ed.requestRender();
				return;
			}
			case "move":
				if (!st.moved && !beyond(st.startScreen)) return;
				if (!st.moved) this.beginMove(st);
				this.updateMove(st, world, e.shiftKey);
				return;
			case "resize":
				if (!st.moved && !beyond(st.startScreen)) return;
				st.moved = true;
				this.updateResize(st, world, e.shiftKey);
				return;
			case "create":
				st.current = world;
				if (!st.moved && beyond(st.startScreen)) st.moved = true;
				ed.requestRender();
				return;
			case "connect": {
				st.current = world;
				if (!st.moved && beyond(st.startScreen)) st.moved = true;
				st.targetId = ed.blockAt(world, st.fromId, 6 / ed.vp.zoom)?.id ?? null;
				ed.requestRender();
				return;
			}
			case "bend":
				dragBend(ed, st, world, beyond(st.startScreen));
				return;
			case "reconnect": {
				st.current = world;
				if (!st.moved && beyond(st.startScreen)) st.moved = true;
				const conn = ed.byId.get(st.connId);
				if (!isConnector(conn)) return;
				const other = st.end === "from" ? conn.to.id : conn.from.id;
				st.targetId = ed.blockAt(world, other, 6 / ed.vp.zoom)?.id ?? null;
				ed.requestRender();
				return;
			}
		}
	}

	private beginMove(st: Extract<Interaction, { kind: "move" }>): void {
		const ed = this.ed;
		st.moved = true;
		if (st.alt) {
			// Alt+drag duplicates the selection and drags the copy.
			const picked = collectForCopy(ed.elements, ed.selection);
			const { elements, idMap } = cloneElements(picked, 0, 0);
			const next = insertClones(ed.elements, elements, new Set(elements.map((e) => e.id)));
			ed.selection = new Set([...ed.selection].map((id) => idMap.get(id)).filter((id): id is string => !!id));
			st.clickedId = idMap.get(st.clickedId) ?? st.clickedId;
			ed.setTransient(next);
		}
		st.moveSet = expandMoveSet(ed.elements, ed.selection);
		st.links = movingLinks(ed.elements, st.moveSet);
		for (const id of st.moveSet) {
			const el = ed.byId.get(id);
			if (isBox(el)) st.origin.set(id, { x: el.x, y: el.y });
		}
		const clicked = ed.byId.get(st.clickedId);
		st.anchorId = isBox(clicked) && st.moveSet.has(clicked.id) ? clicked.id : ([...st.moveSet][0] ?? null);
	}

	private updateMove(st: Extract<Interaction, { kind: "move" }>, world: Point, shift: boolean): void {
		const ed = this.ed;
		let dx = world.x - st.start.x;
		let dy = world.y - st.start.y;
		if (shift) {
			// constrain to the dominant axis
			if (Math.abs(dx) > Math.abs(dy)) dy = 0;
			else dx = 0;
		}
		const anchor = st.anchorId ? st.origin.get(st.anchorId) : null;
		if (anchor && ed.options.snapToGrid) {
			dx = ed.snapValue(anchor.x + dx) - anchor.x;
			dy = ed.snapValue(anchor.y + dy) - anchor.y;
		}
		const next = translateElements(ed.elements, st.moveSet, dx, dy, st.origin, st.links);
		ed.setTransient(next);
		// Highlight the frame that will adopt the dragged block.
		const anchorEl = st.anchorId ? ed.byId.get(st.anchorId) : null;
		st.dropFrameId = null;
		if (isBlock(anchorEl) && !(anchorEl.frameId && st.moveSet.has(anchorEl.frameId) && isFrame(ed.byId.get(anchorEl.frameId)))) {
			const frame = frameAt(ed.elements, { x: anchorEl.x + anchorEl.width / 2, y: anchorEl.y + anchorEl.height / 2 }, st.moveSet);
			if (frame && frame.id !== anchorEl.frameId) st.dropFrameId = frame.id;
		}
	}

	private updateResize(st: Extract<Interaction, { kind: "resize" }>, world: Point, keepRatio: boolean): void {
		const ed = this.ed;
		const el = ed.byId.get(st.id);
		if (!isBox(el)) return;
		const min = isFrame(el) ? MIN_FRAME_SIZE : MIN_BLOCK_SIZE;
		const o = st.orig;
		let x0 = o.x;
		let y0 = o.y;
		let x1 = o.x + o.width;
		let y1 = o.y + o.height;
		const hnd = st.handle;
		if (hnd.includes("w")) x0 = Math.min(ed.snapValue(world.x), x1 - min);
		if (hnd.includes("e")) x1 = Math.max(ed.snapValue(world.x), x0 + min);
		if (hnd.includes("n")) y0 = Math.min(ed.snapValue(world.y), y1 - min);
		if (hnd.includes("s")) y1 = Math.max(ed.snapValue(world.y), y0 + min);
		if (keepRatio && hnd.length === 2 && o.width > 0 && o.height > 0) {
			const ratio = o.width / o.height;
			const w = x1 - x0;
			const hgt = y1 - y0;
			if (w / hgt > ratio) {
				const nw = hgt * ratio;
				if (hnd.includes("w")) x0 = x1 - nw;
				else x1 = x0 + nw;
			} else {
				const nh = w / ratio;
				if (hnd.includes("n")) y0 = y1 - nh;
				else y1 = y0 + nh;
			}
		}
		ed.setTransient(updateElements(ed.elements, new Map([[st.id, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }]])));
	}

	private updateHover(world: Point): void {
		const ed = this.ed;
		const hit = ed.hitTest(world);
		let hover: string | null = null;
		if (hit && (hit.kind === "block" || hit.kind === "link-badge" || hit.kind === "comment-badge" || hit.kind === "conn-handle")) hover = hit.id;
		else if (ed.hoverId) {
			const cur = ed.byId.get(ed.hoverId);
			if (isBlock(cur) && containsPoint(cur, world, (CONNECT_HANDLE_OFFSET + 12) / ed.vp.zoom)) hover = cur.id;
		}
		if (hover !== ed.hoverId) {
			ed.hoverId = hover;
			ed.requestRender();
		}
		let cursor = "";
		if (ed.tool === "select") {
			if (hit?.kind === "resize") cursor = CURSORS[hit.handle];
			else if (hit?.kind === "conn-handle" || hit?.kind === "conn-end") cursor = "crosshair";
			else if (hit?.kind === "link-badge" || hit?.kind === "comment-badge" || hit?.kind === "connector") cursor = "pointer";
			else if (hit?.kind === "block" || hit?.kind === "frame" || hit?.kind === "bend" || hit?.kind === "bend-add") cursor = "move";
		}
		if (ed.presenter.laserVisible()) cursor = "none";
		// CSS maps data-cursor to the real cursor, so the tool and panning rules can override it.
		if ((ed.svg.dataset.cursor ?? "") !== cursor) {
			if (cursor) ed.svg.dataset.cursor = cursor;
			else delete ed.svg.dataset.cursor;
		}
	}

	private idsInRect(rect: Bounds): string[] {
		const ed = this.ed;
		const ids: string[] = [];
		const inside = (b: Bounds) =>
			b.x >= rect.x && b.y >= rect.y && b.x + b.width <= rect.x + rect.width && b.y + b.height <= rect.y + rect.height;
		for (const el of ed.elements) {
			if (isBox(el)) {
				if (inside(el)) ids.push(el.id);
			} else {
				const r = ed.renderer.route(el);
				if (r && inside(r.route.bounds)) ids.push(el.id);
			}
		}
		return ids;
	}

	/* --------------------------------------------------------------- up */

	private onUp(e: PointerEvent): void {
		const ed = this.ed;
		if (e.pointerType === "touch") {
			this.touches.delete(e.pointerId);
			if (this.state?.kind === "pinch") {
				if (this.touches.size < 2) {
					this.state = null;
					this.release();
				}
				return;
			}
		}
		const st = this.state;
		if (!st) return;
		this.state = null;
		this.release();
		ed.root.classList.remove("is-panning");
		const world = ed.clientToWorld(e.clientX, e.clientY);
		if (e.pointerType === "touch" && (st.kind === "move" || st.kind === "marquee") && !st.moved) this.registerTap(e);

		switch (st.kind) {
			case "pan":
				break;
			case "marquee":
				break;
			case "move": {
				if (!st.moved) {
					if (!st.shift && st.wasSelected && ed.selection.size > 1) ed.selection = new Set([st.clickedId]);
					break;
				}
				const direct = [...st.moveSet].filter((id) => {
					const el = ed.byId.get(id);
					return isBlock(el) && !(el.frameId && st.moveSet.has(el.frameId) && isFrame(ed.byId.get(el.frameId)));
				});
				ed.commit(assignFrames(ed.elements, direct), { before: st.before });
				break;
			}
			case "resize": {
				if (!st.moved) break;
				const el = ed.byId.get(st.id);
				let next = ed.elements;
				if (isFrame(el)) next = refreshFrameMembership(next, el.id);
				else if (isBlock(el)) next = assignFrames(next, [el.id]);
				ed.commit(next, { before: st.before });
				break;
			}
			case "create":
				this.finishCreate(st);
				break;
			case "connect": {
				if (st.targetId) {
					const target = ed.byId.get(st.targetId);
					const toSide: AnchorSide = isBlock(target) ? ed.sideNear(target, world) : "auto";
					ed.connect(st.fromId, st.targetId, { toSide });
				} else if (!st.moved && st.side) {
					ed.createConnectedBlock(st.fromId, st.side);
				} else if (st.moved) {
					ed.createConnectedBlock(st.fromId, null, ed.snapPoint(world));
				}
				if (ed.tool === "connector") ed.setTool("select");
				break;
			}
			case "bend":
				if (st.moved) ed.commit(ed.elements, { before: st.before });
				break;
			case "reconnect": {
				const conn = ed.byId.get(st.connId);
				if (st.targetId && isConnector(conn)) {
					const target = ed.byId.get(st.targetId);
					const side: AnchorSide = isBlock(target) ? ed.sideNear(target, world) : "auto";
					ed.updateElement(conn.id, { [st.end]: { id: st.targetId, side } }, { selection: [conn.id] });
				}
				break;
			}
			case "pinch":
				break;
		}
		ed.requestRender();
	}

	private finishCreate(st: Extract<Interaction, { kind: "create" }>): void {
		const ed = this.ed;
		const a = ed.snapPoint(st.start);
		const b = ed.snapPoint(st.current);
		const rect = boundsFromPoints(a, b);
		if (st.type === "block") {
			let block;
			if (st.moved && rect.width >= 10 && rect.height >= 10) {
				block = ed.makeBlock(rect);
			} else {
				const { width, height } = DEFAULT_BLOCK_SIZE;
				const p = ed.snapPoint({ x: st.start.x - width / 2, y: st.start.y - height / 2 });
				block = ed.makeBlock({ x: p.x, y: p.y, width, height });
			}
			ed.insertBlocks([block]);
			ed.setTool("select");
			ed.textEditor.start(block.id);
		} else {
			const bounds =
				st.moved && rect.width >= MIN_FRAME_SIZE && rect.height >= MIN_FRAME_SIZE
					? rect
					: { ...ed.snapPoint({ x: st.start.x, y: st.start.y }), width: 480, height: 320 };
			ed.setTool("select");
			ed.addFrame(bounds, { edit: true });
		}
	}

	private onCancel(e: PointerEvent): void {
		this.touches.delete(e.pointerId);
		if (this.state?.kind === "pinch" && this.touches.size >= 2) return;
		this.cancel();
	}

	/* ------------------------------------------------------------ pinch */

	private startPinch(): void {
		this.cancel();
		const pts = [...this.touches.values()].slice(0, 2);
		this.state = {
			kind: "pinch",
			startDist: Math.max(1, dist(pts[0], pts[1])),
			startMid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
			startVp: { ...this.ed.vp },
		};
	}

	private updatePinch(): void {
		const st = this.state;
		if (st?.kind !== "pinch") return;
		const pts = [...this.touches.values()].slice(0, 2);
		if (pts.length < 2) return;
		const d = Math.max(1, dist(pts[0], pts[1]));
		const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
		const zoom = Math.min(4, Math.max(0.1, (st.startVp.zoom * d) / st.startDist));
		const wx = (st.startMid.x - st.startVp.x) / st.startVp.zoom;
		const wy = (st.startMid.y - st.startVp.y) / st.startVp.zoom;
		this.ed.setViewport({ zoom, x: mid.x - wx * zoom, y: mid.y - wy * zoom });
	}

	/* ------------------------------------------------- other mouse input */

	private registerTap(e: PointerEvent): void {
		const now = performance.now();
		const prev = this.lastTap;
		if (prev && now - prev.time < 350 && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 24) {
			this.lastTap = null;
			this.lastSyntheticDouble = now;
			this.handleDouble(e.clientX, e.clientY);
		} else {
			this.lastTap = { time: now, x: e.clientX, y: e.clientY };
		}
	}

	private onDblClick(e: MouseEvent): void {
		// Already handled as a double tap.
		if (performance.now() - this.lastSyntheticDouble < 600) return;
		this.handleDouble(e.clientX, e.clientY);
	}

	private handleDouble(clientX: number, clientY: number): void {
		const ed = this.ed;
		if (ed.options.readOnly || ed.tool !== "select") return;
		const world = ed.clientToWorld(clientX, clientY);
		const hit = ed.hitTest(world);
		if (hit?.kind === "bend") {
			removeBend(ed, hit.id, hit.index);
		} else if (hit?.kind === "bend-add") {
			// The grip sits on the middle of the line, where people double-click to label it.
			ed.textEditor.start(hit.id);
		} else if (hit && (hit.kind === "block" || hit.kind === "link-badge" || hit.kind === "comment-badge" || hit.kind === "connector")) {
			ed.setSelection([hit.id]);
			ed.textEditor.start(hit.id);
		} else if (hit && hit.kind === "frame" && hit.title) {
			ed.setSelection([hit.id]);
			ed.textEditor.start(hit.id);
		} else if (!hit || hit.kind === "frame") {
			ed.addBlockAt(world);
		}
	}

	private onWheel(e: WheelEvent): void {
		const ed = this.ed;
		e.preventDefault();
		let dx = e.deltaX;
		let dy = e.deltaY;
		if (e.deltaMode === 1) {
			dx *= 16;
			dy *= 16;
		} else if (e.deltaMode === 2) {
			dx *= 400;
			dy *= 400;
		}
		if (e.ctrlKey || e.metaKey) {
			const k = Math.abs(dy) > 40 ? 0.002 : 0.01;
			ed.zoomAt(Math.exp(-dy * k), ed.clientToScreen(e.clientX, e.clientY));
			return;
		}
		if (e.shiftKey && dx === 0) ed.panBy(-dy, 0);
		else ed.panBy(-dx, -dy);
	}

	private onContextMenu(e: MouseEvent): void {
		const ed = this.ed;
		e.preventDefault();
		if (this.state) return;
		const world = ed.clientToWorld(e.clientX, e.clientY);
		const hit = ed.hitTest(world);
		if (hit && hit.kind !== "conn-handle") {
			if (!ed.selection.has(hit.id)) ed.selection = new Set([hit.id]);
		} else if (!hit) {
			ed.selection = new Set();
		}
		ed.requestRender();
		ed.showContextMenu({ x: e.clientX, y: e.clientY }, world);
	}

	/* ---------------------------------------------------------- overlay */

	overlayNodes(z: number): VNode[] {
		const st = this.state;
		const ed = this.ed;
		if (!st) return [];
		const nodes: VNode[] = [];
		if (st.kind === "marquee" && st.moved) {
			const r = boundsFromPoints(st.start, st.current);
			nodes.push(h("rect", { class: "bd-marquee", x: r.x, y: r.y, width: r.width, height: r.height }));
		} else if (st.kind === "create" && st.moved) {
			const r = boundsFromPoints(ed.snapPoint(st.start), ed.snapPoint(st.current));
			nodes.push(
				h("rect", {
					class: st.type === "frame" ? "bd-create-preview bd-create-frame" : "bd-create-preview",
					x: r.x,
					y: r.y,
					width: r.width,
					height: r.height,
					rx: st.type === "frame" ? 8 : 6,
				}),
			);
		} else if (st.kind === "connect" || st.kind === "reconnect") {
			let fromPoint: Point | null = null;
			if (st.kind === "connect") {
				const from = ed.byId.get(st.fromId);
				if (isBlock(from)) fromPoint = st.side ? sideAnchor(from.shape, from, st.side) : boundaryPoint(from.shape, from, st.current);
			} else {
				const conn = ed.byId.get(st.connId);
				const fixedId = isConnector(conn) ? (st.end === "from" ? conn.to.id : conn.from.id) : null;
				const fixed = fixedId ? ed.byId.get(fixedId) : null;
				if (isBlock(fixed)) fromPoint = boundaryPoint(fixed.shape, fixed, st.current);
			}
			const target = st.targetId ? ed.byId.get(st.targetId) : null;
			if (isBlock(target)) {
				nodes.push(
					h("rect", {
						class: "bd-drop-target",
						x: target.x - 4 / z,
						y: target.y - 4 / z,
						width: target.width + 8 / z,
						height: target.height + 8 / z,
						rx: 6 / z,
					}),
				);
				for (const side of ["top", "right", "bottom", "left"] as Side[]) {
					const p = sideAnchor(target.shape, target, side);
					nodes.push(h("circle", { class: "bd-drop-anchor", cx: p.x, cy: p.y, r: 4 / z }));
				}
			}
			if (fromPoint && (st.moved || st.kind === "reconnect")) {
				nodes.push(h("line", { class: "bd-connect-preview", x1: fromPoint.x, y1: fromPoint.y, x2: st.current.x, y2: st.current.y }));
			}
		} else if (st.kind === "bend" && st.moved) {
			const conn = ed.byId.get(st.connId);
			if (isConnector(conn)) nodes.push(...bendHandles(ed, conn, z, false));
		} else if (st.kind === "move" && st.dropFrameId) {
			const f = ed.byId.get(st.dropFrameId);
			if (isFrame(f)) {
				nodes.push(h("rect", { class: "bd-drop-frame", x: f.x, y: f.y, width: f.width, height: f.height, rx: 8 }));
			}
		}
		return nodes;
	}

	hint(): string | null {
		const st = this.state;
		if (!st) return null;
		if (st.kind === "connect") {
			return st.targetId
				? "Release to connect"
				: "Release on a block to connect it, or on empty space to create a connected block";
		}
		if (st.kind === "reconnect") return "Release on a block to re-attach this end";
		if (st.kind === "move" && st.dropFrameId) {
			const f = this.ed.byId.get(st.dropFrameId);
			return isFrame(f) ? `Release to move into “${f.title}”` : null;
		}
		if (st.kind === "create" && st.type === "frame") return "Blocks inside the frame become part of it";
		return null;
	}
}
