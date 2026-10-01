import { App, prepareFuzzySearch, SuggestModal, type SearchResult } from "obsidian";
import { frameLink } from "../model/links";
import { parseDrawing } from "../model/file";
import { FILE_EXTENSION, isFrame, type FrameElement } from "../model/types";

interface LinkOption {
	kind: "frame" | "file" | "other-frame" | "url" | "text" | "remove";
	label: string;
	detail: string;
	link: string | null;
	match?: SearchResult | null;
}

/**
 * Picks a link target for a block: a frame in this drawing, a note or file in the vault,
 * a frame in another drawing, or a URL. Resolves with the new link, `null` to remove the
 * link, or `undefined` when dismissed.
 */
export class LinkPickerModal extends SuggestModal<LinkOption> {
	private resolve: ((value: string | null | undefined) => void) | null = null;
	private chosen = false;
	private otherFrames: LinkOption[] = [];

	constructor(
		app: App,
		private readonly opts: { current: string | null; frames: FrameElement[]; ownFrameId: string | null; sourcePath: string },
	) {
		super(app);
		this.setPlaceholder("Link to a frame, note or URL…");
		this.setInstructions([
			{ command: "↑↓", purpose: "to navigate" },
			{ command: "↵", purpose: "to link" },
			{ command: "esc", purpose: "to cancel" },
		]);
		this.limit = 60;
	}

	openAndWait(): Promise<string | null | undefined> {
		return new Promise((resolve) => {
			this.resolve = resolve;
			this.open();
			void this.loadOtherDrawings();
		});
	}

	/** Frames of other drawings are read in the background and appear when ready. */
	private async loadOtherDrawings(): Promise<void> {
		const files = this.app.vault.getFiles().filter((f) => f.extension === FILE_EXTENSION && f.path !== this.opts.sourcePath);
		const out: LinkOption[] = [];
		for (const file of files.slice(0, 200)) {
			try {
				const drawing = parseDrawing(await this.app.vault.cachedRead(file));
				for (const f of drawing.elements.filter(isFrame)) {
					const linktext = this.app.metadataCache.fileToLinktext(file, this.opts.sourcePath, false);
					out.push({
						kind: "other-frame",
						label: `${file.basename} › ${f.title || "Frame"}`,
						detail: "Frame in another drawing",
						link: `[[${linktext}#${f.title || f.id}]]`,
					});
				}
			} catch {
				// unreadable drawings are skipped
			}
		}
		this.otherFrames = out;
		if (out.length) this.inputEl.dispatchEvent(new Event("input"));
	}

	getSuggestions(query: string): LinkOption[] {
		const q = query.trim();
		const options: LinkOption[] = [];
		if (this.opts.current) options.push({ kind: "remove", label: "Remove link", detail: "", link: null });
		for (const f of this.opts.frames) {
			options.push({
				kind: "frame",
				label: f.title || "Frame",
				detail: f.id === this.opts.ownFrameId ? "Frame in this drawing (contains this block)" : "Frame in this drawing",
				link: frameLink(f.id),
			});
		}
		options.push(...this.otherFrames);
		for (const file of this.app.vault.getFiles()) {
			if (file.path === this.opts.sourcePath) continue;
			const linktext = this.app.metadataCache.fileToLinktext(file, this.opts.sourcePath, true);
			options.push({
				kind: "file",
				label: file.extension === "md" ? file.basename : file.name,
				detail: file.parent && file.parent.path !== "/" ? file.parent.path : "",
				link: `[[${linktext}]]`,
			});
		}

		let result: LinkOption[];
		if (!q) {
			result = options;
		} else {
			const search = prepareFuzzySearch(q);
			result = options
				.filter((o) => o.kind !== "remove")
				.map((o) => ({ ...o, match: search(`${o.label} ${o.detail}`) }))
				.filter((o) => o.match)
				.sort((a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0));
			if (/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(q) || /^mailto:\S+$/i.test(q)) {
				result.unshift({ kind: "url", label: q, detail: "Open this URL", link: q });
			} else if (!result.some((o) => o.label.toLowerCase() === q.toLowerCase())) {
				result.push({ kind: "text", label: q, detail: "Link to a note with this name", link: `[[${q.replace(/^\[\[|\]\]$/g, "")}]]` });
			}
		}
		return result;
	}

	renderSuggestion(option: LinkOption, el: HTMLElement): void {
		el.addClass("mod-complex");
		const content = el.createDiv({ cls: "suggestion-content" });
		content.createDiv({ cls: "suggestion-title", text: option.label });
		if (option.detail) content.createDiv({ cls: "suggestion-note", text: option.detail });
		const aux = el.createDiv({ cls: "suggestion-aux" });
		const tag =
			option.kind === "frame" || option.kind === "other-frame"
				? "Frame"
				: option.kind === "url"
					? "URL"
					: option.kind === "remove"
						? ""
						: option.kind === "file"
							? "Note"
							: "New";
		if (tag) aux.createSpan({ cls: "suggestion-flair", text: tag });
	}

	onChooseSuggestion(option: LinkOption): void {
		this.chosen = true;
		this.resolve?.(option.link);
		this.resolve = null;
	}

	onClose(): void {
		super.onClose();
		// onChooseSuggestion runs after onClose; give it a tick before treating this as a cancel
		window.setTimeout(() => {
			if (!this.chosen) this.resolve?.(undefined);
			this.resolve = null;
		}, 0);
	}
}

