import type { Side } from "../model/types";

export type Tool = "select" | "pan" | "block" | "connector" | "frame";

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
	/** Read-only mode (embeds/previews): no editing UI. */
	readOnly: boolean;
}

export const DEFAULT_EDITOR_OPTIONS: EditorOptions = {
	gridSize: 20,
	snapToGrid: true,
	showGrid: true,
	readOnly: false,
};

export type Hit =
	| { kind: "resize"; id: string; handle: Handle }
	| { kind: "conn-handle"; id: string; side: Side }
	| { kind: "conn-end"; id: string; end: "from" | "to" }
	| { kind: "link-badge"; id: string }
	| { kind: "block"; id: string }
	| { kind: "connector"; id: string; label: boolean }
	| { kind: "frame"; id: string; title: boolean };

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
