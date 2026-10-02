import { expand, unionBounds } from "../geometry/geom";
import { indexById } from "../model/ops";
import { isBlock, isConnector, isFrame, type Bounds, type DrawElement } from "../model/types";
import { type RenderTheme } from "./colors";
import {
	blockCommentCalloutBounds,
	blockPaintBounds,
	connectorCommentCalloutBounds,
	frameTitleMetrics,
	labelBox,
	renderBlock,
	renderBlockCommentCallout,
	renderConnector,
	renderConnectorCommentBadge,
	renderConnectorCommentCallout,
	renderConnectorLabel,
	renderFrame,
	routeFor,
} from "./elements";
import { h, toSvgString, type VNode } from "./vnode";

export interface SceneSvgOptions {
	theme: RenderTheme;
	padding?: number;
	/** Paint the theme background behind the drawing. */
	background?: boolean;
	/** Only render this frame and its content (the frame becomes the canvas). */
	frameId?: string | null;
	/** Output pixel scale (width/height attributes); the viewBox is unchanged. */
	scale?: number;
}

export interface SceneSvg {
	node: VNode;
	svg: string;
	width: number;
	height: number;
	bounds: Bounds;
}

/** Elements visible when rendering a single frame on its own. */
export function frameContent(elements: readonly DrawElement[], frameId: string): DrawElement[] {
	const blockIds = new Set(elements.filter((e) => isBlock(e) && e.frameId === frameId).map((e) => e.id));
	return elements.filter(
		(e) =>
			(isBlock(e) && blockIds.has(e.id)) ||
			(isConnector(e) && blockIds.has(e.from.id) && blockIds.has(e.to.id)),
	);
}

/** Bounds of everything that gets drawn (frame titles and connector labels included). */
export function contentBounds(elements: readonly DrawElement[]): Bounds | null {
	const byId = indexById(elements);
	const list: Bounds[] = [];
	for (const el of elements) {
		if (isFrame(el)) {
			const t = frameTitleMetrics(el, 1);
			list.push(el, { x: t.x, y: t.y - t.size, width: t.width, height: t.height });
		} else if (isBlock(el)) {
			list.push(blockPaintBounds(el));
			if (el.comment.trim() && el.commentOpen) list.push(blockCommentCalloutBounds(el));
		} else {
			const from = byId.get(el.from.id);
			const to = byId.get(el.to.id);
			if (!isBlock(from) || !isBlock(to)) continue;
			const route = routeFor(el, from, to);
			list.push(route.bounds);
			if (el.label.trim()) list.push(labelBox(el, route));
			if (el.comment.trim() && el.commentOpen) list.push(connectorCommentCalloutBounds(el, route));
		}
	}
	return unionBounds(list);
}

export function sceneToSvg(elements: readonly DrawElement[], opts: SceneSvgOptions): SceneSvg {
	const padding = opts.padding ?? 24;
	const byId = indexById(elements);
	const frame = opts.frameId ? byId.get(opts.frameId) : null;
	const visible = isFrame(frame) ? frameContent(elements, frame.id) : elements;
	let bounds: Bounds;
	if (isFrame(frame)) {
		bounds = { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
	} else {
		bounds = expand(contentBounds(visible) ?? { x: 0, y: 0, width: 200, height: 120 }, padding);
	}
	const ro = { theme: opts.theme, zoom: 1, interactive: false, frameTitle: (id: string) => {
		const f = byId.get(id);
		return isFrame(f) ? f.title : null;
	} };

	const layers: VNode[] = [];
	if (opts.background !== false) {
		layers.push(
			h("rect", {
				x: bounds.x,
				y: bounds.y,
				width: bounds.width,
				height: bounds.height,
				style: `fill:${opts.theme.background}`,
			}),
		);
	}
	if (isFrame(frame) && frame.style.fill !== "transparent") {
		layers.push(h("rect", { x: frame.x, y: frame.y, width: frame.width, height: frame.height, style: `fill:${frame.style.fill}` }));
	}
	const frames: VNode[] = [];
	const connectors: VNode[] = [];
	const labels: VNode[] = [];
	const blocks: VNode[] = [];
	const comments: VNode[] = [];
	for (const el of visible) {
		if (isFrame(el)) frames.push(renderFrame(el, ro));
		else if (isBlock(el)) {
			blocks.push(renderBlock(el, ro));
			const callout = renderBlockCommentCallout(el, ro);
			if (callout) comments.push(callout);
		} else {
			const from = byId.get(el.from.id);
			const to = byId.get(el.to.id);
			if (isBlock(from) && isBlock(to)) {
				const route = routeFor(el, from, to);
				connectors.push(renderConnector(el, from, to, ro, route));
				const label = renderConnectorLabel(el, route, ro);
				if (label) labels.push(label);
				const badge = renderConnectorCommentBadge(el, route, ro);
				if (badge) labels.push(badge);
				const callout = renderConnectorCommentCallout(el, route, ro);
				if (callout) comments.push(callout);
			}
		}
	}
	layers.push(h("g", {}, frames), h("g", {}, connectors), h("g", {}, labels), h("g", {}, blocks), h("g", {}, comments));

	const k = opts.scale ?? 1;
	const width = Math.max(1, Math.ceil(bounds.width * k));
	const height = Math.max(1, Math.ceil(bounds.height * k));
	const node = h(
		"svg",
		{
			xmlns: "http://www.w3.org/2000/svg",
			width,
			height,
			viewBox: `${round(bounds.x)} ${round(bounds.y)} ${round(bounds.width)} ${round(bounds.height)}`,
		},
		layers,
	);
	return { node, svg: toSvgString(node), width, height, bounds };
}

const round = (n: number) => Math.round(n * 100) / 100;
