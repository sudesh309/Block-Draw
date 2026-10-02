import { shapePath } from "../../geometry/shapes";
import type { HistoryEntry } from "../../model/history";
import { frameLink, parseFrameLink, parseLink } from "../../model/links";
import { updateElements } from "../../model/ops";
import {
	BLOCK_SHAPES,
	isBlock,
	isBox,
	isConnector,
	isFrame,
	type ArrowHead,
	type BlockShape,
	type DrawElement,
	type Routing,
	type StrokeStyle,
	type TextAlign,
	type TextVAlign,
} from "../../model/types";
import { DRAWING_THEMES } from "../../model/themes";
import { PALETTES, paletteById, type PaletteId } from "../../render/colors";
import { fontDefinitionById, PRESENTATION_FONTS, type FontFamilyId } from "../../render/fonts";
import { activeElementOf, clearEl, el, svgEl } from "../dom";
import type { Editor } from "../Editor";
import { iconButton, section, segmented, swatches, textField } from "./controls";

const SHAPE_LABELS: Record<BlockShape, string> = {
	rounded: "Rounded",
	rectangle: "Rectangle",
	ellipse: "Ellipse",
	diamond: "Decision",
	parallelogram: "Input / output",
	hexagon: "Preparation",
	cylinder: "Database",
	text: "Text only",
};

const FONT_SIZES: { value: number; label: string; text: string }[] = [
	{ value: 12, label: "Small", text: "S" },
	{ value: 16, label: "Medium", text: "M" },
	{ value: 20, label: "Large", text: "L" },
	{ value: 28, label: "Extra large", text: "XL" },
];

const line = (svg: SVGSVGElement, attrs: Record<string, string | number>) =>
	svgEl("path", { fill: "none", stroke: "currentColor", "stroke-linecap": "round", "stroke-linejoin": "round", ...attrs }, svg);

function drawShape(shape: BlockShape) {
	return (svg: SVGSVGElement) => {
		const g = svgEl("g", { transform: "translate(2,5)" }, svg);
		svgEl(
			"path",
			{
				d: shapePath(shape, 20, 14),
				fill: "none",
				stroke: "currentColor",
				"stroke-width": 1.6,
				"stroke-dasharray": shape === "text" ? "2 2" : "",
			},
			g,
		);
	};
}

function drawArrow(kind: ArrowHead, atStart: boolean) {
	return (svg: SVGSVGElement) => {
		const g = svgEl("g", atStart ? { transform: "translate(24,0) scale(-1,1)" } : {}, svg);
		line(g as unknown as SVGSVGElement, { d: "M3 12 H19", "stroke-width": 1.8 });
		if (kind === "arrow") line(g as unknown as SVGSVGElement, { d: "M15 8 L20 12 L15 16", "stroke-width": 1.8 });
		if (kind === "triangle") svgEl("path", { d: "M14 7.5 L21 12 L14 16.5 Z", fill: "currentColor" }, g);
		if (kind === "dot") svgEl("circle", { cx: 18.5, cy: 12, r: 3, fill: "currentColor" }, g);
	};
}

export class PropsPanel {
	readonly el: HTMLDivElement;
	private readonly body: HTMLDivElement;
	private key = "";
	private syncers: (() => void)[] = [];
	private textBefore: HistoryEntry | null = null;

	constructor(private readonly ed: Editor) {
		this.el = el("div", "bd-props bd-panel", ed.root);
		this.body = el("div", "bd-props-body", this.el);
		this.el.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
	}

	/** Rebuilds the panel on the next render (e.g. after the palette changed). */
	refresh(): void {
		this.key = "";
		this.ed.requestRender();
	}

	update(): void {
		const ed = this.ed;
		const sel = ed.selectedElements();
		let mode: "selection" | "block" | "connector" | "frame" | null = null;
		if (sel.length) mode = "selection";
		else if (ed.tool === "block") mode = "block";
		else if (ed.tool === "connector") mode = "connector";
		else if (ed.tool === "frame") mode = "frame";
		if (ed.options.readOnly || !mode || ed.editingId || ed.pointer.isBusy()) {
			this.el.classList.remove("is-visible");
			if (!ed.pointer.isBusy()) this.key = "";
			return;
		}
		const key = `${mode}:${ed.tool}:${sel.map((e) => e.id).join(",")}`;
		if (key !== this.key) {
			this.key = key;
			this.build(mode, sel);
		} else {
			for (const sync of this.syncers) sync();
		}
		this.el.classList.add("is-visible");
	}

	/* ------------------------------------------------------------------ */

