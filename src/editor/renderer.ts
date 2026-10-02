import { add, expand, scale, SIDE_DIR, SIDES, unionBounds } from "../geometry/geom";
import { routePathData, type Route } from "../geometry/routing";
import { sideAnchor } from "../geometry/shapes";
import { traceMembers, type DependencyTrace } from "../model/graph";
import { parseFrameLink } from "../model/links";
import { isBlock, isBox, isConnector, isFrame, type BlockElement, type ConnectorElement } from "../model/types";
import { SCREEN_THEME } from "../render/colors";
import {
	renderBlock,
	renderBlockCommentCallout,
	renderConnector,
	renderConnectorCommentBadge,
	renderConnectorCommentCallout,
	renderConnectorLabel,
	renderFrame,
	routeFor,
	flowDirection,
	type RenderOptions,
} from "../render/elements";
import { h, toDom, type VNode } from "../render/vnode";
import { svgEl } from "./dom";
import type { Editor } from "./Editor";
import { HANDLES, type Handle } from "./types";

interface LayerItem {
	id: string;
	deps: readonly unknown[];
	build: () => VNode;
}

/** Keyed SVG layer: nodes are rebuilt only when their dependencies change. */
class Layer {
	private nodes = new Map<string, { node: Element; deps: readonly unknown[] }>();

	constructor(readonly g: SVGGElement) {}

	sync(items: LayerItem[]): void {
		const seen = new Set<string>();
		let prev: Node | null = null;
		for (const item of items) {
			seen.add(item.id);
			let entry = this.nodes.get(item.id);
			if (!entry || !sameDeps(entry.deps, item.deps)) {
				const node = toDom(item.build()) as Element;
				if (entry && entry.node.parentNode) entry.node.replaceWith(node);
				entry = { node, deps: item.deps };
				this.nodes.set(item.id, entry);
			}
			const expected: Node | null = prev ? prev.nextSibling : this.g.firstChild;
			if (expected !== entry.node) this.g.insertBefore(entry.node, expected);
			prev = entry.node;
		}
		for (const [id, entry] of this.nodes) {
			if (!seen.has(id)) {
				entry.node.remove();
				this.nodes.delete(id);
			}
		}
	}

	clear(): void {
		for (const entry of this.nodes.values()) entry.node.remove();
		this.nodes.clear();
	}

	forEach(fn: (id: string, node: Element) => void): void {
		for (const [id, entry] of this.nodes) fn(id, entry.node);
	}
}

