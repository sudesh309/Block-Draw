import { add, normalize, offsetPolyline, scale, type Point } from "../geometry/geom";
import { routeConnector, routePathData, sampleCubic, trimRoute, type Route } from "../geometry/routing";
import { shapeDecorationPath, shapePath } from "../geometry/shapes";
import { parseLink } from "../model/links";
import type {
	ArrowHead,
	BlockElement,
	Bounds,
	ConnectorElement,
	ConnectorStyle,
	FrameElement,
	StrokeStyle,
} from "../model/types";
import { isTransparent, parseColor, relativeLuminance, resolveFill, resolveStroke, resolveTextColor, shadeColor, toHex6, type RenderTheme } from "./colors";
import { fontStack } from "./fonts";
import { FONT_FAMILY, LINE_HEIGHT, layoutBlockText, measureText, wrapText } from "./text";
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
	/** Connectors on a dependency trace; their dashes animate even without the Flow effect. */
	tracedLinks?: ReadonlySet<string>;
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

/* ------------------------------------------------------------- comments */

export const COMMENT_BADGE_SIZE = 16;
/** Max width of a comment callout, in world units. */
export const COMMENT_MAX_WIDTH = 220;
const COMMENT_FONT_SIZE = 12;
const COMMENT_PAD = 8;
const COMMENT_ICON = "M3.5 4 H12.5 V10 H7.5 L4.5 13 V10 H3.5 Z";

/** Local-space box (relative to the block's own origin) of its comment badge, bottom-right corner. */
export function blockCommentBadgeBox(block: BlockElement): { x: number; y: number; size: number } {
	const size = COMMENT_BADGE_SIZE;
	return { x: Math.max(0, block.width - size - 4), y: Math.max(0, block.height - size - 4), size };
}

/** World-space center of a connector's comment badge: above its label, or at the label position. */
export function connectorCommentBadgeCenter(conn: ConnectorElement, route: Route): Point {
	if (conn.label.trim()) {
		const box = labelBox(conn, route);
		return { x: route.labelPos.x, y: box.y - COMMENT_BADGE_SIZE / 2 - 6 };
	}
	return { ...route.labelPos };
}

export function connectorCommentBadgeRect(conn: ConnectorElement, route: Route): Bounds {
	const c = connectorCommentBadgeCenter(conn, route);
	const size = COMMENT_BADGE_SIZE;
	return { x: c.x - size / 2, y: c.y - size / 2, width: size, height: size };
}

function commentCalloutLines(text: string): string[] {
	return wrapText(text, COMMENT_MAX_WIDTH - COMMENT_PAD * 2, COMMENT_FONT_SIZE, 400);
}

function commentCalloutSize(lines: string[]): { width: number; height: number } {
	const lh = COMMENT_FONT_SIZE * LINE_HEIGHT;
	const textWidth = Math.max(0, ...lines.map((l) => measureText(l, COMMENT_FONT_SIZE, 400)));
	return { width: Math.min(COMMENT_MAX_WIDTH, textWidth + COMMENT_PAD * 2 + 4), height: lines.length * lh + COMMENT_PAD * 2 };
}

/** Bounds of a block's comment callout (shown below the block), regardless of whether it is open. */
export function blockCommentCalloutBounds(block: BlockElement): Bounds {
	const lines = commentCalloutLines(block.comment.trim());
	const { width, height } = commentCalloutSize(lines);
	return { x: block.x + block.width / 2 - width / 2, y: block.y + block.height + 8, width, height };
}

/** Bounds of a connector's comment callout (shown above its badge), regardless of whether it is open. */
export function connectorCommentCalloutBounds(conn: ConnectorElement, route: Route): Bounds {
	const badge = connectorCommentBadgeRect(conn, route);
	const lines = commentCalloutLines(conn.comment.trim());
	const { width, height } = commentCalloutSize(lines);
	return { x: badge.x + badge.width / 2 - width / 2, y: badge.y - 6 - height, width, height };
}

