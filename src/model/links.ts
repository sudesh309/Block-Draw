/**
 * Block links are stored as plain strings:
 *  - `frame:<frameId>`        → a frame in the same drawing
 *  - `[[path#subpath|alias]]` → a file in the vault (any Obsidian link text)
 *  - `https://…` and other URI schemes → external URL
 */

export type ParsedLink =
	| { kind: "frame"; frameId: string }
	| { kind: "note"; linktext: string; path: string; subpath: string; display: string }
	| { kind: "url"; url: string };

const FRAME_PREFIX = "frame:";
const URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const MAILTO_RE = /^mailto:/i;

export function frameLink(frameId: string): string {
	return FRAME_PREFIX + frameId;
}

export function parseFrameLink(link: string | null | undefined): string | null {
	if (!link || !link.startsWith(FRAME_PREFIX)) return null;
	const id = link.slice(FRAME_PREFIX.length).trim();
	return id || null;
}

export function parseLink(link: string | null | undefined): ParsedLink | null {
	if (!link) return null;
	const raw = link.trim();
	if (!raw) return null;
	const frameId = parseFrameLink(raw);
	if (frameId) return { kind: "frame", frameId };
	if (URL_RE.test(raw) || MAILTO_RE.test(raw)) return { kind: "url", url: raw };

	let inner = raw;
	if (inner.startsWith("[[") && inner.endsWith("]]")) inner = inner.slice(2, -2);
	let display = "";
	const pipe = inner.indexOf("|");
	if (pipe >= 0) {
		display = inner.slice(pipe + 1).trim();
		inner = inner.slice(0, pipe);
	}
	inner = inner.trim();
	if (!inner) return null;
	const hash = inner.indexOf("#");
	const path = hash >= 0 ? inner.slice(0, hash) : inner;
	const subpath = hash >= 0 ? inner.slice(hash) : "";
	return {
		kind: "note",
		linktext: inner,
		path,
		subpath,
		display: display || inner.replace(/^.*\//, ""),
	};
}

/** Normalizes user input into the stored link format. */
export function normalizeLinkInput(input: string): string | null {
	const parsed = parseLink(input);
	if (!parsed) return null;
	if (parsed.kind === "frame") return frameLink(parsed.frameId);
	if (parsed.kind === "url") return parsed.url;
	return `[[${parsed.linktext}${parsed.display && parsed.display !== parsed.linktext.replace(/^.*\//, "") ? "|" + parsed.display : ""}]]`;
}
