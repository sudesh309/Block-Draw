import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "styles.css"), "utf8");
const lines = css.split("\n");
const offending = (re: RegExp) => lines.map((l, i) => (re.test(l) ? `styles.css:${i + 1}: ${l.trim()}` : null)).filter(Boolean);

/** Things the Obsidian community review flags in a plugin's stylesheet. */
describe("styles.css", () => {
	it("does not use !important, not even in a comment (the review counts the text)", () => {
		expect(offending(/!important/i)).toEqual([]);
	});

	it("avoids scrollbar-width and scrollbar-color, which Obsidian's older Chromium only partly supports", () => {
		expect(offending(/scrollbar-(width|color)\s*:/)).toEqual([]);
	});

	it("never loads anything from the network", () => {
		expect(offending(/@import|url\(\s*["']?https?:/i)).toEqual([]);
	});
});
