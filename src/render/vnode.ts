/**
 * A minimal virtual node used by the renderer. The same tree is turned into live SVG DOM
 * (editor) or into an SVG string (exports, embeds), so both always look identical.
 */

export type AttrValue = string | number | null | undefined | false;

export interface VNode {
	tag: string;
	attrs: Record<string, AttrValue>;
	children: VChild[];
}

export type VChild = VNode | string;

export const SVG_NS = "http://www.w3.org/2000/svg";

export function h(tag: string, attrs: Record<string, AttrValue> = {}, children: VChild[] = []): VNode {
	return { tag, attrs, children };
}

function escapeText(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
	return escapeText(s).replace(/"/g, "&quot;");
}

/** Strips characters that are not allowed in XML 1.0 documents. */
function xmlSafe(s: string): string {
	// eslint-disable-next-line no-control-regex -- removes characters that are invalid in XML
	return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "");
}

export function toSvgString(node: VChild): string {
	if (typeof node === "string") return escapeText(xmlSafe(node));
	let out = `<${node.tag}`;
	for (const [k, v] of Object.entries(node.attrs)) {
		if (v === null || v === undefined || v === false) continue;
		out += ` ${k}="${escapeAttr(xmlSafe(String(v)))}"`;
	}
	if (node.children.length === 0) return out + "/>";
	out += ">";
	for (const c of node.children) out += toSvgString(c);
	return out + `</${node.tag}>`;
}

export function toDom(node: VChild, doc: Document = document): Node {
	if (typeof node === "string") return doc.createTextNode(node);
	const el = doc.createElementNS(SVG_NS, node.tag);
	for (const [k, v] of Object.entries(node.attrs)) {
		if (v === null || v === undefined || v === false) continue;
		el.setAttribute(k, String(v));
	}
	for (const c of node.children) el.appendChild(toDom(c, doc));
	return el;
}
