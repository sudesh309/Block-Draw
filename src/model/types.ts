/**
 * Core data model of a Block Draw drawing.
 *
 * Elements are treated as immutable values: every edit produces a new object.
 * That keeps undo/redo cheap (history entries share unchanged elements) and lets
 * the renderer detect changes with a simple identity check.
 */

export const FILE_EXTENSION = "blockdraw";
export const FILE_FORMAT = "block-draw";
export const FILE_VERSION = 1;

export type Side = "top" | "right" | "bottom" | "left";
export type AnchorSide = Side | "auto";

export type BlockShape =
	| "rectangle"
	| "rounded"
	| "ellipse"
	| "diamond"
	| "parallelogram"
	| "hexagon"
	| "cylinder"
	| "text";

export const BLOCK_SHAPES: BlockShape[] = [
	"rounded",
	"rectangle",
	"ellipse",
	"diamond",
	"parallelogram",
	"hexagon",
	"cylinder",
	"text",
];

export type StrokeStyle = "solid" | "dashed" | "dotted";
export type Routing = "elbow" | "straight" | "curved";
export type ArrowHead = "none" | "arrow" | "triangle" | "dot";
export type TextAlign = "left" | "center" | "right";

/** Sentinel colors resolved at render time. */
export const COLOR_TRANSPARENT = "transparent";
/** Theme ink: dark in light mode, light in dark mode. */
export const COLOR_DEFAULT = "default";
/** Text color derived from the fill (or theme ink when there is no fill). */
export const COLOR_AUTO = "auto";

export interface BlockStyle {
	fill: string;
	stroke: string;
	strokeWidth: number;
	strokeStyle: StrokeStyle;
	textColor: string;
	fontSize: number;
	textAlign: TextAlign;
}

export interface Bounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface BlockElement extends Bounds {
	id: string;
	type: "block";
	title: string;
	description: string;
	shape: BlockShape;
	/** Frame this block belongs to, or null when it sits directly on the canvas. */
	frameId: string | null;
	/**
	 * Optional link followed on Ctrl/Cmd+click or via the link badge:
	 * `frame:<frameId>` (frame in this drawing), `[[wikilink]]` (vault file) or an http(s) URL.
	 */
	link: string | null;
	style: BlockStyle;
	/** Optional annotation, shown via the comment badge instead of inline in the shape. */
	comment: string;
	/** Whether the comment callout is currently shown on the canvas (and in exports). */
	commentOpen: boolean;
}

export interface FrameStyle {
	fill: string;
	stroke: string;
}

export interface FrameElement extends Bounds {
	id: string;
	type: "frame";
	title: string;
	description: string;
	style: FrameStyle;
}

export interface ConnectorEnd {
	id: string;
	side: AnchorSide;
}

export interface ConnectorStyle {
	stroke: string;
	strokeWidth: number;
	strokeStyle: StrokeStyle;
	startArrow: ArrowHead;
	endArrow: ArrowHead;
}

export interface ConnectorElement {
	id: string;
	type: "connector";
	from: ConnectorEnd;
	to: ConnectorEnd;
	label: string;
	routing: Routing;
	style: ConnectorStyle;
	/** Optional annotation, shown via the comment badge near the connector's label. */
	comment: string;
	/** Whether the comment callout is currently shown on the canvas (and in exports). */
	commentOpen: boolean;
}

export type BoxElement = BlockElement | FrameElement;
export type DrawElement = BlockElement | FrameElement | ConnectorElement;
export type ElementType = DrawElement["type"];

export interface GoogleSheetExportInfo {
	spreadsheetId: string;
	url: string;
	exportedAt: string;
	/** Tabs created by the export; only these are replaced when exporting again. */
	sheetIds?: number[];
}

/** Everything in a `.blockdraw` file except its elements. */
export interface DrawingMeta {
	type: typeof FILE_FORMAT;
	version: number;
	/** Where this drawing was last exported to; lets re-exports update in place. */
	exports?: {
		googleSheet?: GoogleSheetExportInfo;
	};
	/** Unknown keys from newer versions are preserved on save. */
	[key: string]: unknown;
}

/** The on-disk representation of a `.blockdraw` file. */
export interface DrawingFile extends DrawingMeta {
	elements: DrawElement[];
}

export const DEFAULT_BLOCK_STYLE: BlockStyle = {
	fill: "#a5d8ff",
	stroke: COLOR_DEFAULT,
	strokeWidth: 2,
	strokeStyle: "solid",
	textColor: COLOR_AUTO,
	fontSize: 16,
	textAlign: "center",
};

export const DEFAULT_FRAME_STYLE: FrameStyle = {
	fill: COLOR_TRANSPARENT,
	stroke: COLOR_DEFAULT,
};

export const DEFAULT_CONNECTOR_STYLE: ConnectorStyle = {
	stroke: COLOR_DEFAULT,
	strokeWidth: 2,
	strokeStyle: "solid",
	startArrow: "none",
	endArrow: "arrow",
};

export const DEFAULT_BLOCK_SIZE = { width: 160, height: 80 };
export const MIN_BLOCK_SIZE = 20;
export const MIN_FRAME_SIZE = 60;

export function isBlock(el: DrawElement | undefined | null): el is BlockElement {
	return !!el && el.type === "block";
}

export function isFrame(el: DrawElement | undefined | null): el is FrameElement {
	return !!el && el.type === "frame";
}

export function isConnector(el: DrawElement | undefined | null): el is ConnectorElement {
	return !!el && el.type === "connector";
}

export function isBox(el: DrawElement | undefined | null): el is BoxElement {
	return !!el && (el.type === "block" || el.type === "frame");
}
