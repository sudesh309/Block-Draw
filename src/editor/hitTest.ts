import { add, dist, scale, SIDE_DIR, SIDES, type Point } from "../geometry/geom";
import { distanceToRoute } from "../geometry/routing";
import { shapeContains, sideAnchor } from "../geometry/shapes";
import { isBlock, isBox, isConnector, isFrame, type AnchorSide, type BlockElement } from "../model/types";
import { blockCommentBadgeBox, connectorCommentBadgeRect, frameTitleMetrics, labelBox } from "../render/elements";
import type { Editor } from "./Editor";
import { CONNECT_HANDLE_OFFSET, CONNECT_HANDLE_RADIUS, handlePosition, RESIZE_HANDLE_SIZE } from "./renderer";
import { HANDLES, type Hit } from "./types";

/** What is under a world point? Handles first, then blocks, connectors and frames. */
export function hitTest(ed: Editor, p: Point): Hit | null {
	const z = ed.vp.zoom;
	const selected = ed.selectedElements();
	const tolerance = 6 / z;

	if (!ed.options.readOnly && ed.tool === "select") {
		if (selected.length === 1) {
			const only = selected[0];
			if (isBox(only)) {
				const s = (RESIZE_HANDLE_SIZE + 6) / z;
				for (const handle of HANDLES) {
					const hp = handlePosition(only, handle, 4 / z);
					if (Math.abs(p.x - hp.x) <= s / 2 && Math.abs(p.y - hp.y) <= s / 2) return { kind: "resize", id: only.id, handle };
				}
			} else if (isConnector(only)) {
				const r = ed.renderer.route(only);
				if (r) {
					if (dist(p, r.route.start) <= 9 / z) return { kind: "conn-end", id: only.id, end: "from" };
					if (dist(p, r.route.end) <= 9 / z) return { kind: "conn-end", id: only.id, end: "to" };
				}
			}
		}
	}
	const handleBlock = ed.connectHandleBlockId();
	if (handleBlock) {
		const b = ed.byId.get(handleBlock);
		if (isBlock(b)) {
			for (const side of SIDES) {
				const hp = add(sideAnchor(b.shape, b, side), scale(SIDE_DIR[side], CONNECT_HANDLE_OFFSET / z));
				if (dist(p, hp) <= (CONNECT_HANDLE_RADIUS + 4) / z) return { kind: "conn-handle", id: b.id, side };
			}
		}
	}

	// Connector comment badges and labels sit above blocks.
	for (let i = ed.elements.length - 1; i >= 0; i--) {
		const e = ed.elements[i];
		if (!isConnector(e)) continue;
		const r = ed.renderer.route(e);
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

	let blockId: string | null = null;
	for (let i = ed.elements.length - 1; i >= 0; i--) {
		const e = ed.elements[i];
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
		if (shapeContains(e.shape, e, p)) {
			blockId = e.id;
			break;
		}
	}

	let bestConn: { id: string; d: number } | null = null;
	for (const e of ed.elements) {
		if (!isConnector(e)) continue;
		const r = ed.renderer.route(e);
		if (!r) continue;
		const d = distanceToRoute(r.route, p);
		if (d <= Math.max(tolerance, e.style.strokeWidth) && (!bestConn || d < bestConn.d)) bestConn = { id: e.id, d };
	}
	if (bestConn) {
		// Links are drawn above blocks, so one that runs across a block (such as the container around
		// both of its ends) wins over it. Its own end blocks keep their clicks so they stay easy to grab.
		const link = ed.byId.get(bestConn.id);
		if (blockId === null || (isConnector(link) && link.from.id !== blockId && link.to.id !== blockId)) {
			return { kind: "connector", id: bestConn.id, label: false };
		}
	}
	if (blockId !== null) return { kind: "block", id: blockId };

	for (let i = ed.elements.length - 1; i >= 0; i--) {
		const e = ed.elements[i];
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
export function blockAt(ed: Editor, p: Point, exclude?: string, margin = 0): BlockElement | null {
	for (let i = ed.elements.length - 1; i >= 0; i--) {
		const e = ed.elements[i];
		if (isBlock(e) && e.id !== exclude && shapeContains(e.shape, e, p, margin)) return e;
	}
	return null;
}

/** Side whose anchor is close to `p` (to pin a connector end), or "auto". */
export function sideNear(ed: Editor, block: BlockElement, p: Point): AnchorSide {
	const r = 14 / ed.vp.zoom;
	for (const side of SIDES) {
		if (dist(sideAnchor(block.shape, block, side), p) <= r) return side;
	}
	return "auto";
}