	private textHandlers(id: string, field: "description" | "label" | "title" | "comment" | "tag") {
		const ed = this.ed;
		return {
			onFocus: () => {
				this.textBefore = ed.snapshot();
			},
			onInput: (value: string) => {
				ed.setTransient(updateElements(ed.elements, new Map([[id, { [field]: value }]])));
			},
			onCommit: () => {
				const before = this.textBefore;
				this.textBefore = null;
				if (before) ed.commit(ed.elements, { before });
			},
		};
	}

	private build(mode: "selection" | "block" | "connector" | "frame", sel: DrawElement[]): void {
		const ed = this.ed;
		const prevScroll = this.el.scrollTop;
		clearEl(this.body);
		this.syncers = [];
		const blocks = sel.filter(isBlock);
		const connectors = sel.filter(isConnector);
		const frames = sel.filter(isFrame);
		const single = sel.length === 1 ? sel[0] : null;

		const heading = el("div", "bd-props-heading", this.body);
		if (mode === "block") heading.textContent = "New block";
		else if (mode === "connector") heading.textContent = "New connector";
		else if (mode === "frame") heading.textContent = "New frame";
		else if (single) heading.textContent = isBlock(single) ? "Block" : isConnector(single) ? "Connector" : "Frame";
		else heading.textContent = `${sel.length} selected`;

		const blockStyle = () => ed.selectedBlocks()[0]?.style ?? ed.current.block;
		const connector = () => ed.selectedConnectors()[0] ?? null;
		const connStyle = () => connector()?.style ?? ed.current.connector;
		const frameStyle = () => ed.selectedFrames()[0]?.style ?? ed.current.frame;
		const palette = paletteById(ed.palette);

		/* ---- frame details */
		if (isFrame(single)) {
			const id = single.id;
			const s = section(this.body, "Title");
			this.syncers.push(
				textField(s, {
					get: () => {
						const f = ed.byId.get(id);
						return isFrame(f) ? f.title : "";
					},
					...this.textHandlers(id, "title"),
				}),
			);
			const d = section(this.body, "Description");
			this.syncers.push(
				textField(d, {
					multiline: true,
					placeholder: "Shown under the sheet title on export",
					get: () => {
						const f = ed.byId.get(id);
						return isFrame(f) ? f.description : "";
					},
					...this.textHandlers(id, "description"),
				}),
			);
		}

		/* ---- block details */
		if (isBlock(single)) {
			const id = single.id;
			const tagSec = section(this.body, "Tag (technology or role)");
			this.syncers.push(
				textField(tagSec, {
					placeholder: "e.g. Service · Java, PostgreSQL, AWS Lambda",
					get: () => {
						const b = ed.byId.get(id);
						return isBlock(b) ? b.tag : "";
					},
					...this.textHandlers(id, "tag"),
				}),
			);
			this.buildLinkSection(id);
			const d = section(this.body, "Description");
			this.syncers.push(
				segmented(
					d,
					[
						{ value: false, label: "Hide the description on the block", text: "Hidden" },
						{ value: true, label: "Show the description on the block", text: "Shown" },
					],
					() => {
						const b = ed.byId.get(id);
						return isBlock(b) ? b.descriptionOpen : true;
					},
					(descriptionOpen: boolean) => ed.updateElement(id, { descriptionOpen }),
				),
			);
			this.syncers.push(
				textField(d, {
					multiline: true,
					placeholder: "Optional details shown under the title",
					get: () => {
						const b = ed.byId.get(id);
						return isBlock(b) ? b.description : "";
					},
					...this.textHandlers(id, "description"),
				}),
			);
			this.buildCommentSection(id);
		}

		/* ---- connector details */
		if (isConnector(single)) {
			const id = single.id;
			const s = section(this.body, "Label");
			this.syncers.push(
				textField(s, {
					multiline: true,
					placeholder: "e.g. yes / no",
					get: () => {
						const c = ed.byId.get(id);
						return isConnector(c) ? c.label : "";
					},
					...this.textHandlers(id, "label"),
				}),
			);
			this.buildCommentSection(id);
		}

		/* ---- block style */
		if (mode === "block" || blocks.length) {
			const shapeSec = section(this.body, "Shape");
			this.syncers.push(
				segmented(
					shapeSec,
					BLOCK_SHAPES.map((shape) => ({ value: shape, label: SHAPE_LABELS[shape], draw: drawShape(shape) })),
					() => ed.selectedBlocks()[0]?.shape ?? (ed.tool === "block" ? ed.toolShape : ed.current.shape),
					(shape: BlockShape) => ed.applyShape(shape),
				),
			);
			this.paletteRow();
			this.syncers.push(swatches(section(this.body, "Fill"), palette.fills, () => blockStyle().fill, (fill) => ed.applyBlockStyle({ fill })));
			this.syncers.push(
				swatches(section(this.body, "Stroke"), palette.strokes, () => blockStyle().stroke, (stroke) => ed.applyBlockStyle({ stroke })),
			);
			this.syncers.push(
				segmented(
					section(this.body, "Depth"),
					[
						{ value: false, label: "Flat", text: "Flat" },
						{ value: true, label: "Raised 3D tile", text: "3D" },
					],
					() => blockStyle().threeD,
					(threeD: boolean) => ed.applyBlockStyle({ threeD }),
				),
			);
			this.strokeControls(
				() => blockStyle().strokeWidth,
				(strokeWidth) => ed.applyBlockStyle({ strokeWidth }),
				() => blockStyle().strokeStyle,
				(strokeStyle) => ed.applyBlockStyle({ strokeStyle }),
			);
			const textSec = section(this.body, "Text");
			const fontRow = el("div", "bd-font-row", textSec);
			const fontSelect = el("select", "bd-select bd-font-select dropdown", fontRow);
			fontSelect.setAttribute("aria-label", "Font family");
			for (const f of PRESENTATION_FONTS) {
				const opt = el("option", null, fontSelect, `${f.name} — ${f.tagline}`);
				opt.value = f.id;
			}
			const fontNote = el(
				"div",
				"bd-field-note",
				textSec,
				"Shown in this font if it is installed on your device, otherwise in a similar one. To download it, turn on web fonts in Settings → Block Draw.",
			);
			const syncFont = () => {
				const current = blockStyle().fontFamily;
				if (activeElementOf(fontSelect) !== fontSelect) {
					fontSelect.value = current;
				}
				fontNote.hidden = ed.options.webFonts || !fontDefinitionById(fontSelect.value).web;
			};
			fontSelect.addEventListener("change", () => {
				const chosen = fontSelect.value as FontFamilyId;
				ed.applyBlockStyle({ fontFamily: chosen });
				syncFont();
			});
			syncFont();
			this.syncers.push(syncFont);

			this.syncers.push(
				segmented(
					textSec,
					FONT_SIZES.map((f) => ({ value: f.value, label: f.label, text: f.text })),
					() => blockStyle().fontSize,
					(fontSize: number) => ed.applyBlockStyle({ fontSize }),
				),
			);
			this.syncers.push(
				segmented(
					textSec,
					[
						{ value: "left", label: "Align left", icon: "text-left" },
						{ value: "center", label: "Align center", icon: "text-center" },
						{ value: "right", label: "Align right", icon: "text-right" },
					],
					() => blockStyle().textAlign,
					(textAlign: TextAlign) => ed.applyBlockStyle({ textAlign }),
				),
			);
			this.syncers.push(
				segmented(
					textSec,
					[
						{ value: "top", label: "Align text to the top", icon: "valign-top" },
						{ value: "middle", label: "Align text to the middle", icon: "valign-middle" },
						{ value: "bottom", label: "Align text to the bottom", icon: "valign-bottom" },
					],
					() => blockStyle().textVAlign,
					(textVAlign: TextVAlign) => ed.applyBlockStyle({ textVAlign }),
				),
			);
		}

		/* ---- connector style */
		if (mode === "connector" || connectors.length) {
			const routeSec = section(this.body, "Line");
			this.syncers.push(
				segmented(
					routeSec,
					[
						{ value: "elbow", label: "Elbow", draw: (s: SVGSVGElement) => void line(s, { d: "M4 19 H12 V5 H20", "stroke-width": 1.8 }) },
						{ value: "straight", label: "Straight", draw: (s: SVGSVGElement) => void line(s, { d: "M4 19 L20 5", "stroke-width": 1.8 }) },
						{ value: "curved", label: "Curved", draw: (s: SVGSVGElement) => void line(s, { d: "M4 19 C14 19 10 5 20 5", "stroke-width": 1.8 }) },
					],
					() => connector()?.routing ?? ed.current.routing,
					(routing: Routing) => ed.applyRouting(routing),
				),
			);
			const arrows: ArrowHead[] = ["none", "arrow", "triangle", "dot"];
			const arrowSec = section(this.body, "Arrowheads");
			this.syncers.push(
				segmented(
					arrowSec,
					arrows.map((a) => ({ value: a, label: `Start: ${a}`, draw: drawArrow(a, true) })),
					() => connStyle().startArrow,
					(startArrow: ArrowHead) => ed.applyConnectorStyle({ startArrow }),
				),
			);
			this.syncers.push(
				segmented(
					arrowSec,
					arrows.map((a) => ({ value: a, label: `End: ${a}`, draw: drawArrow(a, false) })),
					() => connStyle().endArrow,
					(endArrow: ArrowHead) => ed.applyConnectorStyle({ endArrow }),
				),
			);
			if (!blocks.length && mode !== "block") this.paletteRow();
			this.syncers.push(
				swatches(section(this.body, "Color"), palette.strokes, () => connStyle().stroke, (stroke) => ed.applyConnectorStyle({ stroke })),
			);
			const fx = section(this.body, "Effect");
			this.syncers.push(
				segmented(
					fx,
					[
						{ value: false, label: "Flat line", text: "Flat" },
						{ value: true, label: "Raised 3D line with shadow", text: "3D" },
					],
					() => connStyle().threeD,
					(threeD: boolean) => ed.applyConnectorStyle({ threeD }),
				),
			);
			this.syncers.push(
				segmented(
					fx,
					[
						{ value: false, label: "Static line", text: "Static" },
						{ value: true, label: "Animated flow along the arrowheads (both ways when there are two)", text: "Flow" },
					],
					() => connStyle().flow,
					(flow: boolean) => ed.applyConnectorStyle({ flow }),
				),
			);
			this.strokeControls(
				() => connStyle().strokeWidth,
				(strokeWidth) => ed.applyConnectorStyle({ strokeWidth }),
				() => connStyle().strokeStyle,
				(strokeStyle) => ed.applyConnectorStyle({ strokeStyle }),
			);
		}

		/* ---- frame style */
		if (mode === "frame" || frames.length) {
			this.syncers.push(
				swatches(section(this.body, "Frame background"), palette.frameFills, () => frameStyle().fill, (fill) => ed.applyFrameStyle({ fill })),
			);
			this.syncers.push(
				swatches(
					section(this.body, "Frame color (also the sheet tab color)"),
					palette.strokes,
					() => frameStyle().stroke,
					(stroke) => ed.applyFrameStyle({ stroke }),
				),
			);
		}

		/* ---- arrange */
		const boxes = sel.filter(isBox);
		if (boxes.length >= 2) {
			const al = section(this.body, "Align");
			const row = el("div", "bd-button-row", al);
			for (const [mode2, icon, label] of [
				["left", "align-left", "Align left"],
				["center", "align-center", "Align centers horizontally"],
				["right", "align-right", "Align right"],
				["top", "align-top", "Align top"],
				["middle", "align-middle", "Align centers vertically"],
				["bottom", "align-bottom", "Align bottom"],
			] as const) {
				iconButton(row, icon, label, () => ed.alignSelection(mode2));
			}
			if (boxes.length >= 3) {
				iconButton(row, "distribute-h", "Distribute horizontally", () => ed.distributeSelection("h"));
				iconButton(row, "distribute-v", "Distribute vertically", () => ed.distributeSelection("v"));
			}
		}

		if (!ed.options.readOnly && (blocks.length || connectors.length || frames.length)) {
			const themeSec = section(this.body, "Quick theme");
			const row = el("div", "bd-button-row", themeSec);
			for (const t of DRAWING_THEMES) {
				const btn = el("button", "bd-seg-btn bd-theme-btn", row, t.name);
				btn.type = "button";
				btn.title = t.description;
				btn.dataset.theme = t.id;
				btn.addEventListener("pointerdown", (e) => e.preventDefault());
				btn.addEventListener("click", () => ed.applyTheme(t.id));
			}
		}

		if (sel.length) {
			const act = section(this.body, "Actions");
			const row = el("div", "bd-button-row", act);
			iconButton(row, "duplicate", "Duplicate — Ctrl/Cmd+D", () => ed.duplicateSelection());
			iconButton(row, "front", "Bring to front", () => ed.reorderSelection("front"));
			iconButton(row, "back_layer", "Send to back", () => ed.reorderSelection("back"));
			if (isFrame(single)) iconButton(row, "fit", "Zoom to frame", () => ed.navigateToFrame(single.id));
			iconButton(row, "trash", "Delete — Del", () => ed.deleteSelection(), "bd-danger");
		}
		if (prevScroll > 0) this.el.scrollTop = prevScroll;
	}

