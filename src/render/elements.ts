import { add, normalize, scale, type Point } from "../geometry/geom";
import { routeConnector, routePathData, trimRoute, type Route } from "../geometry/routing";
import { shapeDecorationPath, shapePath } from "../geometry/shapes";
import { parseLink } from "../model/links";
import type {
	ArrowHead,
	BlockElement,
	ConnectorElement,
	FrameElement,
	StrokeStyle,
} from "../model/types";
import { isTransparent, resolveFill, resolveStroke, resolveTextColor, type RenderTheme } from "./colors";
import { FONT_FAMILY, layoutBlockText, measureText } from "./text";
import { h, type VChild, type VNode } from "./vnode";

export interface RenderOptions {
	theme: RenderTheme;
	/** Current zoom; frame titles and hit areas are kept at a constant on-screen size. */
	zoom: number;
	/** Adds data attributes and invisible hit areas used by the editor. */
	interactive: boolean;
	/** Block/connector/frame whose text is being edited (its text is hidden). */
	editingId?: string | null;
	/** Resolves a frame id to its title (for link badges/tooltips). */
	frameTitle?: (id: string) => string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function dashArray(style: StrokeStyle, width: number): string | null {
	if (style === "dashed") return `${r2(width * 4 + 2)} ${r2(width * 3 + 2)}`;
	if (style === "dotted") return `${r2(width * 0.1 + 0.01)} ${r2(width * 2.5 + 2)}`;
	return null;
}

function styleAttr(parts: Record<string, string | number | null | undefined>): string {
	return Object.entries(parts)
		.filter(([, v]) => v !== null && v !== undefined && v !== "")
		.map(([k, v]) => `${k}:${v}`)
		.join(";");
}

/* ------------------------------------------------------------------ blocks */

/** Small badge drawn in the top-right corner of blocks that carry a link. */
function linkBadge(block: BlockElement, o: RenderOptions): VNode | null {
	const parsed = parseLink(block.link);
	if (!parsed) return null;
	const size = 16;
	const x = Math.max(0, block.width - size - 4);
	const y = 4;
	let title = "";
	if (parsed.kind === "frame") title = `Go to frame: ${o.frameTitle?.(parsed.frameId) ?? "(missing frame)"}`;
	else if (parsed.kind === "note") title = `Open ${parsed.display}`;
	else title = `Open ${parsed.url}`;
	// Icons are tiny line drawings in a 16x16 box.
	let icon: string;
	if (parsed.kind === "frame") icon = "M5 11 L11 5 M6.5 5 H11 V9.5"; // arrow up-right
	else if (parsed.kind === "note") icon = "M5 3.5 H9 L11.5 6 V12.5 H5 Z M9 3.5 V6 H11.5"; // page
	else icon = "M7 9 L11.5 4.5 M8.5 4.5 H11.5 V7.5 M10 9.5 V12 H4.5 V6.5 H7"; // external
	return h(
		"g",
		{
			class: "bd-link-badge",
			transform: `translate(${r2(x)},${y})`,
			"data-link-badge": o.interactive ? block.id : null,
		},
		[
			h("title", {}, [title]),
			h("rect", {
				width: size,
				height: size,
				rx: 4,
				style: styleAttr({ fill: o.theme.background, stroke: o.theme.ink, "stroke-width": 1, opacity: 0.9 }),
			}),
			h("path", {
				d: icon,
				style: styleAttr({
					fill: "none",
					stroke: o.theme.ink,
					"stroke-width": 1.4,
					"stroke-linecap": "round",
					"stroke-linejoin": "round",
				}),
			}),
		],
	);
}

export function renderBlock(block: BlockElement, o: RenderOptions): VNode {
	const { width: w, height: h0, style } = block;
	const fill = resolveFill(style.fill);
	const stroke = block.shape === "text" ? null : resolveStroke(style.stroke, o.theme);
	const sw = block.shape === "text" ? 0 : style.strokeWidth;
	const shapeStyle = styleAttr({
		fill: fill ?? "none",
		stroke: stroke && sw > 0 ? stroke : "none",
		"stroke-width": sw > 0 ? sw : null,
		"stroke-dasharray": sw > 0 ? dashArray(style.strokeStyle, sw) : null,
		"stroke-linecap": style.strokeStyle === "dotted" ? "round" : null,
		"stroke-linejoin": "round",
	});
	const children: VChild[] = [
		h("path", {
			class: "bd-shape",
			d: shapePath(block.shape, w, h0),
			style: shapeStyle,
			"pointer-events": o.interactive ? "all" : null,
		}),
	];
	const deco = shapeDecorationPath(block.shape, w, h0);
	if (deco && stroke && sw > 0) {
		children.push(
			h("path", {
				d: deco,
				style: styleAttr({ fill: "none", stroke, "stroke-width": sw, "stroke-dasharray": dashArray(style.strokeStyle, sw) }),
			}),
		);
	}
	if (o.editingId !== block.id) {
		const layout = layoutBlockText(block);
		if (layout.lines.length) {
			const color = resolveTextColor(style.textColor, style.fill, o.theme);
			children.push(
				h(
					"text",
					{
						class: "bd-text",
						"text-anchor": layout.anchor,
						style: styleAttr({ fill: color, "font-family": FONT_FAMILY }),
					},
					layout.lines.map((line) =>
						h(
							"tspan",
							{
								x: r2(line.x),
								y: r2(line.y),
								style: styleAttr({
									"font-size": `${line.size}px`,
									"font-weight": line.weight,
									opacity: line.muted ? 0.78 : null,
								}),
							},
							[line.text || " "],
						),
					),
				),
			);
		}
	}
	const badge = linkBadge(block, o);
	if (badge) children.push(badge);
	return h(
		"g",
		{
			class: `bd-block${block.link ? " bd-has-link" : ""}`,
			"data-id": o.interactive ? block.id : null,
			transform: `translate(${r2(block.x)},${r2(block.y)})`,
		},
		children,
	);
}

/* ------------------------------------------------------------------ frames */

export const FRAME_TITLE_SIZE = 14;

export function frameTitleMetrics(frame: FrameElement, zoom: number): { x: number; y: number; size: number; width: number; height: number } {
	const size = FRAME_TITLE_SIZE / zoom;
	const width = Math.min(frame.width, measureText(frame.title || "Frame", FRAME_TITLE_SIZE, 600) / zoom + 8 / zoom);
	return { x: frame.x, y: frame.y - 8 / zoom, size, width, height: size * 1.3 };
}

export function renderFrame(frame: FrameElement, o: RenderOptions): VNode {
	const fill = resolveFill(frame.style.fill);
	const stroke = resolveStroke(frame.style.stroke, { ...o.theme, ink: o.theme.frameStroke });
	const t = frameTitleMetrics(frame, o.zoom);
	const children: VChild[] = [
		h("rect", {
			class: "bd-frame-rect",
			x: r2(frame.x),
			y: r2(frame.y),
			width: r2(frame.width),
			height: r2(frame.height),
			rx: 8,
			style: styleAttr({ fill: fill ?? "none", stroke, "stroke-width": 1.5 }),
			"vector-effect": "non-scaling-stroke",
			"pointer-events": o.interactive ? "stroke" : null,
		}),
	];
	if (o.editingId !== frame.id) {
		children.push(
			h(
				"text",
				{
					class: "bd-frame-title",
					x: r2(t.x),
					y: r2(t.y),
					style: styleAttr({
						fill: o.theme.frameTitle,
						"font-family": FONT_FAMILY,
						"font-size": `${r2(t.size)}px`,
						"font-weight": 600,
					}),
					"data-frame-title": o.interactive ? frame.id : null,
				},
				[frame.title || "Frame"],
			),
		);
	}
	if (o.interactive) {
		// Invisible strip that makes the title easy to grab.
		children.push(
			h("rect", {
				class: "bd-frame-title-hit",
				x: r2(t.x),
				y: r2(t.y - t.size),
				width: r2(Math.max(t.width, 40 / o.zoom)),
				height: r2(t.height),
				"data-frame-title": frame.id,
				style: "fill:transparent",
			}),
		);
	}
	return h("g", { class: "bd-frame", "data-id": o.interactive ? frame.id : null }, children);
}

/* -------------------------------------------------------------- connectors */

export function routeFor(conn: ConnectorElement, from: BlockElement, to: BlockElement): Route {
	return routeConnector(
		conn.routing,
		{ bounds: from, shape: from.shape, side: conn.from.side },
		{ bounds: to, shape: to.shape, side: conn.to.side },
	);
}

function arrowSize(strokeWidth: number): number {
	return 9 + strokeWidth * 2.5;
}

function arrowTrim(kind: ArrowHead, strokeWidth: number): number {
	if (kind === "triangle") return arrowSize(strokeWidth) * 0.85;
	if (kind === "dot") return 3 + strokeWidth;
	if (kind === "arrow") return strokeWidth * 0.6;
	return 0;
}

function arrowHead(kind: ArrowHead, tip: Point, dir: Point, color: string, sw: number): VNode | null {
	if (kind === "none") return null;
	const d = normalize(dir);
	if (d.x === 0 && d.y === 0) return null;
	const len = arrowSize(sw);
	if (kind === "dot") {
		const rad = 3 + sw;
		const c = add(tip, scale(d, -rad));
		return h("circle", { cx: r2(c.x), cy: r2(c.y), r: r2(rad), style: styleAttr({ fill: color, stroke: "none" }) });
	}
	const back = add(tip, scale(d, -len));
	const nrm = { x: -d.y, y: d.x };
	const half = kind === "triangle" ? len * 0.42 : len * 0.5;
	const p1 = add(back, scale(nrm, half));
	const p2 = add(back, scale(nrm, -half));
	if (kind === "triangle") {
		return h("path", {
			d: `M${r2(tip.x)},${r2(tip.y)} L${r2(p1.x)},${r2(p1.y)} L${r2(p2.x)},${r2(p2.y)} Z`,
			style: styleAttr({ fill: color, stroke: color, "stroke-width": 1, "stroke-linejoin": "round" }),
		});
	}
	return h("path", {
		d: `M${r2(p1.x)},${r2(p1.y)} L${r2(tip.x)},${r2(tip.y)} L${r2(p2.x)},${r2(p2.y)}`,
		style: styleAttr({
			fill: "none",
			stroke: color,
			"stroke-width": sw,
			"stroke-linecap": "round",
			"stroke-linejoin": "round",
		}),
	});
}

export const LABEL_FONT_SIZE = 14;

export function labelBox(conn: ConnectorElement, route: Route): { x: number; y: number; width: number; height: number } {
	const lines = conn.label.split(/\r?\n/);
	const width = Math.max(...lines.map((l) => measureText(l, LABEL_FONT_SIZE, 400))) + 10;
	const height = lines.length * LABEL_FONT_SIZE * 1.25 + 6;
	return { x: route.labelPos.x - width / 2, y: route.labelPos.y - height / 2, width, height };
}

export function renderConnector(
	conn: ConnectorElement,
	from: BlockElement,
	to: BlockElement,
	o: RenderOptions,
	route: Route = routeFor(conn, from, to),
): VNode {
	const color = resolveStroke(conn.style.stroke, o.theme);
	const sw = conn.style.strokeWidth;
	const pts = trimRoute(route, arrowTrim(conn.style.startArrow, sw), arrowTrim(conn.style.endArrow, sw));
	const d = routePathData({ ...route, points: pts });
	const children: VChild[] = [];
	if (o.interactive) {
		children.push(
			h("path", {
				class: "bd-connector-hit",
				d: routePathData(route),
				style: styleAttr({ fill: "none", stroke: "transparent", "stroke-width": 14 }),
				"vector-effect": "non-scaling-stroke",
				"pointer-events": "stroke",
			}),
		);
	}
	children.push(
		h("path", {
			class: "bd-connector-line",
			d,
			style: styleAttr({
				fill: "none",
				stroke: color,
				"stroke-width": sw,
				"stroke-dasharray": dashArray(conn.style.strokeStyle, sw),
				"stroke-linecap": "round",
				"stroke-linejoin": "round",
			}),
		}),
	);
	const endHead = arrowHead(conn.style.endArrow, route.end, route.endDir, color, sw);
	if (endHead) children.push(endHead);
	const startHead = arrowHead(conn.style.startArrow, route.start, route.startDir, color, sw);
	if (startHead) children.push(startHead);

	return h("g", { class: "bd-connector", "data-id": o.interactive ? conn.id : null }, children);
}

/**
 * Connector label, rendered in its own layer above every connector line so crossing or
 * overlapping lines never strike through a label.
 */
export function renderConnectorLabel(conn: ConnectorElement, route: Route, o: RenderOptions): VNode | null {
	if (!conn.label.trim() || o.editingId === conn.id) return null;
	const color = resolveStroke(conn.style.stroke, o.theme);
	const box = labelBox(conn, route);
	const lines = conn.label.split(/\r?\n/);
	return h("g", { class: "bd-connector-label", "data-label-for": o.interactive ? conn.id : null }, [
		h("rect", {
			x: r2(box.x),
			y: r2(box.y),
			width: r2(box.width),
			height: r2(box.height),
			rx: 4,
			style: styleAttr({ fill: isTransparent(o.theme.background) ? "#ffffff" : o.theme.background, opacity: 0.92 }),
		}),
		h(
			"text",
			{
				"text-anchor": "middle",
				style: styleAttr({ fill: color, "font-family": FONT_FAMILY, "font-size": `${LABEL_FONT_SIZE}px` }),
			},
			lines.map((line, i) =>
				h("tspan", { x: r2(route.labelPos.x), y: r2(box.y + 3 + LABEL_FONT_SIZE * 1.25 * (i + 0.5) + LABEL_FONT_SIZE * 0.35) }, [
					line || "\u00a0",
				]),
			),
		),
	]);
}
