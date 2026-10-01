import { Keymap, MarkdownRenderChild, TFile, type MarkdownPostProcessorContext } from "obsidian";
import { parseDrawing } from "../model/file";
import { parseLink } from "../model/links";
import { isFrame } from "../model/types";
import { SCREEN_THEME } from "../render/colors";
import { sceneToSvg } from "../render/scene";
import { toDom } from "../render/vnode";
import type BlockDrawPlugin from "../main";

/**
 * ```blockdraw
 * file: Diagrams/Checkout.blockdraw
 * frame: Payment details
 * height: 400
 * ```
 * renders a live preview of a drawing (or one frame) inside a note.
 */
export function parseEmbedOptions(source: string): { file: string; frame: string | null; height: number | null } {
	const opts: Record<string, string> = {};
	const lines = source.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
	for (const line of lines) {
		const m = /^(\w+)\s*:\s*(.*)$/.exec(line);
		if (m) opts[m[1].toLowerCase()] = m[2].trim();
		else if (!opts.file) opts.file = line;
	}
	let file = opts.file ?? "";
	let frame = opts.frame ?? null;
	const parsed = parseLink(file);
	if (parsed?.kind === "note") {
		file = parsed.path;
		if (!frame && parsed.subpath) frame = parsed.subpath.replace(/^#\^?/, "");
	}
	const height = opts.height ? Number.parseInt(opts.height, 10) : NaN;
	return { file, frame: frame || null, height: Number.isFinite(height) && height > 40 ? height : null };
}

class DrawingEmbed extends MarkdownRenderChild {
	private file: TFile | null = null;

	constructor(
		private readonly plugin: BlockDrawPlugin,
		containerEl: HTMLElement,
		private readonly source: string,
		private readonly sourcePath: string,
	) {
		super(containerEl);
	}

	onload(): void {
		void this.render();
		this.registerEvent(
			this.plugin.app.vault.on("modify", (f) => {
				if (this.file && f.path === this.file.path) void this.render();
			}),
		);
	}

	private async render(): Promise<void> {
		const el = this.containerEl;
		const app = this.plugin.app;
		const opts = parseEmbedOptions(this.source);
		el.empty();
		if (!opts.file) {
			el.createDiv({ cls: "bd-embed-error", text: "Block Draw: add a line like “file: My drawing.blockdraw”." });
			return;
		}
		const target = app.metadataCache.getFirstLinkpathDest(opts.file, this.sourcePath) ?? app.vault.getAbstractFileByPath(opts.file);
		if (!(target instanceof TFile)) {
			el.createDiv({ cls: "bd-embed-error", text: `Block Draw: “${opts.file}” was not found.` });
			return;
		}
		this.file = target;
		let drawing;
		try {
			drawing = parseDrawing(await app.vault.cachedRead(target));
		} catch (e) {
			el.createDiv({ cls: "bd-embed-error", text: `Block Draw: ${(e as Error).message}` });
			return;
		}
		let frameId: string | null = null;
		if (opts.frame) {
			const needle = opts.frame.toLowerCase();
			const frame = drawing.elements.find((e) => isFrame(e) && (e.id === opts.frame || e.title.toLowerCase() === needle));
			if (!frame) {
				el.createDiv({ cls: "bd-embed-error", text: `Block Draw: no frame named “${opts.frame}” in ${target.basename}.` });
				return;
			}
			frameId = frame.id;
		}
		const wrap = el.createDiv({ cls: "bd-embed" });
		const { node } = sceneToSvg(drawing.elements, { theme: SCREEN_THEME, frameId, background: false, padding: 16 });
		const svg = toDom(node) as SVGSVGElement;
		svg.removeAttribute("width");
		svg.removeAttribute("height");
		if (opts.height) svg.style.maxHeight = `${opts.height}px`;
		wrap.appendChild(svg);
		wrap.createSpan({ cls: "bd-embed-caption", text: frameId ? `${target.basename} › ${opts.frame}` : target.basename });
		wrap.setAttr("aria-label", `Open ${target.basename}`);
		this.registerDomEvent(wrap, "click", (evt) => {
			const sub = opts.frame ? `#${opts.frame}` : "";
			void app.workspace.openLinkText(target.path + sub, this.sourcePath, Keymap.isModEvent(evt));
		});
	}
}

export function registerEmbeds(plugin: BlockDrawPlugin): void {
	plugin.registerMarkdownCodeBlockProcessor("blockdraw", (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
		ctx.addChild(new DrawingEmbed(plugin, el, source, ctx.sourcePath));
	});
}
