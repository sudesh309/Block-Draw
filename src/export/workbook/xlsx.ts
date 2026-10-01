import { strToU8, zipSync, type Zippable } from "fflate";
import {
	a1,
	columnLetter,
	parseCellKey,
	type BorderLine,
	type CellBorders,
	type CellModel,
	type CellStyle,
	type GridRange,
	type SheetModel,
	type TextRun,
	type WorkbookModel,
} from "./model";

/**
 * Minimal SpreadsheetML (.xlsx) writer for {@link WorkbookModel}: shared strings with rich text,
 * cell styles, merges, borders, hyperlinks (internal and external), frozen rows, filters,
 * tab colors and notes.
 */

const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const REL_HYPERLINK = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";
const REL_COMMENTS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments";
const REL_VML = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing";
const DEFAULT_FONT = "Arial";
const DEFAULT_SIZE = 10;
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function esc(s: string): string {
	return s
		// eslint-disable-next-line no-control-regex -- removes characters that are invalid in XML
		.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

const argb = (hex: string) => "FF" + hex.replace("#", "").toUpperCase().padStart(6, "0");

export const pxToColumnWidth = (px: number) => Math.max(0, Math.floor(((px - 5) / 7) * 100 + 0.5) / 100);
export const pxToPoints = (px: number) => Math.round(px * 0.75 * 100) / 100;

const BORDER_STYLE: Record<BorderLine["style"], string> = {
	thin: "thin",
	medium: "medium",
	thick: "thick",
	dashed: "dashed",
	dotted: "dotted",
};

/* ---------------------------------------------------------------- styles */

class StyleTable {
	fonts: string[] = [];
	fills: string[] = [];
	borders: string[] = [];
	xfs: string[] = [];
	private fontIdx = new Map<string, number>();
	private fillIdx = new Map<string, number>();
	private borderIdx = new Map<string, number>();
	private xfIdx = new Map<string, number>();

	constructor() {
		this.font({});
		this.fills.push('<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>');
		this.fillIdx.set("none", 0);
		this.fillIdx.set("gray125", 1);
		this.border(undefined);
		this.xf({});
	}

	private intern(map: Map<string, number>, list: string[], xml: string): number {
		let i = map.get(xml);
		if (i === undefined) {
			i = list.length;
			list.push(xml);
			map.set(xml, i);
		}
		return i;
	}

	font(s: { bold?: boolean; italic?: boolean; underline?: boolean; color?: string; fontSize?: number }): number {
		const xml =
			"<font>" +
			(s.bold ? "<b/>" : "") +
			(s.italic ? "<i/>" : "") +
			(s.underline ? "<u/>" : "") +
			`<sz val="${s.fontSize ?? DEFAULT_SIZE}"/>` +
			(s.color ? `<color rgb="${argb(s.color)}"/>` : '<color rgb="FF000000"/>') +
			`<name val="${DEFAULT_FONT}"/><family val="2"/></font>`;
		return this.intern(this.fontIdx, this.fonts, xml);
	}

	fill(bg?: string): number {
		if (!bg) return 0;
		const xml = `<fill><patternFill patternType="solid"><fgColor rgb="${argb(bg)}"/><bgColor indexed="64"/></patternFill></fill>`;
		return this.intern(this.fillIdx, this.fills, xml);
	}

	border(b?: CellBorders): number {
		const side = (name: string, line?: BorderLine) =>
			line ? `<${name} style="${BORDER_STYLE[line.style]}"><color rgb="${argb(line.color)}"/></${name}>` : `<${name}/>`;
		const xml = `<border>${side("left", b?.left)}${side("right", b?.right)}${side("top", b?.top)}${side("bottom", b?.bottom)}<diagonal/></border>`;
		return this.intern(this.borderIdx, this.borders, xml);
	}

	xf(style: CellStyle): number {
		const fontId = this.font(style);
		const fillId = this.fill(style.bg);
		const borderId = this.border(style.borders);
		const h = style.hAlign;
		const v = style.vAlign === "middle" ? "center" : style.vAlign;
		const align =
			h || v || style.wrap
				? `<alignment${h ? ` horizontal="${h}"` : ""}${v ? ` vertical="${v}"` : ""}${style.wrap ? ' wrapText="1"' : ""}/>`
				: "";
		const xml =
			`<xf numFmtId="0" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"` +
			(fontId ? ' applyFont="1"' : "") +
			(fillId ? ' applyFill="1"' : "") +
			(borderId ? ' applyBorder="1"' : "") +
			(align ? ' applyAlignment="1">' + align + "</xf>" : "/>");
		return this.intern(this.xfIdx, this.xfs, xml);
	}

	xml(): string {
		return (
			XML_HEAD +
			`<styleSheet xmlns="${NS_MAIN}">` +
			`<fonts count="${this.fonts.length}">${this.fonts.join("")}</fonts>` +
			`<fills count="${this.fills.length}">${this.fills.join("")}</fills>` +
			`<borders count="${this.borders.length}">${this.borders.join("")}</borders>` +
			'<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
			`<cellXfs count="${this.xfs.length}">${this.xfs.join("")}</cellXfs>` +
			'<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
			"</styleSheet>"
		);
	}
}

/* --------------------------------------------------------- shared strings */

class SharedStrings {
	items: string[] = [];
	private index = new Map<string, number>();
	count = 0;

	add(text: string, runs: TextRun[] | undefined, base: CellStyle | undefined): number {
		let xml: string;
		if (runs && runs.length) {
			const parts: string[] = [];
			const sorted = [...runs].sort((a, b) => a.start - b.start);
			if (sorted[0].start > 0) parts.push(`<r><t xml:space="preserve">${esc(text.slice(0, sorted[0].start))}</t></r>`);
			sorted.forEach((run, i) => {
				const end = i + 1 < sorted.length ? sorted[i + 1].start : text.length;
				const piece = text.slice(run.start, end);
				if (!piece) return;
				const bold = run.bold ?? base?.bold;
				const italic = run.italic ?? base?.italic;
				const underline = run.underline ?? base?.underline;
				const color = run.color ?? base?.color;
				const size = run.fontSize ?? base?.fontSize ?? DEFAULT_SIZE;
				const rpr =
					"<rPr>" +
					(bold ? "<b/>" : "") +
					(italic ? "<i/>" : "") +
					(underline ? '<u val="single"/>' : "") +
					`<sz val="${size}"/>` +
					(color ? `<color rgb="${argb(color)}"/>` : "") +
					`<rFont val="${DEFAULT_FONT}"/><family val="2"/></rPr>`;
				parts.push(`<r>${rpr}<t xml:space="preserve">${esc(piece)}</t></r>`);
			});
			xml = `<si>${parts.join("")}</si>`;
		} else {
			xml = `<si><t xml:space="preserve">${esc(text)}</t></si>`;
		}
		this.count++;
		let i = this.index.get(xml);
		if (i === undefined) {
			i = this.items.length;
			this.items.push(xml);
			this.index.set(xml, i);
		}
		return i;
	}

	xml(): string {
		return XML_HEAD + `<sst xmlns="${NS_MAIN}" count="${this.count}" uniqueCount="${this.items.length}">${this.items.join("")}</sst>`;
	}
}

/* ------------------------------------------------------------- worksheet */

function quoteSheet(title: string): string {
	return `'${title.replace(/'/g, "''")}'`;
}

/** Applies outlines to the edge cells of their ranges (Excel stores borders per cell). */
function cellsWithOutlines(sheet: SheetModel): Map<string, CellModel> {
	const cells = new Map(sheet.cells);
	const apply = (row: number, col: number, borders: CellBorders) => {
		const key = `${row}:${col}`;
		const prev = cells.get(key);
		cells.set(key, { ...prev, style: { ...prev?.style, borders: { ...prev?.style?.borders, ...borders } } });
	};
	for (const { range, line } of sheet.outlines) {
		const r1 = range.row + range.rows - 1;
		const c1 = range.col + range.cols - 1;
		for (let c = range.col; c <= c1; c++) {
			apply(range.row, c, { top: line });
			apply(r1, c, { bottom: line });
		}
		for (let r = range.row; r <= r1; r++) {
			apply(r, range.col, { left: line });
			apply(r, c1, { right: line });
		}
	}
	return cells;
}

interface SheetParts {
	xml: string;
	rels: string[];
	comments: { ref: string; text: string; row: number; col: number }[];
}

function buildSheetXml(
	sheet: SheetModel,
	index: number,
	styles: StyleTable,
	strings: SharedStrings,
	titleOf: (key: string) => string | undefined,
): SheetParts {
	const cells = cellsWithOutlines(sheet);
	const rels: string[] = [];
	const comments: SheetParts["comments"] = [];
	const hyperlinks: string[] = [];

	// group cells by row
	const rows = new Map<number, [number, CellModel][]>();
	let maxRow = sheet.rowCount - 1;
	let maxCol = sheet.colCount - 1;
	for (const [key, cell] of cells) {
		const [r, c] = parseCellKey(key);
		if (!rows.has(r)) rows.set(r, []);
		rows.get(r)?.push([c, cell]);
		maxRow = Math.max(maxRow, r);
		maxCol = Math.max(maxCol, c);
	}
	for (const r of sheet.rowHeights.keys()) if (!rows.has(r)) rows.set(r, []);

	const rowXml: string[] = [];
	for (const r of [...rows.keys()].sort((a, b) => a - b)) {
		const list = (rows.get(r) ?? []).sort((a, b) => a[0] - b[0]);
		const ht = sheet.rowHeights.get(r);
		const attrs = ht !== undefined ? ` ht="${pxToPoints(ht)}" customHeight="1"` : "";
		const cs: string[] = [];
		for (const [c, cell] of list) {
			const ref = a1(r, c);
			const s = cell.style ? styles.xf(cell.style) : 0;
			const sAttr = s ? ` s="${s}"` : "";
			if (typeof cell.value === "number") {
				cs.push(`<c r="${ref}"${sAttr}><v>${cell.value}</v></c>`);
			} else if (typeof cell.value === "string" && cell.value !== "") {
				const si = strings.add(cell.value, cell.runs, cell.style);
				cs.push(`<c r="${ref}"${sAttr} t="s"><v>${si}</v></c>`);
			} else if (s) {
				cs.push(`<c r="${ref}"${sAttr}/>`);
			}
			if (cell.link) {
				if (cell.link.type === "sheet") {
					const title = titleOf(cell.link.sheetKey);
					if (title) hyperlinks.push(`<hyperlink ref="${ref}" location="${esc(quoteSheet(title))}!A1"/>`);
				} else {
					const id = `rId${rels.length + 1}`;
					rels.push(`<Relationship Id="${id}" Type="${REL_HYPERLINK}" Target="${esc(cell.link.url)}" TargetMode="External"/>`);
					hyperlinks.push(`<hyperlink ref="${ref}" r:id="${id}"/>`);
				}
			}
			if (cell.note) comments.push({ ref, text: cell.note, row: r, col: c });
		}
		if (cs.length || attrs) rowXml.push(`<row r="${r + 1}"${attrs}>${cs.join("")}</row>`);
	}

	const cols: string[] = [];
	const defW = pxToColumnWidth(sheet.defaultColWidth);
	for (let c = 0; c <= maxCol; c++) {
		const px = sheet.colWidths.get(c);
		const w = px !== undefined ? pxToColumnWidth(px) : defW;
		cols.push(`<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`);
	}

	const frozen = sheet.frozenRows
		? `<pane ySplit="${sheet.frozenRows}" topLeftCell="A${sheet.frozenRows + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${sheet.frozenRows + 1}" sqref="A${sheet.frozenRows + 1}"/>`
		: "";
	const view =
		`<sheetViews><sheetView workbookViewId="0"${sheet.hideGridlines ? ' showGridLines="0"' : ""}${index === 0 ? ' tabSelected="1"' : ""}>` +
		frozen +
		"</sheetView></sheetViews>";

	const range = (g: GridRange) => `${a1(g.row, g.col)}:${a1(g.row + g.rows - 1, g.col + g.cols - 1)}`;
	const merges = sheet.merges.length
		? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((m) => `<mergeCell ref="${range(m)}"/>`).join("")}</mergeCells>`
		: "";
	const filter = sheet.filter ? `<autoFilter ref="${range(sheet.filter)}"/>` : "";
	const links = hyperlinks.length ? `<hyperlinks>${hyperlinks.join("")}</hyperlinks>` : "";
	let legacy = "";
	if (comments.length) {
		const base = rels.length;
		rels.push(`<Relationship Id="rId${base + 1}" Type="${REL_COMMENTS}" Target="../comments${index + 1}.xml"/>`);
		rels.push(`<Relationship Id="rId${base + 2}" Type="${REL_VML}" Target="../drawings/vmlDrawing${index + 1}.vml"/>`);
		legacy = `<legacyDrawing r:id="rId${base + 2}"/>`;
	}

	const xml =
		XML_HEAD +
		`<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
		(sheet.tabColor || sheet.print
			? "<sheetPr>" +
				(sheet.tabColor ? `<tabColor rgb="${argb(sheet.tabColor)}"/>` : "") +
				(sheet.print ? '<pageSetUpPr fitToPage="1"/>' : "") +
				"</sheetPr>"
			: "") +
		`<dimension ref="A1:${columnLetter(maxCol)}${maxRow + 1}"/>` +
		view +
		`<sheetFormatPr defaultRowHeight="${pxToPoints(sheet.defaultRowHeight)}" customHeight="1"/>` +
		`<cols>${cols.join("")}</cols>` +
		`<sheetData>${rowXml.join("")}</sheetData>` +
		filter +
		merges +
		links +
		'<pageMargins left="0.5" right="0.5" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>' +
		(sheet.print
			? `<pageSetup orientation="${sheet.print.landscape ? "landscape" : "portrait"}" fitToWidth="1" fitToHeight="${sheet.print.fitHeight ? 1 : 0}"/>`
			: "") +
		legacy +
		"</worksheet>";
	return { xml, rels, comments };
}

