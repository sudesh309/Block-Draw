import type { BlockShape } from "../../model/types";
import { shortcut } from "../commands";
import { el } from "../dom";
import type { Editor } from "../Editor";
import type { Tool } from "../types";
import { iconButton } from "./controls";

interface ToolSpec {
	tool: Tool;
	shape?: BlockShape;
	icon: string;
	label: string;
}

const TOOLS: ToolSpec[] = [
	{ tool: "select", icon: "select", label: `Select — ${shortcut("tool-select")}` },
	{ tool: "pan", icon: "pan", label: `Pan — ${shortcut("tool-pan")} or hold Space` },
	{ tool: "block", shape: "rounded", icon: "block", label: `Block — ${shortcut("tool-block")}` },
	{ tool: "block", shape: "ellipse", icon: "ellipse", label: `Ellipse block — ${shortcut("tool-ellipse")}` },
	{ tool: "block", shape: "diamond", icon: "diamond", label: `Decision block — ${shortcut("tool-decision")}` },
	{ tool: "connector", icon: "connector", label: `Connector — ${shortcut("tool-connector")}` },
	{ tool: "frame", icon: "frame", label: `Frame — ${shortcut("tool-frame")}` },
];

export class Toolbar {
	readonly el: HTMLDivElement;
	private toolButtons: [ToolSpec, HTMLButtonElement][] = [];
	private undoBtn: HTMLButtonElement;
	private redoBtn: HTMLButtonElement;
	private framesBtn: HTMLButtonElement;

	constructor(private readonly ed: Editor) {
		this.el = el("div", "bd-toolbar bd-panel", ed.root);
		const tools = el("div", "bd-toolbar-group", this.el);
		for (const spec of TOOLS) {
			if (ed.options.readOnly && spec.tool !== "select" && spec.tool !== "pan") continue;
			const btn = iconButton(tools, spec.icon, spec.label, () => ed.setTool(spec.tool, spec.shape), "bd-tool");
			btn.dataset.tool = spec.tool + (spec.shape ? `:${spec.shape}` : "");
			this.toolButtons.push([spec, btn]);
		}
		el("div", "bd-toolbar-sep", this.el);
		const actions = el("div", "bd-toolbar-group", this.el);
		this.undoBtn = iconButton(actions, "undo", `Undo — ${shortcut("undo")}`, () => ed.undo());
		this.redoBtn = iconButton(actions, "redo", `Redo — ${shortcut("redo")}`, () => ed.redo());
		el("div", "bd-toolbar-sep", this.el);
		const view = el("div", "bd-toolbar-group", this.el);
		this.framesBtn = iconButton(view, "frames", "Frames", () => ed.framesPanel.toggle());
		iconButton(view, "present", `Present — ${shortcut("present")}`, () => ed.presenter.start(), "bd-present-btn");
		if (ed.host.exportMenu) {
			iconButton(view, "export", "Export", (e) => {
				const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
				ed.host.showMenu(ed.host.exportMenu?.() ?? [], { x: r.left, y: r.bottom + 4 });
			}, "bd-export-btn");
		}
		iconButton(view, "help", `Keyboard shortcuts — ${shortcut("help")}`, () => ed.help.toggle());
		if (ed.options.readOnly) {
			this.undoBtn.hidden = true;
			this.redoBtn.hidden = true;
		}
	}

	update(): void {
		const ed = this.ed;
		for (const [spec, btn] of this.toolButtons) {
			let active = ed.tool === spec.tool;
			if (active && spec.tool === "block") {
				const shape = ed.toolShape;
				active = spec.shape === "rounded" ? shape !== "ellipse" && shape !== "diamond" : shape === spec.shape;
			}
			btn.classList.toggle("is-active", active);
		}
		this.undoBtn.disabled = !ed.history.canUndo;
		this.redoBtn.disabled = !ed.history.canRedo;
		this.framesBtn.classList.toggle("is-active", ed.framesPanel.isOpen());
	}
}
