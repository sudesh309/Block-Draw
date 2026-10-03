import { Modal, Setting, type App } from "obsidian";

export interface ConfirmOptions {
	title: string;
	message: string;
	/** Shown in code type under the message, such as the address being opened. */
	detail?: string;
	confirm: string;
}

/** Asks a yes/no question; resolves to true only when the person chose the confirm button. */
export function confirmAction(app: App, opts: ConfirmOptions): Promise<boolean> {
	return new Promise((resolve) => new ConfirmModal(app, opts, resolve).open());
}

class ConfirmModal extends Modal {
	private answer = false;

	constructor(
		app: App,
		private readonly opts: ConfirmOptions,
		private readonly done: (yes: boolean) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.opts.title);
		this.contentEl.createEl("p", { text: this.opts.message });
		if (this.opts.detail) this.contentEl.createEl("p").createEl("code", { text: this.opts.detail, cls: "bd-confirm-detail" });
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(this.opts.confirm)
					.setCta()
					.onClick(() => {
						this.answer = true;
						this.close();
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
		this.done(this.answer);
	}
}