/** Small badge indicating an element has a comment; click toggles the callout open/closed. */
function commentBadgeNode(rect: { x: number; y: number; width: number; height: number }, open: boolean, text: string, o: RenderOptions, id: string): VNode {
	return h(
		"g",
		{
			class: `bd-comment-badge${open ? " is-open" : ""}`,
			transform: `translate(${r2(rect.x)},${r2(rect.y)})`,
			"data-comment-badge": o.interactive ? id : null,
		},
		[
			h("title", {}, [`${open ? "Hide" : "Show"} comment: ${text}`]),
			h("rect", {
				width: rect.width,
				height: rect.height,
				rx: 4,
				style: styleAttr({
					fill: open ? o.theme.ink : o.theme.background,
					stroke: o.theme.ink,
					"stroke-width": 1,
					opacity: open ? 0.85 : 0.9,
				}),
			}),
			h("path", {
				d: COMMENT_ICON,
				style: styleAttr({
					fill: "none",
					stroke: open ? o.theme.background : o.theme.ink,
					"stroke-width": 1.3,
					"stroke-linecap": "round",
					"stroke-linejoin": "round",
				}),
			}),
		],
	);
}

/** Comment callout box with a small tail pointing at `anchor`, drawn above or below it. */
function renderCommentCallout(text: string, anchor: Point, box: Bounds, placement: "above" | "below", o: RenderOptions): VNode {
	const lines = commentCalloutLines(text);
	const lh = COMMENT_FONT_SIZE * LINE_HEIGHT;
	const bg = isTransparent(o.theme.background) ? "#ffffff" : o.theme.background;
	const tailX = Math.max(box.x + 10, Math.min(box.x + box.width - 10, anchor.x));
	const tailBase = placement === "below" ? box.y : box.y + box.height;
	const tailTip = placement === "below" ? tailBase - 6 : tailBase + 6;
	return h("g", { class: "bd-comment-callout" }, [
		h("rect", {
			x: r2(box.x),
			y: r2(box.y),
			width: r2(box.width),
			height: r2(box.height),
			rx: 6,
			style: styleAttr({ fill: bg, stroke: o.theme.ink, "stroke-width": 1 }),
		}),
		h("path", {
			d: `M${r2(tailX - 6)},${r2(tailBase)} L${r2(tailX)},${r2(tailTip)} L${r2(tailX + 6)},${r2(tailBase)} Z`,
			style: styleAttr({ fill: bg }),
		}),
		h(
			"text",
			{ style: styleAttr({ fill: o.theme.ink, "font-family": FONT_FAMILY, "font-size": `${COMMENT_FONT_SIZE}px` }) },
			lines.map((line, i) => h("tspan", { x: r2(box.x + COMMENT_PAD), y: r2(box.y + COMMENT_PAD + lh * (i + 0.8)) }, [line || " "])),
		),
	]);
}

/** A block's comment callout, shown below it while `commentOpen` is set. */
export function renderBlockCommentCallout(block: BlockElement, o: RenderOptions): VNode | null {
	const text = block.comment.trim();
	if (!text || !block.commentOpen) return null;
	const box = blockCommentCalloutBounds(block);
	const anchor = { x: block.x + block.width / 2, y: box.y };
	return renderCommentCallout(text, anchor, box, "below", o);
}

/** A connector's small comment badge; always shown when it has a comment, open or not. */
export function renderConnectorCommentBadge(conn: ConnectorElement, route: Route, o: RenderOptions): VNode | null {
	const text = conn.comment.trim();
	if (!text) return null;
	return commentBadgeNode(connectorCommentBadgeRect(conn, route), conn.commentOpen, text, o, conn.id);
}

/** A connector's comment callout, shown above its badge while `commentOpen` is set. */
export function renderConnectorCommentCallout(conn: ConnectorElement, route: Route, o: RenderOptions): VNode | null {
	const text = conn.comment.trim();
	if (!text || !conn.commentOpen) return null;
	const box = connectorCommentCalloutBounds(conn, route);
	const badge = connectorCommentBadgeRect(conn, route);
	const anchor = { x: badge.x + badge.width / 2, y: box.y + box.height };
	return renderCommentCallout(text, anchor, box, "above", o);
}

/* ---------------------------------------------------------------- 3D effect */

/** Extrusion direction of 3D blocks: light comes from top-left, tighter angle. */
const DEPTH_DX = 0.38;

/** Extrusion depth of a 3D block, in world units (0 when the block is flat). */
export function blockDepth(block: BlockElement): number {
	if (!block.style.threeD || block.shape === "text") return 0;
	return Math.max(4.5, Math.min(7.5, Math.min(block.width, block.height) * 0.08));
}

/** Everything a block paints, including its 3D sides and shadow. */
export function blockPaintBounds(block: BlockElement): Bounds {
	const d = blockDepth(block);
	const shadowY = d * 1.2;
	return { x: block.x, y: block.y, width: block.width + shadowY * DEPTH_DX, height: block.height + shadowY };
}

