import { SVG_NS } from "../render/vnode";

/** Active element of the document that contains `node` (works in popout windows). */
export function activeElementOf(node: Node): Element | null {
	return node.ownerDocument?.activeElement ?? null;
}

/** Creates an HTML element (avoids depending on Obsidian's DOM helpers so the editor runs anywhere). */
export function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	cls?: string | null,
	parent?: HTMLElement | null,
	text?: string,
): HTMLElementTagNameMap[K] {
	const node = (parent?.ownerDocument ?? document).createElement(tag);
	if (cls) node.className = cls;
	if (text !== undefined) node.textContent = text;
	if (parent) parent.appendChild(node);
	return node;
}

export function svgEl<K extends keyof SVGElementTagNameMap>(
	tag: K,
	attrs: Record<string, string | number> = {},
	parent?: Element | null,
): SVGElementTagNameMap[K] {
	const node = (parent?.ownerDocument ?? document).createElementNS(SVG_NS, tag);
	for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
	if (parent) parent.appendChild(node);
	return node;
}

export function clearEl(node: Element): void {
	while (node.firstChild) node.removeChild(node.firstChild);
}

/** Focus is in a text field? (No instanceof checks: popout windows have their own DOM classes.) */
export function isTextInput(target: EventTarget | null): boolean {
	const node = target as HTMLElement | null;
	if (!node || node.nodeType !== 1) return false;
	if (node.isContentEditable) return true;
	const tag = node.tagName;
	if (tag === "TEXTAREA" || tag === "SELECT") return true;
	if (tag === "INPUT") {
		const type = (node as HTMLInputElement).type;
		return !["button", "checkbox", "radio", "range", "color", "submit"].includes(type);
	}
	return false;
}
