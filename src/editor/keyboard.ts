import { isBlock, isBox, isConnector, isFrame } from "../model/types";
import { isTextInput } from "./dom";
import type { Editor } from "./Editor";

export class KeyboardController {
	spaceDown = false;

	constructor(private readonly ed: Editor) {
		ed.listen(ed.root, "keydown", (e) => this.onKeyDown(e as KeyboardEvent));
		ed.listen(ed.root, "keyup", (e) => this.onKeyUp(e as KeyboardEvent));
		ed.listen(ed.win, "blur", () => this.releaseSpace());
	}

	private releaseSpace(): void {
		this.spaceDown = false;
		this.ed.root.classList.remove("is-space-pan");
	}

	private onKeyUp(e: KeyboardEvent): void {
		if (e.key === " ") this.releaseSpace();
	}

	private onKeyDown(e: KeyboardEvent): void {
		if (isTextInput(e.target)) return;
		const ed = this.ed;
		if (this.handle(e)) {
			e.preventDefault();
			e.stopPropagation();
		}
		ed.requestRender();
	}

	/** Returns true when the key was handled. */
	private handle(e: KeyboardEvent): boolean {
		const ed = this.ed;
		const mod = e.ctrlKey || e.metaKey;
		const key = e.key;
		const lower = key.length === 1 ? key.toLowerCase() : key;
		const ro = ed.options.readOnly;

		if (ed.presenter.isActive()) return !mod && ed.presenter.handleKey(e);

		if (key === " ") {
			if (!this.spaceDown) {
				this.spaceDown = true;
				ed.root.classList.add("is-space-pan");
			}
			return true;
		}

		if (key === "Escape") {
			if (ed.pointer.cancel()) return true;
			if (ed.help.isOpen()) {
				ed.help.toggle(false);
				return true;
			}
			if (ed.traceRootId) {
				ed.clearTrace();
				return true;
			}
			if (ed.tool !== "select") {
				ed.setTool("select");
				return true;
			}
			if (ed.selection.size) {
				ed.clearSelection();
				return true;
			}
			return false;
		}

		if (e.altKey && key === "ArrowLeft") {
			ed.navigateBack();
			return true;
		}

		// Shift+digit zoom shortcuts (layout independent via e.code).
		if (e.shiftKey && !mod && !e.altKey) {
			if (e.code === "Digit1") {
				ed.zoomToFit({ animate: true });
				return true;
			}
			if (e.code === "Digit2") {
				ed.zoomToSelection();
				return true;
			}
			if (e.code === "Digit0") {
				ed.zoomTo(1);
				return true;
			}
		}

		if (mod) {
			switch (lower) {
				case "z":
					if (ro) return false;
					if (e.shiftKey) ed.redo();
					else ed.undo();
					return true;
				case "y":
					if (ro) return false;
					ed.redo();
					return true;
				case "a":
					ed.selectAll();
					return true;
				case "d":
					if (ro) return false;
					ed.duplicateSelection();
					return true;
				case "k": {
					if (ro) return false;
					const only = ed.selectedBlocks();
					if (only.length === 1) void ed.editLink(only[0].id);
					return true;
				}
				case "]":
				case "}":
					if (ro) return false;
					ed.reorderSelection(e.shiftKey || key === "}" ? "front" : "forward");
					return true;
				case "[":
				case "{":
					if (ro) return false;
					ed.reorderSelection(e.shiftKey || key === "{" ? "back" : "backward");
					return true;
				case "enter": {
					const only = ed.selectedBlocks();
					if (only.length === 1 && only[0].link) ed.followLink(only[0].id, e.shiftKey);
					return true;
				}
			}
			return false;
		}

		if (e.altKey) return false;

		if (!ro && (key === "Delete" || key === "Backspace")) {
			ed.deleteSelection();
			return true;
		}

		if (key === "Enter") {
			const sel = ed.selectedElements();
			if (sel.length === 1 && !ro) {
				if (isBlock(sel[0]) || isConnector(sel[0]) || isFrame(sel[0])) {
					ed.textEditor.start(sel[0].id);
					return true;
				}
			}
			return false;
		}

		if (key.startsWith("Arrow")) {
			const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
			if (!dir) return false;
			const hasBoxes = ed.selectedElements().some(isBox);
			if (hasBoxes && !ro) {
				const grid = ed.options.gridSize || 10;
				const step = e.shiftKey ? grid * 5 : ed.options.snapToGrid ? grid : 1;
				ed.nudge(dir[0] * step, dir[1] * step);
			} else {
				ed.panBy(-dir[0] * 60, -dir[1] * 60);
			}
			return true;
		}

		if (key === "PageDown") {
			ed.stepFrame(1);
			return true;
		}
		if (key === "PageUp") {
			ed.stepFrame(-1);
			return true;
		}

		switch (lower) {
			case "v":
			case "1":
				ed.setTool("select");
				return true;
			case "h":
				ed.setTool("pan");
				return true;
			case "b":
			case "r":
			case "2":
				ed.setTool("block", lower === "r" ? "rectangle" : ed.current.shape === "ellipse" || ed.current.shape === "diamond" ? "rounded" : ed.current.shape);
				return true;
			case "o":
			case "3":
				ed.setTool("block", "ellipse");
				return true;
			case "d":
			case "4":
				ed.setTool("block", "diamond");
				return true;
			case "a":
			case "c":
			case "5":
				ed.setTool("connector");
				return true;
			case "f":
			case "6":
				ed.setTool("frame");
				return true;
			case "]":
				ed.stepFrame(1);
				return true;
			case "[":
				ed.stepFrame(-1);
				return true;
			case "+":
			case "=":
				ed.zoomAt(1.2);
				return true;
			case "-":
			case "_":
				ed.zoomAt(1 / 1.2);
				return true;
			case "g":
				ed.setOptions({ showGrid: !ed.options.showGrid });
				return true;
			case "p":
				ed.presenter.start();
				return true;
			case "t": {
				const only = ed.selectedBlocks();
				if (only.length === 1) ed.toggleTrace(only[0].id);
				else ed.clearTrace();
				return true;
			}
			case "?":
				ed.help.toggle();
				return true;
		}
		return false;
	}
}