/** Dark tiles (navy, charcoal) get neon-tinted sides and a glow instead of near-black sides. */
function isDarkFill(fill: string | null): boolean {
	const c = fill ? parseColor(fill) : null;
	return !!c && c.a > 0.5 && relativeLuminance(c) < 0.06;
}

/** Extruded sides and a soft contact shadow, drawn under the block's face. */
function blockExtrusion(block: BlockElement, d: number, stroke: string | null, sw: number): VChild[] {
	const path = shapePath(block.shape, block.width, block.height);
	const at = (t: number) => `translate(${r2(t * DEPTH_DX)},${r2(t)})`;
	const nodes: VChild[] = [
		h("path", { d: path, transform: at(d * 1.2), style: "fill:#000000;fill-opacity:0.06", "pointer-events": "none" }),
		h("path", { d: path, transform: at(d * 1.08), style: "fill:#000000;fill-opacity:0.08", "pointer-events": "none" }),
	];
	const fill = resolveFill(block.style.fill);
	const neon = isDarkFill(fill) && stroke ? shadeColor(stroke, 0.55) : null;
	const side = neon ?? (fill ? shadeColor(fill, 0.3) : null);
	const sideStyle = side ? `fill:${side}` : `fill:${stroke ?? "#868e96"};fill-opacity:0.28`;
	const steps = Math.max(4, Math.ceil(d / 1.0));
	for (let i = steps; i >= 1; i--) {
		const deepest = i === steps;
		nodes.push(
			h("path", {
				d: path,
				transform: at((d * i) / steps),
				style: deepest && stroke && sw > 0 ? `${sideStyle};stroke:${stroke};stroke-opacity:0.35;stroke-width:${sw}` : sideStyle,
				"pointer-events": "none",
			}),
		);
	}
	return nodes;
}

/** Vertical sheen on a 3D block's face: a gradient keyed by color, so duplicate ids are identical. */
function faceGradient(fill: string): { id: string; node: VNode } | null {
	const hex = toHex6(fill);
	const light = hex ? shadeColor(hex, isDarkFill(hex) ? -0.09 : -0.22) : null;
	if (!hex || !light) return null;
	const id = `bd-face-${hex.slice(1)}`;
	const node = h("defs", {}, [
		h("linearGradient", { id, x1: 0, y1: 0, x2: 0, y2: 1 }, [
			h("stop", { offset: "0", "stop-color": light }),
			h("stop", { offset: "1", "stop-color": hex }),
		]),
	]);
	return { id, node };
}

