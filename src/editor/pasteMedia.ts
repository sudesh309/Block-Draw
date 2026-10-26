import type { Point } from "../geometry/geom";
import { MAX_IMAGE_CHARS, readTable, tableFromText } from "../model/media";
import { tableSize } from "../render/media";
import type { Editor } from "./Editor";

/** Pictures and tables from the system clipboard, put on the canvas as blocks. */

/** What was on the clipboard, read at once (a paste event's data is gone once the handler returns). */
export interface ClipboardContent {
	text: string;
	html: string;
	images: Blob[];
}

const MAX_SIDE = 1600;
const KEEP_AS_IS_CHARS = 600_000;
const ACCEPTED = ["image/png", "image/jpeg", "image/gif", "image/webp"];

function readAsDataUri(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
		reader.onerror = () => reject(new Error("unreadable"));
		reader.readAsDataURL(blob);
	});
}

function loadImage(uri: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error("not a picture"));
		img.src = uri;
	});
}

/** A picture as a data address no larger than a file may hold, scaled down when it is big. Null if it cannot be read. */
export async function prepareImage(blob: Blob): Promise<{ src: string; width: number; height: number } | null> {
	if (!ACCEPTED.includes(blob.type)) return null;
	try {
		const original = await readAsDataUri(blob);
		const img = await loadImage(original);
		const width = img.naturalWidth;
		const height = img.naturalHeight;
		if (!width || !height) return null;
		if (original.length <= KEEP_AS_IS_CHARS && Math.max(width, height) <= MAX_SIDE) return { src: original, width, height };
		const canvas = createEl("canvas");
		const context = canvas.getContext("2d");
		if (!context) return null;
		const type = blob.type === "image/jpeg" ? "image/jpeg" : "image/png";
		for (const side of [MAX_SIDE, 1200, 800, 500]) {
			const k = Math.min(1, side / Math.max(width, height));
			canvas.width = Math.max(1, Math.round(width * k));
			canvas.height = Math.max(1, Math.round(height * k));
			context.clearRect(0, 0, canvas.width, canvas.height);
			context.drawImage(img, 0, 0, canvas.width, canvas.height);
			const src = canvas.toDataURL(type, 0.85);
			if (src.length <= Math.min(MAX_IMAGE_CHARS, 1_500_000)) return { src, width: canvas.width, height: canvas.height };
		}
	} catch {
		// unreadable: not pasted
	}
	return null;
}

/** The first table in HTML (spreadsheets, web pages and notes copy one), as rows of cell text. */
export function tableFromHtml(html: string): string[][] | null {
	if (!/<table[\s>]/i.test(html)) return null;
	const doc = new DOMParser().parseFromString(html, "text/html");
	const table = doc.querySelector("table");
	if (!table) return null;
	const rows: string[][] = [];
	for (const tr of Array.from(table.querySelectorAll("tr"))) {
		if (tr.closest("table") !== table) continue;
		const cells: string[] = [];
		for (const cell of Array.from(tr.children)) {
			if (cell.tagName !== "TD" && cell.tagName !== "TH") continue;
			cells.push((cell.textContent ?? "").replace(/\s+/g, " ").trim());
			const span = Math.min(30, Math.max(1, Number(cell.getAttribute("colspan")) || 1));
			for (let i = 1; i < span; i++) cells.push("");
		}
		if (cells.length) rows.push(cells);
	}
	const read = readTable(rows);
	return read && (read.length > 1 || read[0].length > 1) ? read : null;
}

function center(ed: Editor, at?: Point): Point {
	if (at) return at;
	const size = ed.viewSize();
	return ed.screenToWorld({ x: size.width / 2, y: size.height / 2 });
}

function placed(ed: Editor, p: Point, width: number, height: number): Point {
	return ed.snapPoint({ x: p.x - width / 2, y: p.y - height / 2 });
}

export function pasteTable(ed: Editor, table: string[][], at?: Point): void {
	const fontSize = 14;
	const { width, height } = tableSize(table, fontSize);
	const pos = placed(ed, center(ed, at), width, height);
	const block = ed.makeBlock(
		{ x: pos.x, y: pos.y, width, height },
		{ shape: "rectangle", table, style: { ...ed.current.block, fill: "#ffffff", textColor: "#212529", fontSize, strokeWidth: 1 } },
	);
	ed.insertBlocks([block]);
}

export async function pastePicture(ed: Editor, blob: Blob, at?: Point): Promise<boolean> {
	const image = await prepareImage(blob);
	if (ed.destroyed) return false;
	if (!image) {
		ed.host.notice("That picture could not be pasted: it is not a PNG, JPEG, GIF or WebP, or it is too large.");
		return false;
	}
	const k = Math.min(1, 480 / Math.max(image.width, image.height));
	const width = Math.max(20, Math.round(image.width * k));
	const height = Math.max(20, Math.round(image.height * k));
	const pos = placed(ed, center(ed, at), width, height);
	const block = ed.makeBlock(
		{ x: pos.x, y: pos.y, width, height },
		{ shape: "rectangle", image: image.src, style: { ...ed.current.block, fill: "transparent", strokeWidth: 0 } },
	);
	ed.insertBlocks([block]);
	return true;
}

/**
 * Pastes a table or a picture when the clipboard holds one. A table wins over a picture, because a
 * spreadsheet copies both (its picture is a snapshot of the cells). False when there is neither.
 */
export function pasteRich(ed: Editor, content: ClipboardContent, at?: Point): boolean {
	const table = tableFromHtml(content.html) ?? tableFromText(content.text);
	if (table) {
		pasteTable(ed, table, at);
		return true;
	}
	const image = content.images.find((b) => ACCEPTED.includes(b.type));
	if (!image) return false;
	void pastePicture(ed, image, at);
	return true;
}
