import type { App } from "obsidian";
import { WEB_FONTS_URL } from "../render/fonts";
import { parseWebFontFaces, type WebFontFace } from "../render/webFontFaces";
import { request } from "./net";

/** Documents of the main window and of every pop-out window. */
export function openDocuments(app: App): Document[] {
	const docs = new Set<Document>([app.workspace.containerEl.ownerDocument]);
	app.workspace.iterateAllLeaves((leaf) => docs.add(leaf.view.containerEl.ownerDocument));
	return [...docs];
}

/** Google's stylesheet for the web fonts. Overridable so tests need no network. */
async function fetchStylesheet(): Promise<string> {
	const res = await request({ url: WEB_FONTS_URL, throw: false });
	if (res.status !== 200) throw new Error(`Google Fonts answered HTTP ${res.status}`);
	return res.text;
}

/**
 * Loads Inter, Roboto, Open Sans, Montserrat and Lato from Google Fonts, but only while "Load web fonts"
 * is on in the settings. Nothing is requested before that, and turning the setting off takes the fonts
 * out of every window again.
 *
 * The fonts are added through the FontFace API (Obsidian's review rules do not allow plugins to attach
 * stylesheet elements). Like `@font-face` rules they are only downloaded when text actually uses them.
 */
export class WebFontLoader {
	/** Replaced by tests. */
	fetchStylesheet: () => Promise<string> = fetchStylesheet;
	private enabled = false;
	private rules: Promise<WebFontFace[]> | null = null;
	private readonly added = new Map<Document, { faces: FontFace[]; stop: () => void }>();
	private timer: number | null = null;

	constructor(
		private readonly app: App,
		/** Called after some of the fonts finished downloading, so text can be measured and wrapped again. */
		private readonly onLoaded: () => void,
	) {}

	/** Fonts currently added to a document (for tests and diagnostics). */
	count(doc: Document): number {
		return this.added.get(doc)?.faces.length ?? 0;
	}

	/** Turns the fonts on or off in every open window. Rejects when the stylesheet cannot be downloaded. */
	async setEnabled(on: boolean): Promise<void> {
		this.enabled = on;
		if (!on) {
			this.removeAll();
			return;
		}
		const rules = await this.load();
		if (!this.enabled) return;
		for (const doc of openDocuments(this.app)) this.addTo(doc, rules);
	}

	/** A pop-out window was opened: give it the fonts too. */
	async windowOpened(doc: Document): Promise<void> {
		if (!this.enabled) return;
		let rules: WebFontFace[];
		try {
			rules = await this.load();
		} catch {
			return; // the setting's own toggle reports download problems
		}
		if (this.enabled) this.addTo(doc, rules);
	}

	dispose(): void {
		this.enabled = false;
		this.removeAll();
	}

	private load(): Promise<WebFontFace[]> {
		// Remember only successes: turning the setting off and on again tries again.
		this.rules ??= this.download().catch((e: unknown) => {
			this.rules = null;
			throw e;
		});
		return this.rules;
	}

	private async download(): Promise<WebFontFace[]> {
		const faces = parseWebFontFaces(await this.fetchStylesheet());
		if (!faces.length) throw new Error("Google Fonts sent no fonts Block Draw knows how to use.");
		return faces;
	}

	private addTo(doc: Document, rules: WebFontFace[]): void {
		const win = doc.defaultView;
		if (!win || this.added.has(doc)) return;
		const faces: FontFace[] = [];
		for (const r of rules) {
			try {
				const face = new win.FontFace(r.family, r.source, r.descriptors);
				doc.fonts.add(face);
				faces.push(face);
			} catch {
				// a rule this browser rejects is skipped; the font falls back to the next one in its stack
			}
		}
		const ours = new Set(faces);
		const onDone = (e: Event) => {
			if ((e as FontFaceSetLoadEvent).fontfaces.some((f) => ours.has(f))) this.loaded();
		};
		doc.fonts.addEventListener("loadingdone", onDone);
		this.added.set(doc, { faces, stop: () => doc.fonts.removeEventListener("loadingdone", onDone) });
	}

	private removeAll(): void {
		for (const [doc, { faces, stop }] of this.added) {
			stop();
			for (const face of faces) doc.fonts.delete(face);
		}
		this.added.clear();
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = null;
	}

	/** Several font files arrive one after another: measure again once they have settled. */
	private loaded(): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			this.timer = null;
			this.onLoaded();
		}, 120);
	}
}
