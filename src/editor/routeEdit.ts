import { dist, type Point } from "../geometry/geom";
import { routeMidpoints, waypointIndex } from "../geometry/viaRoutes";
import type { HistoryEntry } from "../model/history";
import { MAX_WAYPOINTS } from "../model/file";
import { withWaypoints } from "../model/ops";
import { isConnector, type ConnectorElement, type DrawElement } from "../model/types";
import { h, type VNode } from "../render/vnode";
import type { Editor } from "./Editor";
import type { Hit } from "./types";

/*
 * Bending a link. A selected link shows a handle on each waypoint and a smaller grip in the middle of
 * each stretch: dragging a grip adds a waypoint there, dragging a handle moves it, double-clicking
 * a handle removes it. The route passes through the waypoints (see geometry/viaRoutes.ts).
 */

const BEND_RADIUS = 5;
const GRIP_RADIUS = 4;
/** Stretches shorter than this on screen get no grip, so short links stay uncluttered. */
const MIN_GRIP_STRETCH = 28;

/** A waypoint handle, or the grip that adds one, under `p`; only for the selected link. */
export function bendHit(ed: Editor, conn: ConnectorElement, p: Point): Hit | null {
	const entry = ed.renderer.route(conn);
	if (!entry) return null;
	const z = ed.vp.zoom;
	const via = conn.waypoints ?? [];
	for (let i = via.length - 1; i >= 0; i--) {
		if (dist(p, via[i]) <= 8 / z) return { kind: "bend", id: conn.id, index: i };
	}
	if (via.length >= MAX_WAYPOINTS) return null;
	for (const at of routeMidpoints(entry.route, MIN_GRIP_STRETCH / z)) {
		if (dist(p, at) <= 7 / z) return { kind: "bend-add", id: conn.id, at, index: waypointIndex(entry.route, via, at) };
	}
	return null;
}

/** The handles and grips of a link, for the selection overlay. */
export function bendHandles(ed: Editor, conn: ConnectorElement, z: number, grips = true): VNode[] {
	const entry = ed.renderer.route(conn);
	if (!entry) return [];
	const via = conn.waypoints ?? [];
	const nodes: VNode[] = via.map((p) => h("circle", { class: "bd-handle bd-handle-bend", cx: p.x, cy: p.y, r: BEND_RADIUS / z }));
	if (grips && via.length < MAX_WAYPOINTS) {
		for (const p of routeMidpoints(entry.route, MIN_GRIP_STRETCH / z)) {
			nodes.push(h("circle", { class: "bd-handle-grip", cx: p.x, cy: p.y, r: GRIP_RADIUS / z }));
		}
	}
	return nodes;
}

/** A drag of a waypoint handle, or of a grip (`at` is set until the new waypoint is made). */
export interface BendDrag {
	connId: string;
	index: number;
	at: Point | null;
	before: HistoryEntry;
	startScreen: Point;
	moved: boolean;
}

const withRoute = (ed: Editor, id: string, waypoints: Point[]): DrawElement[] =>
	ed.elements.map((el) => (el.id === id && isConnector(el) ? withWaypoints(el, waypoints) : el));

/** Moves the dragged waypoint to the pointer, making it first when the drag started on a grip. */
export function dragBend(ed: Editor, drag: BendDrag, world: Point, pastThreshold: boolean): void {
	const conn = ed.byId.get(drag.connId);
	if (!isConnector(conn)) return;
	if (!drag.moved) {
		if (!pastThreshold) return;
		drag.moved = true;
	}
	const via = [...(conn.waypoints ?? [])];
	if (drag.at) {
		via.splice(drag.index, 0, drag.at);
		drag.at = null;
	}
	via[drag.index] = ed.snapPoint(world);
	ed.setTransient(withRoute(ed, drag.connId, via));
}

/** Removes one waypoint: the link bends one time less. */
export function removeBend(ed: Editor, id: string, index: number): void {
	const conn = ed.byId.get(id);
	if (!isConnector(conn) || !conn.waypoints) return;
	ed.commit(withRoute(ed, id, conn.waypoints.filter((_, i) => i !== index)));
}

/** Takes the bends out of these links: each finds its own way again. One undo step. */
export function resetRoutes(ed: Editor, ids: Iterable<string>): void {
	const set = new Set(ids);
	const next = ed.elements.map((el) => (isConnector(el) && set.has(el.id) && el.waypoints ? withWaypoints(el, []) : el));
	if (next.some((el, i) => el !== ed.elements[i])) ed.commit(next);
}