	/** Chooses which swatch set the color rows below show. */
	private paletteRow(): void {
		const ed = this.ed;
		this.syncers.push(
			segmented(
				section(this.body, "Palette"),
				PALETTES.map((p) => ({ value: p.id, label: `${p.name} colors`, text: p.name })),
				() => ed.palette,
				(id: PaletteId) => {
					ed.palette = id;
					this.refresh();
				},
			),
		);
	}

	private strokeControls(
		getWidth: () => number,
		setWidth: (w: number) => void,
		getStyle: () => StrokeStyle,
		setStyle: (s: StrokeStyle) => void,
	): void {
		const sec = section(this.body, "Stroke width & style");
		this.syncers.push(
			segmented(
				sec,
				[1, 2, 4].map((w) => ({
					value: w,
					label: w === 1 ? "Thin" : w === 2 ? "Medium" : "Thick",
					draw: (s: SVGSVGElement) => void line(s, { d: "M4 12 H20", "stroke-width": w * 1.2 }),
				})),
				getWidth,
				setWidth,
			),
		);
		this.syncers.push(
			segmented(
				sec,
				(["solid", "dashed", "dotted"] as StrokeStyle[]).map((st) => ({
					value: st,
					label: st[0].toUpperCase() + st.slice(1),
					draw: (s: SVGSVGElement) =>
						void line(s, {
							d: "M3 12 H21",
							"stroke-width": 2,
							"stroke-dasharray": st === "dashed" ? "5 3" : st === "dotted" ? "0.5 3.5" : "",
						}),
				})),
				getStyle,
				setStyle,
			),
		);
	}

