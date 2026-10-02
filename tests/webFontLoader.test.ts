import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { App } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebFontLoader } from "../src/obsidian/webFonts";

const css = readFileSync(join(__dirname, "fixtures", "google-fonts.css"), "utf8");
const FACES = 7; // rules in the fixture

class FakeFontFace {
	constructor(
		readonly family: string,
		readonly source: string,
		readonly descriptors: object,
	) {}
}

/** The few bits of a Document the loader uses. */
class FakeDocument {
	readonly faces = new Set<FakeFontFace>();
	readonly listeners = new Set<(e: Event) => void>();
	readonly fonts = {
		add: (f: FakeFontFace) => this.faces.add(f),
		delete: (f: FakeFontFace) => this.faces.delete(f),
		addEventListener: (_: string, l: (e: Event) => void) => this.listeners.add(l),
		removeEventListener: (_: string, l: (e: Event) => void) => this.listeners.delete(l),
	};
	readonly defaultView = { FontFace: FakeFontFace };
	/** Pretends the browser finished downloading some fonts. */
	finishLoading(faces: FakeFontFace[]) {
		for (const l of this.listeners) l({ fontfaces: faces } as unknown as Event);
	}
}

function setup() {
	const main = new FakeDocument();
	const popout = new FakeDocument();
	const windows = [popout];
	const app = {
		workspace: {
			containerEl: { ownerDocument: main },
			iterateAllLeaves: (cb: (leaf: unknown) => void) => windows.forEach((d) => cb({ view: { containerEl: { ownerDocument: d } } })),
		},
	} as unknown as App;
	const onLoaded = vi.fn();
	const loader = new WebFontLoader(app, onLoaded);
	const fetchStylesheet = vi.fn(async () => css);
	loader.fetchStylesheet = fetchStylesheet;
	const docs = { main: main as unknown as Document, popout: popout as unknown as Document };
	return { loader, main, popout, windows, fetchStylesheet, onLoaded, docs };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal("window", globalThis);
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("WebFontLoader", () => {
	it("asks for nothing, and adds nothing, until it is enabled", async () => {
		const t = setup();
		expect(t.fetchStylesheet).not.toHaveBeenCalled();
		await t.loader.setEnabled(false);
		await t.loader.windowOpened(t.docs.main);
		expect(t.fetchStylesheet).not.toHaveBeenCalled();
		expect(t.main.faces.size + t.popout.faces.size).toBe(0);
	});

	it("adds the fonts to the main window and to pop-out windows", async () => {
		const t = setup();
		await t.loader.setEnabled(true);
		expect(t.fetchStylesheet).toHaveBeenCalledTimes(1);
		expect(t.main.faces.size).toBe(FACES);
		expect(t.popout.faces.size).toBe(FACES);
		expect(t.loader.count(t.docs.main)).toBe(FACES);
		const families = new Set([...t.main.faces].map((f) => f.family));
		expect(families).toEqual(new Set(["Inter", "Roboto", "Open Sans", "Montserrat", "Lato"]));
		const inter = [...t.main.faces][0];
		expect(inter.source).toContain("https://fonts.gstatic.com/s/inter/");
		expect(inter.descriptors).toMatchObject({ weight: "400", display: "swap" });
	});

	it("is idempotent: enabling again neither asks again nor adds twice", async () => {
		const t = setup();
		await t.loader.setEnabled(true);
		await t.loader.setEnabled(true);
		expect(t.fetchStylesheet).toHaveBeenCalledTimes(1);
		expect(t.main.faces.size).toBe(FACES);
	});

	it("removes every font again when disabled, and asks again when re-enabled only if it must", async () => {
		const t = setup();
		await t.loader.setEnabled(true);
		await t.loader.setEnabled(false);
		expect(t.main.faces.size + t.popout.faces.size).toBe(0);
		expect(t.main.listeners.size + t.popout.listeners.size).toBe(0);
		await t.loader.setEnabled(true);
		expect(t.main.faces.size).toBe(FACES);
		expect(t.fetchStylesheet).toHaveBeenCalledTimes(1); // the parsed rules were kept
	});

	it("gives a window opened later the fonts, but only while enabled", async () => {
		const t = setup();
		const late = new FakeDocument();
		await t.loader.windowOpened(late as unknown as Document);
		expect(late.faces.size).toBe(0);
		await t.loader.setEnabled(true);
		await t.loader.windowOpened(late as unknown as Document);
		expect(late.faces.size).toBe(FACES);
		t.loader.dispose();
		expect(late.faces.size).toBe(0);
	});

	it("rejects when Google cannot be reached, adds nothing, and tries again next time", async () => {
		const t = setup();
		t.fetchStylesheet.mockRejectedValueOnce(new Error("offline"));
		await expect(t.loader.setEnabled(true)).rejects.toThrow("offline");
		expect(t.main.faces.size).toBe(0);
		await t.loader.setEnabled(true);
		expect(t.fetchStylesheet).toHaveBeenCalledTimes(2);
		expect(t.main.faces.size).toBe(FACES);
	});

	it("rejects an answer without usable fonts", async () => {
		const t = setup();
		t.fetchStylesheet.mockResolvedValueOnce("<html>Sign in to continue</html>");
		await expect(t.loader.setEnabled(true)).rejects.toThrow(/no fonts/);
		expect(t.main.faces.size).toBe(0);
	});

	it("adds nothing when switched off while the stylesheet is still downloading", async () => {
		const t = setup();
		let finish!: (css: string) => void;
		t.fetchStylesheet.mockReturnValueOnce(new Promise<string>((r) => (finish = r)));
		const pending = t.loader.setEnabled(true);
		await t.loader.setEnabled(false);
		finish(css);
		await pending;
		expect(t.main.faces.size + t.popout.faces.size).toBe(0);
	});

	it("tells the editors once, after the fonts settled, so text is measured again", async () => {
		const t = setup();
		await t.loader.setEnabled(true);
		const mine = [...t.main.faces];
		t.main.finishLoading([mine[0]]);
		t.main.finishLoading([mine[1], mine[2]]);
		expect(t.onLoaded).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(300);
		expect(t.onLoaded).toHaveBeenCalledTimes(1);
		// a font that is not one of ours (Obsidian's own, a theme's) changes nothing
		t.main.finishLoading([new FakeFontFace("Some theme font", "x", {})]);
		await vi.advanceTimersByTimeAsync(300);
		expect(t.onLoaded).toHaveBeenCalledTimes(1);
	});

	it("does not call back after being disabled", async () => {
		const t = setup();
		await t.loader.setEnabled(true);
		t.main.finishLoading([...t.main.faces]);
		await t.loader.setEnabled(false);
		await vi.advanceTimersByTimeAsync(300);
		expect(t.onLoaded).not.toHaveBeenCalled();
	});
});