function sameDeps(a: readonly unknown[], b: readonly unknown[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

export interface RouteEntry {
	conn: ConnectorElement;
	from: BlockElement;
	to: BlockElement;
	route: Route;
}

export const CONNECT_HANDLE_OFFSET = 16;
export const CONNECT_HANDLE_RADIUS = 6;
export const RESIZE_HANDLE_SIZE = 9;

export class SceneRenderer {
	private readonly frames: Layer;
	private readonly connectors: Layer;
	private readonly labels: Layer;
	private readonly blocks: Layer;
	/** Comment callouts: its own layer on top of everything else, so they are never obscured. */
	private readonly comments: Layer;
	readonly overlay: SVGGElement;
	private routes = new Map<string, RouteEntry>();

	constructor(
		private readonly ed: Editor,
		viewport: SVGGElement,
	) {
		this.frames = new Layer(svgEl("g", { class: "bd-layer-frames" }, viewport));
		this.connectors = new Layer(svgEl("g", { class: "bd-layer-connectors" }, viewport));
		this.labels = new Layer(svgEl("g", { class: "bd-layer-labels" }, viewport));
		this.blocks = new Layer(svgEl("g", { class: "bd-layer-blocks" }, viewport));
		this.comments = new Layer(svgEl("g", { class: "bd-layer-comments" }, viewport));
		this.overlay = svgEl("g", { class: "bd-layer-overlay" }, viewport);
	}

	/** Route of a connector, cached until the connector or one of its blocks changes. */
	route(conn: ConnectorElement): RouteEntry | null {
		const from = this.ed.byId.get(conn.from.id);
		const to = this.ed.byId.get(conn.to.id);
		if (!isBlock(from) || !isBlock(to)) return null;
		const cached = this.routes.get(conn.id);
		if (cached && cached.conn === conn && cached.from === from && cached.to === to) return cached;
		const entry = { conn, from, to, route: routeFor(conn, from, to) };
		this.routes.set(conn.id, entry);
		return entry;
	}

	reset(): void {
		this.frames.clear();
		this.connectors.clear();
		this.labels.clear();
		this.blocks.clear();
		this.comments.clear();
		this.routes.clear();
	}

	render(): void {
		const ed = this.ed;
		const zoom = ed.vp.zoom;
		const trace = ed.currentTrace();
		const opts: RenderOptions = {
			theme: SCREEN_THEME,
			zoom,
			interactive: true,
			editingId: ed.editingId,
			tracedLinks: trace?.connectors,
			frameTitle: (id) => {
				const f = ed.byId.get(id);
				return isFrame(f) ? f.title : null;
			},
		};
		const frames: LayerItem[] = [];
		const connectors: LayerItem[] = [];
		const labels: LayerItem[] = [];
		const blocks: LayerItem[] = [];
		const comments: LayerItem[] = [];
		const live = new Set<string>();
		for (const el of ed.elements) {
			const editing = ed.editingId === el.id;
			if (isFrame(el)) {
				frames.push({ id: el.id, deps: [el, zoom, editing], build: () => renderFrame(el, opts) });
			} else if (isBlock(el)) {
				const target = parseFrameLink(el.link);
				const linked = target ? ed.byId.get(target) : null;
				const open = ed.presenter.commentOpen(el);
				const shown = open === el.commentOpen ? el : { ...el, commentOpen: open };
				blocks.push({ id: el.id, deps: [el, editing, linked, open], build: () => renderBlock(shown, opts) });
				if (el.comment.trim() && open) {
					comments.push({ id: el.id, deps: [el, open], build: () => renderBlockCommentCallout(shown, opts) ?? h("g", {}) });
				}
			} else {
				const entry = this.route(el);
				if (!entry) continue;
				live.add(el.id);
				// Only links that flow both ways or backwards look different while a trace animates them.
				const traced = !!trace?.connectors.has(el.id) && flowDirection(el.style) !== "forward";
				connectors.push({
					id: el.id,
					deps: [el, entry.from, entry.to, traced],
					build: () => renderConnector(el, entry.from, entry.to, opts, entry.route),
				});
				if (el.label.trim()) {
					labels.push({
						id: el.id,
						deps: [el, entry.from, entry.to, editing],
						build: () => renderConnectorLabel(el, entry.route, opts) ?? h("g", {}),
					});
				}
				if (el.comment.trim()) {
					const open = ed.presenter.commentOpen(el);
					const shown = open === el.commentOpen ? el : { ...el, commentOpen: open };
					labels.push({
						id: `${el.id}:comment`,
						deps: [el, entry.from, entry.to, open],
						build: () => renderConnectorCommentBadge(shown, entry.route, opts) ?? h("g", {}),
					});
					if (open) {
						comments.push({
							id: el.id,
							deps: [el, entry.from, entry.to, open],
							build: () => renderConnectorCommentCallout(shown, entry.route, opts) ?? h("g", {}),
						});
					}
				}
			}
		}
		for (const id of this.routes.keys()) if (!live.has(id)) this.routes.delete(id);
		this.frames.sync(frames);
		this.connectors.sync(connectors);
		this.labels.sync(labels);
		this.blocks.sync(blocks);
		this.comments.sync(comments);
		this.applyTrace(trace);
		this.renderOverlay();
	}

	/** Dims everything outside the active dependency trace and marks the paths in it. */
	private applyTrace(trace: DependencyTrace | null): void {
		const members = trace ? traceMembers(trace) : null;
		this.ed.svg.classList.toggle("bd-tracing", !!trace);
		const mark = (rawId: string, node: Element) => {
			const id = rawId.endsWith(":comment") ? rawId.slice(0, -8) : rawId;
			const cl = node.classList;
			cl.toggle("bd-dimmed", !!members && !members.has(id) && !isFrame(this.ed.byId.get(id)));
			cl.toggle("bd-trace-root", trace?.rootId === id);
			cl.toggle("bd-trace-up", !!trace?.upstream.has(id) && !trace.downstream.has(id));
			cl.toggle("bd-trace-down", !!trace?.downstream.has(id));
			cl.toggle("bd-trace-path", !!trace?.connectors.has(id));
		};
		for (const layer of [this.connectors, this.labels, this.blocks, this.comments]) layer.forEach(mark);
	}

	private renderOverlay(): void {
		const ed = this.ed;
		const z = ed.vp.zoom;
		const nodes: VNode[] = [];
		const selected = ed.selectedElements();
		const showHandles = !ed.options.readOnly && ed.tool === "select" && !ed.editingId && !ed.pointer.isBusy();

		for (const el of selected) {
			if (isBox(el)) {
				const b = expand(el, 4 / z);
				nodes.push(
					h("rect", {
						class: isFrame(el) ? "bd-sel-outline bd-sel-frame" : "bd-sel-outline",
						x: b.x,
						y: b.y,
						width: b.width,
						height: b.height,
						rx: isFrame(el) ? 10 / z : 4 / z,
					}),
				);
			} else if (isConnector(el)) {
				const entry = this.route(el);
				if (entry) {
					nodes.push(
						h("path", {
							class: "bd-sel-connector",
							d: routePathData(entry.route),
							style: `stroke-width:${el.style.strokeWidth + 6}`,
						}),
					);
				}
			}
		}

		const boxes = selected.filter(isBox);
		if (selected.length > 1) {
			const ub = unionBounds([
				...boxes,
				...selected.filter(isConnector).map((c) => this.route(c)?.route.bounds).filter((b): b is NonNullable<typeof b> => !!b),
			]);
			if (ub) {
				const b = expand(ub, 10 / z);
				nodes.push(h("rect", { class: "bd-sel-group", x: b.x, y: b.y, width: b.width, height: b.height }));
			}
		}

		if (showHandles && selected.length === 1) {
			const el = selected[0];
			if (isBox(el)) {
				const s = RESIZE_HANDLE_SIZE / z;
				for (const handle of HANDLES) {
					const p = handlePosition(el, handle, 4 / z);
					nodes.push(
						h("rect", {
							class: `bd-handle bd-handle-${handle}`,
							x: p.x - s / 2,
							y: p.y - s / 2,
							width: s,
							height: s,
							rx: 2 / z,
						}),
					);
				}
			} else if (isConnector(el)) {
				const entry = this.route(el);
				if (entry) {
					for (const p of [entry.route.start, entry.route.end]) {
						nodes.push(h("circle", { class: "bd-handle bd-handle-end", cx: p.x, cy: p.y, r: 6 / z }));
					}
				}
			}
		}

		const handleBlockId = ed.connectHandleBlockId();
		if (handleBlockId) {
			const b = ed.byId.get(handleBlockId);
			if (isBlock(b)) {
				for (const side of SIDES) {
					const p = add(sideAnchor(b.shape, b, side), scale(SIDE_DIR[side], CONNECT_HANDLE_OFFSET / z));
					nodes.push(
						h("circle", {
							class: "bd-connect-handle",
							cx: p.x,
							cy: p.y,
							r: CONNECT_HANDLE_RADIUS / z,
						}),
					);
				}
			}
		}

		nodes.push(...ed.pointer.overlayNodes(z));

		while (this.overlay.firstChild) this.overlay.removeChild(this.overlay.firstChild);
		for (const n of nodes) this.overlay.appendChild(toDom(n));
	}
}

export function handlePosition(b: { x: number; y: number; width: number; height: number }, handle: Handle, pad = 0) {
	const x0 = b.x - pad;
	const y0 = b.y - pad;
	const x1 = b.x + b.width + pad;
	const y1 = b.y + b.height + pad;
	const xm = (x0 + x1) / 2;
	const ym = (y0 + y1) / 2;
	switch (handle) {
		case "nw":
			return { x: x0, y: y0 };
		case "n":
			return { x: xm, y: y0 };
		case "ne":
			return { x: x1, y: y0 };
		case "e":
			return { x: x1, y: ym };
		case "se":
			return { x: x1, y: y1 };
		case "s":
			return { x: xm, y: y1 };
		case "sw":
			return { x: x0, y: y1 };
		case "w":
			return { x: x0, y: ym };
	}
}