	/** Comment section: a note shown via a small badge on the canvas, collapsed by default. */
	private buildCommentSection(id: string): void {
		const ed = this.ed;
		const sec = section(this.body, "Comment");
		const getter = (): { comment: string; commentOpen: boolean } => {
			const e = ed.byId.get(id);
			return isBlock(e) || isConnector(e) ? e : { comment: "", commentOpen: false };
		};
		this.syncers.push(
			segmented(
				sec,
				[
					{ value: false, label: "Hide the comment on the canvas", text: "Hidden" },
					{ value: true, label: "Show the comment on the canvas", text: "Shown" },
				],
				() => getter().commentOpen,
				(commentOpen: boolean) => ed.updateElement(id, { commentOpen }),
			),
		);
		this.syncers.push(
			textField(sec, {
				multiline: true,
				placeholder: "Add a note — shown via the comment badge",
				get: () => getter().comment,
				...this.textHandlers(id, "comment"),
			}),
		);
	}

	/** Link row: quick frame picker plus "note or URL" via the host's picker. */
	private buildLinkSection(id: string): void {
		const ed = this.ed;
		const sec = section(this.body, "Link (Ctrl/Cmd+click to follow)");
		const row = el("div", "bd-link-row", sec);
		const select = el("select", "bd-select dropdown", row);
		const follow = iconButton(row, "follow-link", "Follow link", () => ed.followLink(id));
		const remove = iconButton(row, "unlink", "Remove link", () => ed.updateElement(id, { link: null }));
		const sync = () => {
			const b = ed.byId.get(id);
			if (!isBlock(b)) return;
			const current = b.link;
			const parsed = parseLink(current);
			const optionsKey = ed.frames().map((f) => `${f.id}:${f.title}`).join("|") + `|${current}`;
			if (select.dataset.key !== optionsKey) {
				select.dataset.key = optionsKey;
				clearEl(select);
				const add = (parent: HTMLElement, value: string, label: string) => {
					const o = el("option", null, parent, label);
					o.value = value;
				};
				const group = (label: string) => {
					const g = el("optgroup", null, select);
					g.label = label;
					return g;
				};
				add(select, "", "No link");
				const frames = ed.frames();
				if (frames.length) {
					const g = group("Go to frame");
					for (const f of frames) add(g, frameLink(f.id), `${f.title || "Frame"}${f.id === b.frameId ? " (this frame)" : ""}`);
				}
				if (parsed && parsed.kind !== "frame") add(group("Current link"), current as string, ed.describeLink(current));
				if (parsed?.kind === "frame" && !ed.byId.has(parsed.frameId)) add(group("Current link"), current as string, "Missing frame");
				add(group("Other"), "__pick__", "Note, other drawing or URL…");
			}
			if (activeElementOf(select) !== select) select.value = current ?? "";
			follow.disabled = !current;
			remove.disabled = !current;
		};
		select.addEventListener("change", () => {
			const value = select.value;
			if (value === "__pick__") {
				void ed.editLink(id).then(() => sync());
				sync();
				return;
			}
			const frameId = parseFrameLink(value);
			if (!value) ed.updateElement(id, { link: null });
			else if (frameId) ed.linkToFrame(id, frameId);
			else ed.updateElement(id, { link: value });
		});
		sync();
		this.syncers.push(sync);
	}
}
