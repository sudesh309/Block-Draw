import { compileKeymap, formatChord, formatKeys, type CommandDef } from "../kernel/commands";
import { isBlock, isBox, isConnector, isFrame } from "../model/types";
import type { Editor } from "./Editor";

export type EditorCommand = CommandDef<Editor>;

/** Order of the headings in the help panel and the docs. */
export const HELP_GROUPS = ["Draw", "Edit", "Links and frames", "View", "Present"] as const;

/**
 * The COMMANDS table: every keyboard shortcut of the editor. Key dispatch, the help panel, the
 * tooltips and the shortcut table in docs/DESIGN.md all come from these rows.
 *
 * Rows are matched in order and the first match wins: the Shift+digit zoom keys come before the
 * plain digit tool keys, and each Shift variant before its plain key.
 */
export const COMMANDS: readonly EditorCommand[] = [
	{ id: "zoom-fit", group: "View", label: "Zoom to fit", keys: ["Shift+Digit1"], run: (ed) => ed.zoomToFit({ animate: true }) },
	{ id: "zoom-selection", group: "View", label: "Zoom to the selection", keys: ["Shift+Digit2"], run: (ed) => ed.zoomToSelection() },
	{ id: "zoom-reset", group: "View", label: "Zoom to 100%", keys: ["Shift+Digit0"], run: (ed) => ed.zoomTo(1) },
	{ id: "zoom-in", group: "View", label: "Zoom in", keys: ["Plus", "="], run: (ed) => ed.zoomAt(1.2) },
	{ id: "zoom-out", group: "View", label: "Zoom out", keys: ["Minus", "_"], run: (ed) => ed.zoomAt(1 / 1.2) },
	{ id: "toggle-grid", group: "View", label: "Grid on or off", keys: ["G"], run: (ed) => ed.setOptions({ showGrid: !ed.options.showGrid }) },

	{ id: "tool-select", group: "Draw", label: "Select tool", keys: ["V", "1"], run: (ed) => ed.setTool("select") },
	{ id: "tool-pan", group: "Draw", label: "Pan tool (or hold Space and drag)", keys: ["H"], run: (ed) => ed.setTool("pan") },
	{
		id: "tool-block",
		group: "Draw",
		label: "Block tool",
		keys: ["B", "2"],
		run: (ed) => ed.setTool("block", ed.current.shape === "ellipse" || ed.current.shape === "diamond" ? "rounded" : ed.current.shape),
	},
	{ id: "tool-rectangle", group: "Draw", label: "Rectangle block tool", keys: ["R"], run: (ed) => ed.setTool("block", "rectangle") },
	{ id: "tool-ellipse", group: "Draw", label: "Ellipse block tool", keys: ["O", "3"], run: (ed) => ed.setTool("block", "ellipse") },
	{ id: "tool-decision", group: "Draw", label: "Decision block tool", keys: ["D", "4"], run: (ed) => ed.setTool("block", "diamond") },
	{ id: "tool-connector", group: "Draw", label: "Connector tool", keys: ["A", "C", "5"], run: (ed) => ed.setTool("connector") },
	{ id: "tool-frame", group: "Draw", label: "Frame tool", keys: ["F", "6"], run: (ed) => ed.setTool("frame") },
	{ id: "tool-erase", group: "Draw", label: "Eraser: drag over blocks and links to erase them (frames stay)", keys: ["E"], run: (ed) => ed.setTool("erase") },

	{
		id: "edit-text",
		group: "Edit",
		label: "Edit the selected element's text",
		keys: ["Enter"],
		edits: true,
		run(ed) {
			const sel = ed.selectedElements();
			if (sel.length !== 1 || !(isBlock(sel[0]) || isConnector(sel[0]) || isFrame(sel[0]))) return false;
			ed.textEditor.start(sel[0].id);
			return true;
		},
	},
	{ id: "redo", group: "Edit", label: "Redo", keys: ["Mod+Shift+Z", "Mod+Y"], edits: true, run: (ed) => ed.redo() },
	{ id: "undo", group: "Edit", label: "Undo", keys: ["Mod+Z"], edits: true, run: (ed) => ed.undo() },
	{ id: "select-all", group: "Edit", label: "Select everything", keys: ["Mod+A"], run: (ed) => ed.selectAll() },
	{ id: "duplicate", group: "Edit", label: "Duplicate (or Alt+drag)", keys: ["Mod+D"], edits: true, run: (ed) => ed.duplicateSelection() },
	{
		id: "delete",
		group: "Edit",
		label: "Delete the selection (a frame takes its blocks with it)",
		keys: ["Delete", "Backspace"],
		edits: true,
		run: (ed) => ed.deleteSelection(),
	},
	{
		id: "nudge",
		group: "Edit",
		label: "Nudge the selection, or pan (Shift: 5 grid steps)",
		keys: ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"],
		run(ed, press) {
			const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[press.key];
			if (!dir) return false;
			if (!ed.options.readOnly && ed.selectedElements().some(isBox)) {
				const grid = ed.options.gridSize || 10;
				const step = press.shiftKey ? grid * 5 : ed.options.snapToGrid ? grid : 1;
				ed.nudge(dir[0] * step, dir[1] * step);
			} else {
				ed.panBy(-dir[0] * 60, -dir[1] * 60);
			}
			return true;
		},
	},
	{ id: "to-front", group: "Edit", label: "Bring to front", keys: ["Mod+Shift+]", "Mod+}"], edits: true, run: (ed) => ed.reorderSelection("front") },
	{ id: "forward", group: "Edit", label: "Bring forward", keys: ["Mod+]"], edits: true, run: (ed) => ed.reorderSelection("forward") },
	{ id: "to-back", group: "Edit", label: "Send to back", keys: ["Mod+Shift+[", "Mod+{"], edits: true, run: (ed) => ed.reorderSelection("back") },
	{ id: "backward", group: "Edit", label: "Send backward", keys: ["Mod+["], edits: true, run: (ed) => ed.reorderSelection("backward") },

	{
		id: "edit-link",
		group: "Links and frames",
		label: "Link the selected block to a frame or note",
		keys: ["Mod+K"],
		edits: true,
		run(ed) {
			const only = ed.selectedBlocks();
			if (only.length === 1) void ed.editLink(only[0].id);
		},
	},
	{
		id: "follow-link",
		group: "Links and frames",
		label: "Follow the selected block's link (with Shift: in a new tab)",
		keys: ["Mod+Enter"],
		run(ed, press) {
			const only = ed.selectedBlocks();
			if (only.length === 1 && only[0].link) ed.followLink(only[0].id, press.shiftKey);
		},
	},
	{ id: "back", group: "Links and frames", label: "Back to where you were before following a link", keys: ["Alt+ArrowLeft"], run: (ed) => ed.navigateBack() },
	{ id: "next-frame", group: "Links and frames", label: "Next frame", keys: ["]", "PageDown"], run: (ed) => ed.stepFrame(1) },
	{ id: "previous-frame", group: "Links and frames", label: "Previous frame", keys: ["[", "PageUp"], run: (ed) => ed.stepFrame(-1) },

	{ id: "present", group: "Present", label: "Present: an overview, then one slide per frame", keys: ["P"], run: (ed) => ed.presenter.start() },
	{
		id: "trace",
		group: "Present",
		label: "Trace the selected block's upstream and downstream dependencies",
		keys: ["T"],
		run(ed) {
			const only = ed.selectedBlocks();
			if (only.length === 1) ed.toggleTrace(only[0].id);
			else ed.clearTrace();
		},
	},
	{ id: "help", group: "Present", label: "Show or hide these shortcuts", keys: ["?"], run: (ed) => ed.help.toggle() },
	{
		id: "cancel",
		group: "Present",
		label: "Cancel what you are doing, close this list, clear a trace, or deselect",
		keys: ["Escape"],
		run(ed) {
			if (ed.pointer.cancel()) return true;
			if (ed.help.isOpen()) ed.help.toggle(false);
			else if (ed.traceRootId) ed.clearTrace();
			else if (ed.tool !== "select") ed.setTool("select");
			else if (ed.selection.size) ed.clearSelection();
			else return false;
			return true;
		},
	},
];