function commentsXml(comments: SheetParts["comments"]): string {
	return (
		XML_HEAD +
		`<comments xmlns="${NS_MAIN}"><authors><author>Block Draw</author></authors><commentList>` +
		comments
			.map(
				(c) =>
					`<comment ref="${c.ref}" authorId="0"><text><r><rPr><sz val="9"/><rFont val="${DEFAULT_FONT}"/><family val="2"/></rPr><t xml:space="preserve">${esc(c.text)}</t></r></text></comment>`,
			)
			.join("") +
		"</commentList></comments>"
	);
}

function vmlXml(comments: SheetParts["comments"], sheetIndex: number): string {
	const shapes = comments
		.map((c, i) => {
			const id = 1024 * (sheetIndex + 1) + i + 1;
			const anchor = `${c.col + 1}, 15, ${Math.max(0, c.row - 1)}, 2, ${c.col + 4}, 15, ${c.row + 5}, 16`;
			return (
				`<v:shape id="_x0000_s${id}" type="#_x0000_t202" style="position:absolute;margin-left:59.25pt;margin-top:1.5pt;width:180pt;height:90pt;z-index:${i + 1};visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto">` +
				'<v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/>' +
				'<v:textbox style="mso-direction-alt:auto"><div style="text-align:left"></div></v:textbox>' +
				`<x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:Anchor>${anchor}</x:Anchor><x:AutoFill>False</x:AutoFill><x:Row>${c.row}</x:Row><x:Column>${c.col}</x:Column></x:ClientData>` +
				"</v:shape>"
			);
		})
		.join("");
	return (
		'<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">' +
		`<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="${sheetIndex + 1}"/></o:shapelayout>` +
		'<v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>' +
		shapes +
		"</xml>"
	);
}