export function renderBlock(block: BlockElement, o: RenderOptions): VNode {
	const { width: w, height: h0, style } = block;
	const fill = resolveFill(style.fill);
	const stroke = block.shape === "text" ? null : resolveStroke(style.stroke, o.theme);
	const sw = block.shape === "text" ? 0 : style.strokeWidth;
	const depth = blockDepth(block);
	const gradient = depth && fill ? faceGradient(fill) : null;
	const glow = depth && stroke && sw > 0 && isDarkFill(fill) && parseColor(stroke) ? `drop-shadow(0 0 4px ${stroke})` : null;
	const shapeStyle = styleAttr({
		fill: gradient ? `url(#${gradient.id})` : (fill ?? "none"),
		stroke: stroke && sw > 0 ? stroke : "none",
		"stroke-width": sw > 0 ? sw : null,
		"stroke-dasharray": sw > 0 ? dashArray(style.strokeStyle, sw) : null,
		"stroke-linecap": style.strokeStyle === "dotted" ? "round" : null,
		"stroke-linejoin": "round",
		filter: glow,
	});
	const children: VChild[] = [];
	if (gradient) children.push(gradient.node);
	if (depth) children.push(...blockExtrusion(block, depth, stroke, sw));
	children.push(
		h("path", {
			class: "bd-shape",
			d: shapePath(block.shape, w, h0),
			style: shapeStyle,
			"pointer-events": o.interactive ? "all" : null,
		}),
	);
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
						style: styleAttr({ fill: color, "font-family": fontStack(style.fontFamily) }),
					},
					layout.lines.map((line) =>
						h(
							"tspan",
							{
								x: r2(line.x),
								y: r2(line.y),
								class: line.tag ? "bd-text-tag" : null,
								style: styleAttr({
									"font-size": `${line.size}px`,
									"font-weight": line.weight,
									opacity: line.tag ? 0.7 : line.muted ? 0.78 : null,
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
	const comment = block.comment.trim();
	if (comment) {
		const b = blockCommentBadgeBox(block);
		children.push(commentBadgeNode({ x: b.x, y: b.y, width: b.size, height: b.size }, block.commentOpen, comment, o, block.id));
	}
	return h(
		"g",
		{
			class: `bd-block${block.link ? " bd-has-link" : ""}${depth ? " bd-3d" : ""}`,
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

/** Which way a flowing link's dashes travel: toward its arrowheads (forward when it has none). */
export function flowDirection(style: ConnectorStyle): "forward" | "backward" | "both" {
	const atStart = style.startArrow !== "none";
	const atEnd = style.endArrow !== "none";
	if (atStart && atEnd) return "both";
	return atStart ? "backward" : "forward";
}

/** Two parallel lanes for a two-way link: one drawn start to end, the other end to start. */
function flowLanes(route: Route, pts: Point[], sw: number): { paths: string[]; width: number; offset: number } | null {
	const centre = route.curved ? sampleCubic(pts, 32) : pts;
	const width = Math.max(1, r2(sw * 0.7));
	const offset = r2(width / 2 + 1.25);
	const lanes = [offsetPolyline(centre, offset), offsetPolyline([...centre].reverse(), offset)];
	if (lanes.some((l) => l.length < 2)) return null;
	return { paths: lanes.map((points) => routePathData({ ...route, curved: false, points })), width, offset };
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
	// Dashes march along the path. So a link that flows toward its start is drawn end to start,
	// and a two-way link gets two lanes that run against each other.
	const flow = flowDirection(conn.style);
	const animated = conn.style.flow || !!o.tracedLinks?.has(conn.id);
	const lanes = animated && flow === "both" ? flowLanes(route, pts, sw) : null;
	const d = routePathData({ ...route, points: animated && flow === "backward" ? [...pts].reverse() : pts });
	const strands = lanes ? lanes.paths.map((p) => ({ d: p, w: lanes.width })) : [{ d, w: sw }];
	const children: VChild[] = [];
	const threeD = conn.style.threeD;
	const dash = dashArray(conn.style.strokeStyle, sw);
	if (threeD) {
		const off = 2 + sw;
		const shadow = "rgba(0,0,0,0.22)";
		const heads = [
			arrowHead(conn.style.endArrow, route.end, route.endDir, shadow, sw),
			arrowHead(conn.style.startArrow, route.start, route.startDir, shadow, sw),
		].filter((n): n is VNode => !!n);
		children.push(
			h("g", { class: "bd-connector-shadow", transform: `translate(${r2(off * 0.5)},${r2(off)})`, "pointer-events": "none" }, [
				h("path", {
					d,
					style: styleAttr({
						fill: "none",
						stroke: shadow,
						"stroke-width": lanes ? r2(lanes.offset * 2 + lanes.width + 0.5) : sw + 1.5,
						"stroke-dasharray": dash,
						"stroke-linecap": "round",
						"stroke-linejoin": "round",
					}),
				}),
				...heads,
			]),
		);
	}
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
	for (const s of strands) {
		children.push(
			h("path", {
				class: lanes ? "bd-connector-line bd-flow-lane" : "bd-connector-line",
				d: s.d,
				style: styleAttr({
					fill: "none",
					stroke: color,
					"stroke-width": threeD ? s.w + 1 : s.w,
					"stroke-dasharray": lanes ? dashArray(conn.style.strokeStyle, s.w) : dash,
					"stroke-linecap": "round",
					"stroke-linejoin": "round",
				}),
			}),
		);
	}
	if (threeD) {
		for (const s of strands) {
			children.push(
				h("path", {
					class: "bd-connector-sheen",
					d: s.d,
					"pointer-events": "none",
					style: styleAttr({
						fill: "none",
						stroke: "#ffffff",
						"stroke-opacity": 0.45,
						"stroke-width": r2(Math.max(0.8, s.w * 0.35)),
						"stroke-dasharray": lanes ? dashArray(conn.style.strokeStyle, s.w) : dash,
						"stroke-linecap": "round",
						"stroke-linejoin": "round",
					}),
				}),
			);
		}
	}
	const endHead = arrowHead(conn.style.endArrow, route.end, route.endDir, color, sw);
	if (endHead) children.push(endHead);
	const startHead = arrowHead(conn.style.startArrow, route.start, route.startDir, color, sw);
	if (startHead) children.push(startHead);

	const cls = `bd-connector${conn.style.flow ? " bd-flow" : ""}${threeD ? " bd-3d" : ""}`;
	return h("g", { class: cls, "data-id": o.interactive ? conn.id : null }, children);
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
