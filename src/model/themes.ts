import {
	COLOR_AUTO,
	COLOR_DEFAULT,
	COLOR_TRANSPARENT,
	isBlock,
	isConnector,
	isFrame,
	type BlockElement,
	type DrawElement,
} from "./types";

export type DrawingThemeId = "classic" | "minimal" | "futuristic" | "executive";

export interface DrawingTheme {
	id: DrawingThemeId;
	name: string;
	description: string;
	/** Block fills, assigned per group of blocks that shared a fill before restyling. */
	fills: string[];
	/** Block strokes, assigned per group the same way. */
	strokes: string[];
	strokeWidth: number;
	threeD: boolean;
	/** Connector color; "source" takes the stroke of the block it leaves from. */
	connector: string;
	connectorWidth: number;
	frameFill: string;
	frameStroke: string;
}

export const DRAWING_THEMES: DrawingTheme[] = [
	{
		id: "executive",
		name: "Executive 3D",
		description: "Soft board-room colors, raised 3D blocks and links",
		fills: ["#e7f5ff", "#e6fcf5", "#fff4e6", "#f3f0ff", "#fff0f6", "#f8f9fa"],
		strokes: ["#1f3a5f"],
		strokeWidth: 1.5,
		threeD: true,
		connector: "#1f3a5f",
		connectorWidth: 2,
		frameFill: "#f8f9fa",
		frameStroke: "#1f3a5f",
	},
	{
		id: "minimal",
		name: "Minimal",
		description: "White and grey, fine lines, nothing extra",
		fills: ["#ffffff", "#f1f3f5", "#e9ecef", "#f8f9fa"],
		strokes: ["#343a40"],
		strokeWidth: 1,
		threeD: false,
		connector: "#868e96",
		connectorWidth: 1,
		frameFill: COLOR_TRANSPARENT,
		frameStroke: "#ced4da",
	},
	{
		id: "futuristic",
		name: "Futuristic",
		description: "Deep navy tiles with neon edges, in 3D",
		fills: ["#0b1020", "#111827", "#1e1b4b", "#0f2e3d", "#1f1135"],
		strokes: ["#22d3ee", "#a78bfa", "#f472b6", "#a3e635", "#fbbf24"],
		strokeWidth: 2,
		threeD: true,
		connector: "source",
		connectorWidth: 2,
		frameFill: "#0f172a",
		frameStroke: "#22d3ee",
	},
	{
		id: "classic",
		name: "Classic",
		description: "The original pastel colors, flat",
		fills: ["#a5d8ff", "#b2f2bb", "#ffec99", "#ffd8a8", "#d0bfff", "#fcc2d7"],
		strokes: [COLOR_DEFAULT],
		strokeWidth: 2,
		threeD: false,
		connector: COLOR_DEFAULT,
		connectorWidth: 2,
		frameFill: COLOR_TRANSPARENT,
		frameStroke: COLOR_DEFAULT,
	},
];

export function drawingThemeById(id: string): DrawingTheme | null {
	return DRAWING_THEMES.find((t) => t.id === id) ?? null;
}

/**
 * Restyles a drawing (or only `ids`, when given) with a theme. Blocks that shared a fill keep
 * sharing one, so color-coded groups stay recognizable. Shapes, sizes, text and links are kept.
 */
export function applyDrawingTheme(elements: readonly DrawElement[], theme: DrawingTheme, ids?: ReadonlySet<string>): DrawElement[] {
	const inScope = (id: string) => !ids || ids.has(id);
	const groups = new Map<string, number>();
	const groupOf = (b: BlockElement) => {
		const key = b.style.fill.toLowerCase();
		if (!groups.has(key)) groups.set(key, groups.size);
		return groups.get(key) as number;
	};
	const restyled = new Map<string, BlockElement>();
	const out = elements.map((el): DrawElement => {
		if (!isBlock(el) || !inScope(el.id)) return el;
		const g = groupOf(el);
		const transparent = el.style.fill === COLOR_TRANSPARENT || el.shape === "text";
		const next: BlockElement = {
			...el,
			style: {
				...el.style,
				fill: transparent ? el.style.fill : theme.fills[g % theme.fills.length],
				stroke: theme.strokes[g % theme.strokes.length],
				strokeWidth: theme.strokeWidth,
				textColor: COLOR_AUTO,
				threeD: theme.threeD,
			},
		};
		restyled.set(el.id, next);
		return next;
	});
	return out.map((el): DrawElement => {
		if (isFrame(el) && inScope(el.id)) return { ...el, style: { fill: theme.frameFill, stroke: theme.frameStroke } };
		if (!isConnector(el) || !inScope(el.id)) return el;
		const source = restyled.get(el.from.id) ?? out.find((e): e is BlockElement => isBlock(e) && e.id === el.from.id);
		const stroke = theme.connector === "source" ? (source?.style.stroke ?? COLOR_DEFAULT) : theme.connector;
		return { ...el, style: { ...el.style, stroke, strokeWidth: theme.connectorWidth, threeD: theme.threeD } };
	});
}
