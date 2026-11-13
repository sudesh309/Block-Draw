import { MAX_CELL_CHARS, MAX_TABLE_COLUMNS, MAX_TABLE_ROWS } from "../../model/media";
import { isBlock } from "../../model/types";
import { columnWidths, tableSize } from "../../render/media";
import { clearEl, el } from "../dom";
import type { Editor } from "../Editor";
import { iconButton } from "./controls";

/**
 * Editing a table block in place: a grid of text fields over the block, with buttons to add and
 * remove rows and columns. Everything changed while it is open is one undo step.
 */
export class TableEditor {
	private readonly box: HTMLDivElement;
	private readonly grid: HTMLDivElement;
	private targetId: string | null = null;
	private rows: string[][] = [];
	/** The cell that has, or last had, the cursor. */
	private at = { r: 0, c: 0 };

	constructor(private readonly ed: Editor) {
		this.box = el("div", "bd-table-editor", ed.root);
		const bar = el("div", "bd-table-editor-bar bd-panel", this.box);
		iconButton(bar, "row-add", "Add a row below", () => this.change("row", 1));
		iconButton(bar, "col-add", "Add a column to the right", () => this.change("column", 1));
		iconButton(bar, "row-remove", "Remove this row", () => this.change("row", -1));
		iconButton(bar, "col-remove", "Remove this column", () => this.change("column", -1));
		iconButton(bar, "close", "Done — Esc", () => this.finish());
		this.grid = el("div", "bd-table-editor-grid", this.box);
		ed.listen(this.box, "pointerdown", (e) => e.stopPropagation());
		ed.listen(this.box, "keydown", (e) => this.onKeyDown(e as KeyboardEvent));
		ed.listen(this.box, "focusout", () => {
			// Leaving the grid (a click on the canvas, Tab out of the last cell) saves.
			ed.win.setTimeout(() => {
				if (this.targetId && !this.box.contains(ed.doc.activeElement)) this.commit();
			}, 0);
		});
	}

	isActive(): boolean {
		return this.targetId !== null;
	}

	start(id: string): void {
		const ed = this.ed;
		const block = ed.byId.get(id);
		if (!isBlock(block) || !block.table) return;
		this.targetId = id;
		this.rows = block.table.map((row) => [...row]);
		this.at = { r: 0, c: 0 };
		ed.editingId = id;
		ed.selection = new Set([id]);
		this.box.classList.add("is-active");
		this.build();
		ed.requestRender();
	}

	/** Adds a row or column after the cursor's (`by` 1), or removes the cursor's (`by` -1). */
	private change(what: "row" | "column", by: 1 | -1): void {
		this.read();
		const { r, c } = this.at;
		const rows = this.rows;
		if (what === "row") {
			if (by === 1 && rows.length < MAX_TABLE_ROWS) rows.splice(r + 1, 0, rows[0].map(() => ""));
			else if (by === -1 && rows.length > 1) rows.splice(r, 1);
			else return;
			this.at = { r: Math.min(by === 1 ? r + 1 : r, rows.length - 1), c };
		} else {
			if (by === 1 && rows[0].length < MAX_TABLE_COLUMNS) rows.forEach((row) => row.splice(c + 1, 0, ""));
			else if (by === -1 && rows[0].length > 1) rows.forEach((row) => row.splice(c, 1));
			else return;
			this.at = { r, c: Math.min(by === 1 ? c + 1 : c, rows[0].length - 1) };
		}
		this.build();
	}

	private read(): void {
		this.grid.querySelectorAll("input").forEach((input) => {
			const r = Number(input.dataset.r);
			const c = Number(input.dataset.c);
			if (this.rows[r]) this.rows[r][c] = input.value.slice(0, MAX_CELL_CHARS);
		});
	}

	private build(): void {
		clearEl(this.grid);
		this.rows.forEach((row, r) =>
			row.forEach((text, c) => {
				const input = el("input", r === 0 ? "bd-table-cell is-header" : "bd-table-cell", this.grid);
				input.type = "text";
				input.value = text;
				input.dataset.r = String(r);
				input.dataset.c = String(c);
				input.setAttribute("aria-label", `Row ${r + 1}, column ${c + 1}`);
				input.addEventListener("focus", () => (this.at = { r, c }));
			}),
		);
		this.reposition();
		this.focus(this.at.r, this.at.c);
	}

	private focus(r: number, c: number): void {
		const input = this.grid.querySelector<HTMLInputElement>(`input[data-r="${r}"][data-c="${c}"]`);
		input?.focus({ preventScroll: true });
		input?.select();
	}

	private onKeyDown(e: KeyboardEvent): void {
		e.stopPropagation();
		if (e.key === "Escape") {
			e.preventDefault();
			this.finish();
		} else if (e.key === "Enter" && !e.isComposing) {
			e.preventDefault();
			const r = this.at.r + (e.shiftKey ? -1 : 1);
			if (r >= 0 && r < this.rows.length) this.focus(r, this.at.c);
			else this.finish();
		}
	}

	private finish(): void {
		this.commit();
		this.ed.root.focus({ preventScroll: true });
	}

	/** Places the grid over the block (also called on pan and zoom). */
	reposition(): void {
		const ed = this.ed;
		const block = this.targetId ? ed.byId.get(this.targetId) : null;
		if (!isBlock(block)) return;
		const z = ed.vp.zoom;
		const size = this.size(block.table ?? this.rows, block);
		const tl = ed.worldToScreen(block);
		const s = this.box.style;
		s.left = `${tl.x}px`;
		s.top = `${tl.y}px`;
		s.width = `${size.width * z}px`;
		this.grid.style.height = `${size.height * z}px`;
		this.grid.style.gridTemplateColumns = columnWidths(this.rows, block.style.fontSize).map((w) => `${w}fr`).join(" ");
		this.grid.style.fontSize = `${block.style.fontSize * z}px`;
	}

	/** The block's size for the rows being edited: it keeps its scale, and grows or shrinks with rows and columns. */
	private size(was: string[][], block: { width: number; height: number; style: { fontSize: number } }): { width: number; height: number } {
		const before = tableSize(was, block.style.fontSize);
		const now = tableSize(this.rows, block.style.fontSize);
		return { width: Math.round((block.width * now.width) / before.width), height: Math.round((block.height * now.height) / before.height) };
	}

	/** Saves the table (one undo step) and closes the editor. */
	commit(): void {
		const ed = this.ed;
		const id = this.targetId;
		if (!id) return;
		this.read();
		const block = ed.byId.get(id);
		const rows = this.rows;
		this.close();
		if (!isBlock(block) || !block.table) return;
		if (JSON.stringify(rows) !== JSON.stringify(block.table)) {
			this.rows = rows;
			ed.updateElement(id, { table: rows, ...this.size(block.table, block) }, { selection: [id] });
		}
	}

	/** Closes without saving. */
	cancel(): void {
		if (this.targetId) this.close();
	}

	private close(): void {
		this.targetId = null;
		this.ed.editingId = null;
		this.box.classList.remove("is-active");
		clearEl(this.grid);
		this.ed.requestRender();
	}
}
