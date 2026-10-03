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
import { WEB_FONTS_URL } from "./fonts";
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
	/** Import the web fonts from Google Fonts, so the file shows them when opened in a browser. */
	webFonts?: boolean;
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

	const layers: VNode[] = opts.webFonts ? [h("defs", {}, [h("style", {}, [`@import url('${WEB_FONTS_URL}');`])])] : [];
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
	// Only filled for links sent behind the blocks and blocks brought in front of the links.
	const behind: VNode[] = [];
	const behindLabels: VNode[] = [];
	const inFront: VNode[] = [];
	for (const el of visible) {
		if (isFrame(el)) frames.push(renderFrame(el, ro));
		else if (isBlock(el)) {
			(el.inFront ? inFront : blocks).push(renderBlock(el, ro));
			const callout = renderBlockCommentCallout(el, ro);
			if (callout) comments.push(callout);
		} else {
			const from = byId.get(el.from.id);
			const to = byId.get(el.to.id);
			if (isBlock(from) && isBlock(to)) {
				const route = routeFor(el, from, to);
				(el.behind ? behind : connectors).push(renderConnector(el, from, to, ro, route));
				const label = renderConnectorLabel(el, route, ro);
				if (label) (el.behind ? behindLabels : labels).push(label);
				const badge = renderConnectorCommentBadge(el, route, ro);
				if (badge) (el.behind ? behindLabels : labels).push(badge);
				const callout = renderConnectorCommentCallout(el, route, ro);
				if (callout) comments.push(callout);
			}
		}
	}
	// Same order as the editor (see model/stack.ts): links and labels above blocks, so a container block
	// cannot hide them, unless a link was sent behind the blocks or a block brought in front of the links.
	const extra = (nodes: VNode[]) => (nodes.length ? [h("g", {}, nodes)] : []);
	layers.push(
		h("g", {}, frames),
		...extra(behind),
		...extra(behindLabels),
		h("g", {}, blocks),
		h("g", {}, connectors),
		h("g", {}, labels),
		...extra(inFront),
		h("g", {}, comments),
	);

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
