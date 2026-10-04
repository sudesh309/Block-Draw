import type { Point, Side } from "../model/types";

export type Tool = "select" | "pan" | "block" | "connector" | "frame" | "erase";

export interface Viewport {
	/** Screen offset of the world origin, in CSS pixels. */
	x: number;
	y: number;
	zoom: number;
}

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export interface EditorOptions {
	gridSize: number;
	snapToGrid: boolean;
	showGrid: boolean;
	/** The Google Fonts web fonts are being loaded (the font picker explains what happens when they are not). */
	webFonts: boolean;
	/** Read-only mode (embeds/previews): no editing UI. */
	readOnly: boolean;
	/** Tablet mode (the host decides when it applies): the pen's button erases, palm rejection, a properties button. */
	tablet: boolean;
	/** In tablet mode, what dragging one finger does: draw like the pen, or pan (a tap still selects). */
	fingerAction: "draw" | "pan";
}

export const DEFAULT_EDITOR_OPTIONS: EditorOptions = {
	gridSize: 20,
	snapToGrid: true,
	showGrid: true,
	webFonts: false,
	readOnly: false,
	tablet: false,
	fingerAction: "draw",
};

export type Hit =
	| { kind: "resize"; id: string; handle: Handle }
	| { kind: "conn-handle"; id: string; side: Side }
	| { kind: "conn-end"; id: string; end: "from" | "to" }
	| { kind: "bend"; id: string; index: number }
	| { kind: "bend-add"; id: string; at: Point; index: number }
	| { kind: "link-badge"; id: string }
	| { kind: "comment-badge"; id: string }
	| { kind: "block"; id: string }
	| { kind: "connector"; id: string; label: boolean }
	| { kind: "frame"; id: string; title: boolean };

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