/**
 * Things to know that are not keyboard commands: mouse and touch gestures, and keys the browser or
 * the text editor handle. Listed with the commands in the help panel and the docs.
 */
export const GESTURES: readonly { group: (typeof HELP_GROUPS)[number]; keys: string; label: string }[] = [
	{ group: "Draw", keys: "Double-click", label: "Add a block, or edit the text under the pointer" },
	{ group: "Draw", keys: "Drag an edge dot", label: "Connect blocks; drop on empty space to create a connected block" },
	{ group: "Draw", keys: "Click an edge dot", label: "Add a connected block in that direction" },
	{ group: "Edit", keys: "Ctrl/Cmd+C, X, V", label: "Copy, cut and paste" },
	{ group: "Edit", keys: "Drag a selected line", label: "Bend it: grab a dot on the line and drop it where the line should pass" },
	{ group: "Edit", keys: "Double-click a bend", label: "Remove that bend" },
	{ group: "Edit", keys: "Pen button or eraser end", label: "In tablet mode: hold it and draw over blocks and links to erase them" },
	{ group: "Edit", keys: "Shift+Enter", label: "New line while editing text" },
	{ group: "Links and frames", keys: "Ctrl/Cmd+click", label: "Follow a block's link" },
	{ group: "Present", keys: "In a presentation", label: "← → slides · click a block to spotlight it · ? legend · S stage · L laser · Esc ends" },
];

export const EDITOR_KEYMAP = compileKeymap(COMMANDS);

/** The first key of a command, for tooltips: shortcut("undo") → "Ctrl/Cmd+Z". */
export function shortcut(id: string): string {
	const command = COMMANDS.find((c) => c.id === id);
	if (!command) throw new Error(`No command "${id}"`);
	return formatChord(command.keys[0]);
}

/** Help panel and docs rows, grouped under HELP_GROUPS. */
export function helpRows(): { group: string; rows: { keys: string; label: string }[] }[] {
	return HELP_GROUPS.map((group) => ({
		group,
		rows: [
			...COMMANDS.filter((c) => c.group === group).map((c) => ({ keys: formatKeys(c), label: c.label })),
			...GESTURES.filter((g) => g.group === group).map(({ keys, label }) => ({ keys, label })),
		],
	}));
}
