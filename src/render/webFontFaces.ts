import { PRESENTATION_FONTS } from "./fonts";

/** One `@font-face` rule of Google's stylesheet, ready for the FontFace API. */
export interface WebFontFace {
	family: string;
	/** A single `url(https://fonts.gstatic.com/…)` source, optionally followed by `format(…)`. */
	source: string;
	descriptors: FontFaceDescriptors;
}

const FAMILIES = new Set(PRESENTATION_FONTS.filter((f) => f.web).map((f) => f.name));

/** Only Google's own font host, one source per rule: the stylesheet comes from the network, so it is checked. */
const SOURCE = /^url\(\s*(["']?)https:\/\/fonts\.gstatic\.com\/[\w.~%+/-]+\1\s*\)(?:\s+format\(\s*(["']?)[\w-]+\2\s*\))?$/;

const unquote = (s: string): string => s.replace(/^\s*(["'])(.*)\1\s*$/, "$2");

/**
 * Reads the `@font-face` rules of the Google Fonts stylesheet. Rules for other families or from other
 * hosts are skipped, so the result can be handed to `new FontFace(family, source, descriptors)` as is.
 */
export function parseWebFontFaces(css: string): WebFontFace[] {
	const faces: WebFontFace[] = [];
	for (const rule of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/@font-face\s*\{([^}]*)\}/g)) {
		const decl: Record<string, string> = {};
		for (const d of rule[1].matchAll(/([a-z-]+)\s*:\s*([^;]+?)\s*(?:;|$)/g)) decl[d[1]] = d[2];
		const family = unquote(decl["font-family"] ?? "");
		const source = decl.src ?? "";
		if (!FAMILIES.has(family) || !SOURCE.test(source)) continue;
		const descriptors: FontFaceDescriptors = { display: "swap" };
		if (decl["font-style"]) descriptors.style = decl["font-style"];
		if (decl["font-weight"]) descriptors.weight = decl["font-weight"];
		if (decl["font-stretch"]) descriptors.stretch = decl["font-stretch"];
		if (decl["unicode-range"]) descriptors.unicodeRange = decl["unicode-range"];
		faces.push({ family, source, descriptors });
	}
	return faces;
}
