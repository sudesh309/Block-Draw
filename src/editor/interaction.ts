import { boundsFromPoints, type Point } from "../geometry/geom";
import { boundaryPoint, sideAnchor } from "../geometry/shapes";
import type { HistoryEntry } from "../model/history";
import { isBlock, isConnector, isFrame, type Bounds, type Side } from "../model/types";
import { h, type VNode } from "../render/vnode";
import type { Editor } from "./Editor";
import { eraseOverlay } from "./eraser";
import { bendHandles, type BendDrag } from "./routeEdit";
import type { Handle, Viewport } from "./types";

/** What a pointer that is down is doing (PointerController), with what it shows and says meanwhile. */
export type Interaction =
	/** `tap`: a finger that pans in tablet mode, which selects when it is lifted without moving. */
	| { kind: "pan"; startScreen: Point; startVp: Viewport; tap?: boolean }
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
	| { kind: "pinch"; startDist: number; startMid: Point; startVp: Viewport }
	/** The Eraser tool, or a pen's button or eraser end: what the stroke passed over is deleted when it ends. */
	| { kind: "erase"; marked: Set<string>; last: Point };

/** Previews drawn above the drawing while an interaction runs. */
export function interactionOverlay(ed: Editor, st: Interaction, z: number): VNode[] {
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
	} else if (st.kind === "erase") {
		nodes.push(...eraseOverlay(ed, st.marked, z));
	}
	return nodes;
}

/** The hint shown while an interaction runs, if it has one. */
export function interactionHint(ed: Editor, st: Interaction): string | null {
	if (st.kind === "connect") {
		return st.targetId
			? "Release to connect"
			: "Release on a block to connect it, or on empty space to create a connected block";
	}
	if (st.kind === "reconnect") return "Release on a block to re-attach this end";
	if (st.kind === "move" && st.dropFrameId) {
		const f = ed.byId.get(st.dropFrameId);
		return isFrame(f) ? `Release to move into “${f.title}”` : null;
	}
	if (st.kind === "create" && st.type === "frame") return "Blocks inside the frame become part of it";
	if (st.kind === "erase") return st.marked.size ? "Release to erase what is marked · Esc cancels" : "Draw over blocks and links to erase them";
	return null;
}