/* --------------------------------------------------------------- package */

export function writeXlsx(model: WorkbookModel, opts: { now?: Date; creator?: string } = {}): Uint8Array {
	const styles = new StyleTable();
	const strings = new SharedStrings();
	const titles = new Map(model.sheets.map((s) => [s.key, s.title]));
	const files: Zippable = {};
	const overrides: string[] = [];
	let hasComments = false;
	const definedNames: string[] = [];

	model.sheets.forEach((sheet, i) => {
		const parts = buildSheetXml(sheet, i, styles, strings, (key) => titles.get(key));
		files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(parts.xml);
		overrides.push(`<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
		if (parts.rels.length) {
			files[`xl/worksheets/_rels/sheet${i + 1}.xml.rels`] = strToU8(
				XML_HEAD + `<Relationships xmlns="${NS_PKG_REL}">${parts.rels.join("")}</Relationships>`,
			);
		}
		if (parts.comments.length) {
			hasComments = true;
			files[`xl/comments${i + 1}.xml`] = strToU8(commentsXml(parts.comments));
			files[`xl/drawings/vmlDrawing${i + 1}.vml`] = strToU8(vmlXml(parts.comments, i));
			overrides.push(`<Override PartName="/xl/comments${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/>`);
		}
		if (sheet.filter) {
			const f = sheet.filter;
			const ref = `${quoteSheet(sheet.title)}!$${columnLetter(f.col)}$${f.row + 1}:$${columnLetter(f.col + f.cols - 1)}$${f.row + f.rows}`;
			definedNames.push(`<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${esc(ref)}</definedName>`);
		}
	});

	const n = model.sheets.length;
	files["xl/workbook.xml"] = strToU8(
		XML_HEAD +
			`<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
			'<bookViews><workbookView activeTab="0"/></bookViews><sheets>' +
			model.sheets.map((s, i) => `<sheet name="${esc(s.title)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
			"</sheets>" +
			(definedNames.length ? `<definedNames>${definedNames.join("")}</definedNames>` : "") +
			"</workbook>",
	);
	files["xl/_rels/workbook.xml.rels"] = strToU8(
		XML_HEAD +
			`<Relationships xmlns="${NS_PKG_REL}">` +
			model.sheets
				.map(
					(_, i) =>
						`<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
				)
				.join("") +
			`<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
			`<Relationship Id="rId${n + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>` +
			"</Relationships>",
	);
	files["xl/styles.xml"] = strToU8(styles.xml());
	files["xl/sharedStrings.xml"] = strToU8(strings.xml());

	const created = (opts.now ?? new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
	files["docProps/core.xml"] = strToU8(
		XML_HEAD +
			'<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
			`<dc:title>${esc(model.title)}</dc:title><dc:creator>${esc(opts.creator ?? "Block Draw")}</dc:creator>` +
			`<dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified>` +
			"</cp:coreProperties>",
	);
	files["docProps/app.xml"] = strToU8(
		XML_HEAD +
			'<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Block Draw</Application></Properties>',
	);
	files["_rels/.rels"] = strToU8(
		XML_HEAD +
			`<Relationships xmlns="${NS_PKG_REL}">` +
			'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
			'<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
			'<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
			"</Relationships>",
	);
	files["[Content_Types].xml"] = strToU8(
		XML_HEAD +
			'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
			'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
			'<Default Extension="xml" ContentType="application/xml"/>' +
			(hasComments ? '<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>' : "") +
			'<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
			'<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
			'<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
			'<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
			'<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
			overrides.join("") +
			"</Types>",
	);
	return zipSync(files, { level: 6 });
}
