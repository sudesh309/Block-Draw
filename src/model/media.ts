/** Pictures and tables on blocks: what a file may hold, and the repairs applied to what it holds. */

/** A picture is stored as a data address of one of these types, so a drawing never loads anything from the network. */
const IMAGE_ADDRESS = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/** The most characters one picture may take in a file (about 2.2 MB of image). */
export const MAX_IMAGE_CHARS = 3_000_000;

export const MAX_TABLE_ROWS = 200;
export const MAX_TABLE_COLUMNS = 30;
export const MAX_CELL_CHARS = 500;

export function readImage(v: unknown): string | null {
	return typeof v === "string" && v.length <= MAX_IMAGE_CHARS && IMAGE_ADDRESS.test(v) ? v : null;
}

/** Rows of cells, every row as long as the longest; null when nothing usable is there. */
export function readTable(v: unknown): string[][] | null {
	if (!Array.isArray(v)) return null;
	const rows: string[][] = [];
	for (const row of v.slice(0, MAX_TABLE_ROWS)) {
		if (!Array.isArray(row)) continue;
		rows.push(row.slice(0, MAX_TABLE_COLUMNS).map((c) => (typeof c === "string" ? c.slice(0, MAX_CELL_CHARS) : "")));
	}
	const width = Math.max(0, ...rows.map((r) => r.length));
	if (!rows.length || !width) return null;
	return rows.map((r) => (r.length === width ? r : [...r, ...Array<string>(width - r.length).fill("")]));
}

/** Tab-separated text (what spreadsheets copy), with "quoted" cells that may hold tabs and line breaks. */
function parseTsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;
	let atStart = true;
	const endCell = () => {
		row.push(cell);
		cell = "";
		atStart = true;
	};
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (quoted) {
			if (ch === '"' && text[i + 1] === '"') {
				cell += '"';
				i++;
			} else if (ch === '"') quoted = false;
			else cell += ch;
		} else if (ch === '"' && atStart) {
			quoted = true;
			atStart = false;
		} else if (ch === "\t") endCell();
		else if (ch === "\n" || ch === "\r") {
			if (ch === "\r" && text[i + 1] === "\n") i++;
			endCell();
			rows.push(row);
			row = [];
		} else {
			cell += ch;
			atStart = false;
		}
	}
	if (cell || row.length) {
		endCell();
		rows.push(row);
	}
	return rows;
}

const SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function parseMarkdownRow(line: string): string[] {
	let s = line.trim();
	if (s.startsWith("|")) s = s.slice(1);
	if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
	return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

/** A table in text form: a Markdown table, or tab-separated rows with at least two columns. Null for anything else. */
export function tableFromText(text: string): string[][] | null {
	const lines = text.replace(/\s+$/, "").split(/\r\n|\n|\r/);
	if (lines.length >= 2 && lines[0].includes("|") && SEPARATOR.test(lines[1]) && lines[1].includes("-")) {
		const rows = [lines[0], ...lines.slice(2)].filter((l) => l.trim()).map(parseMarkdownRow);
		return readTable(rows);
	}
	if (!text.includes("\t")) return null;
	const rows = parseTsv(text.replace(/[\r\n]+$/, ""));
	const table = readTable(rows);
	return table && table[0].length >= 2 ? table : null;
}
