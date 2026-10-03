import { EDITOR_KEYMAP } from "./commands";
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
		if (ed.presenter.isActive()) return !(e.ctrlKey || e.metaKey) && ed.presenter.handleKey(e);

		// Space is a mode, not a command: the pan tool while it is held.
		if (e.key === " ") {
			if (!this.spaceDown) {
				this.spaceDown = true;
				ed.root.classList.add("is-space-pan");
			}
			return true;
		}

		const command = EDITOR_KEYMAP.find(e);
		if (!command || (command.edits && ed.options.readOnly)) return false;
		return command.run(ed, e) !== false;
	}
}
