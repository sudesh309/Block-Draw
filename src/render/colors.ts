import { COLOR_AUTO, COLOR_DEFAULT, COLOR_TRANSPARENT } from "../model/types";

/** Concrete (or CSS-variable) colors the renderer needs besides element colors. */
export interface RenderTheme {
	/** Default stroke/text color ("ink"). */
	ink: string;
	/** Canvas background (used behind connector labels). */
	background: string;
	frameStroke: string;
	frameTitle: string;
	/** Text color used on light fills / on dark fills when the text color is "auto". */
	darkText: string;
	lightText: string;
}

export const LIGHT_THEME: RenderTheme = {
	ink: "#1e1e1e",
	background: "#ffffff",
	frameStroke: "#adb5bd",
	frameTitle: "#495057",
	darkText: "#1e1e1e",
	lightText: "#ffffff",
};

export const DARK_THEME: RenderTheme = {
	ink: "#e3e3e3",
	background: "#1e1e1e",
	frameStroke: "#5c5f66",
	frameTitle: "#adb5bd",
	darkText: "#1e1e1e",
	lightText: "#ffffff",
};

/** Theme for the live canvas: follows Obsidian's light/dark theme via CSS variables. */
export const SCREEN_THEME: RenderTheme = {
	ink: "var(--bd-ink)",
	background: "var(--bd-canvas-bg)",
	frameStroke: "var(--bd-frame-stroke)",
	frameTitle: "var(--bd-frame-title)",
	darkText: "#1e1e1e",
	lightText: "#ffffff",
};

export type PaletteId = "classic" | "minimal" | "futuristic";

export interface Palette {
	id: PaletteId;
	name: string;
	fills: string[];
	strokes: string[];
	frameFills: string[];
}

/** Swatch sets offered in the properties panel. */
export const PALETTES: Palette[] = [
	{
		id: "classic",
		name: "Classic",
		fills: [COLOR_TRANSPARENT, "#ffffff", "#e9ecef", "#ffc9c9", "#ffd8a8", "#ffec99", "#b2f2bb", "#a5d8ff", "#d0bfff", "#fcc2d7"],
		strokes: [COLOR_DEFAULT, "#868e96", "#e03131", "#f08c00", "#2f9e44", "#1971c2", "#6741d9", "#c2255c"],
		frameFills: [COLOR_TRANSPARENT, "#f8f9fa", "#fff5f5", "#fff9db", "#ebfbee", "#e7f5ff", "#f3f0ff"],
	},
	{
		id: "minimal",
		name: "Minimal",
		fills: [COLOR_TRANSPARENT, "#ffffff", "#f8f9fa", "#f1f3f5", "#e9ecef", "#dee2e6", "#e7f5ff", "#495057", "#212529"],
		strokes: [COLOR_DEFAULT, "#212529", "#495057", "#868e96", "#ced4da", "#1c7ed6"],
		frameFills: [COLOR_TRANSPARENT, "#ffffff", "#f8f9fa", "#f1f3f5"],
	},
	{
		id: "futuristic",
		name: "Futuristic",
		fills: [COLOR_TRANSPARENT, "#0b1020", "#111827", "#1e1b4b", "#0f2e3d", "#22d3ee", "#a78bfa", "#f472b6", "#a3e635", "#fbbf24"],
		strokes: [COLOR_DEFAULT, "#22d3ee", "#a78bfa", "#f472b6", "#a3e635", "#fbbf24", "#38bdf8", "#e2e8f0"],
		frameFills: [COLOR_TRANSPARENT, "#0b1020", "#0f172a", "#111827", "#1e1b4b"],
	},
];

export function paletteById(id: string): Palette {
	return PALETTES.find((p) => p.id === id) ?? PALETTES[0];
}

export const FILL_SWATCHES = PALETTES[0].fills;
export const STROKE_SWATCHES = PALETTES[0].strokes;
export const FRAME_FILL_SWATCHES = PALETTES[0].frameFills;

export interface Rgba {
	r: number;
	g: number;
	b: number;
	a: number;
}

export function parseColor(input: string | null | undefined): Rgba | null {
	if (!input) return null;
	const s = input.trim().toLowerCase();
	if (s === COLOR_TRANSPARENT) return { r: 0, g: 0, b: 0, a: 0 };
	let m = /^#([0-9a-f]{3,8})$/.exec(s);
	if (m) {
		const hex = m[1];
		if (hex.length === 3 || hex.length === 4) {
			const [r, g, b, a] = hex.split("").map((c) => parseInt(c + c, 16));
			return { r, g, b, a: hex.length === 4 ? a / 255 : 1 };
		}
		if (hex.length === 6 || hex.length === 8) {
			const r = parseInt(hex.slice(0, 2), 16);
			const g = parseInt(hex.slice(2, 4), 16);
			const b = parseInt(hex.slice(4, 6), 16);
			const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
			return { r, g, b, a };
		}
		return null;
	}
	m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
	if (m) {
		let a = 1;
		if (m[4] !== undefined) a = m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
		return { r: Math.min(255, +m[1]), g: Math.min(255, +m[2]), b: Math.min(255, +m[3]), a: Math.min(1, a) };
	}
	const named: Record<string, string> = {
		black: "#000000",
		white: "#ffffff",
		red: "#ff0000",
		green: "#008000",
		blue: "#0000ff",
		yellow: "#ffff00",
		orange: "#ffa500",
		purple: "#800080",
		gray: "#808080",
		grey: "#808080",
	};
	return named[s] ? parseColor(named[s]) : null;
}

/** `#rrggbb` (alpha composited onto white), or null when the color is unknown/transparent. */
export function toHex6(input: string | null | undefined): string | null {
	const c = parseColor(input);
	if (!c || c.a === 0) return null;
	const mix = (v: number) => Math.round(v * c.a + 255 * (1 - c.a));
	return "#" + [mix(c.r), mix(c.g), mix(c.b)].map((v) => v.toString(16).padStart(2, "0")).join("");
}

export function relativeLuminance(c: Rgba): number {
	const ch = (v: number) => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
	};
	return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

export function isTransparent(color: string | null | undefined): boolean {
	if (!color || color === COLOR_TRANSPARENT) return true;
	const c = parseColor(color);
	return !!c && c.a === 0;
}

export function resolveStroke(color: string, theme: RenderTheme): string {
	return !color || color === COLOR_DEFAULT ? theme.ink : color;
}

export function resolveFill(color: string): string | null {
	return isTransparent(color) ? null : color;
}

/** Text color for a block: explicit color, or readable on its fill ("auto"). */
export function resolveTextColor(textColor: string, fill: string, theme: RenderTheme): string {
	if (textColor && textColor !== COLOR_AUTO) return textColor === COLOR_DEFAULT ? theme.ink : textColor;
	const c = isTransparent(fill) ? null : parseColor(fill);
	if (!c) return theme.ink;
	if (c.a < 0.5) return theme.ink;
	return relativeLuminance(c) > 0.35 ? theme.darkText : theme.lightText;
}

/**
 * Mixes a concrete color toward black (amount > 0) or white (amount < 0); null when the color
 * can't be parsed (CSS variables, "default", transparent).
 */
export function shadeColor(color: string, amount: number): string | null {
	const c = parseColor(color);
	if (!c || c.a === 0) return null;
	const target = amount > 0 ? 0 : 255;
	const t = Math.min(1, Math.abs(amount));
	const mix = (v: number) => Math.round(v + (target - v) * t);
	return "#" + [mix(c.r), mix(c.g), mix(c.b)].map((v) => v.toString(16).padStart(2, "0")).join("");
}
