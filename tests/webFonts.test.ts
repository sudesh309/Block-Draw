import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSettings, type SecretStore } from "../src/kernel/settings";
import { DEFAULT_SETTINGS, SETTINGS, type BlockDrawSettings } from "../src/obsidian/settings";
import { PRESENTATION_FONTS, WEB_FONTS_URL } from "../src/render/fonts";
import { LIGHT_THEME } from "../src/render/colors";
import { sceneToSvg } from "../src/render/scene";
import { clearTextMeasureCache, measureText, setTextMeasure, useEstimatedTextMeasure } from "../src/render/text";
import { parseWebFontFaces } from "../src/render/webFontFaces";
import { block } from "./helpers";

const fixture = readFileSync(join(__dirname, "fixtures", "google-fonts.css"), "utf8");

const noSecrets: SecretStore = { get: () => null, set: () => true };
const mergeSettings = (saved: unknown) => loadSettings<BlockDrawSettings>(SETTINGS, saved, noSecrets).values;

describe("web fonts are opt-in", () => {
	it("are off by default, and only a literal true turns them on", () => {
		expect(DEFAULT_SETTINGS.webFonts).toBe(false);
		expect(mergeSettings(undefined).webFonts).toBe(false);
		expect(mergeSettings({}).webFonts).toBe(false);
		expect(mergeSettings({ webFonts: true }).webFonts).toBe(true);
		expect(mergeSettings({ webFonts: "true" }).webFonts).toBe(false);
		expect(mergeSettings({ webFonts: 1 }).webFonts).toBe(false);
		// other saved settings are untouched
		expect(mergeSettings({ webFonts: true, gridSize: 30 }).gridSize).toBe(30);
	});

	it("name exactly the families the font list marks as web fonts", () => {
		const url = new URL(WEB_FONTS_URL);
		expect(url.origin).toBe("https://fonts.googleapis.com");
		const requested = url.searchParams.getAll("family").map((f) => f.split(":")[0]).sort();
		const web = PRESENTATION_FONTS.filter((f) => f.web).map((f) => f.name).sort();
		expect(requested).toEqual(web);
		// the system fonts are never requested
		for (const f of PRESENTATION_FONTS.filter((f) => !f.web)) expect(requested).not.toContain(f.name);
	});

	it("keep SVG files free of any import unless asked for", () => {
		const elements = [block("a", 0, 0, { title: "Hello" })];
		const plain = sceneToSvg(elements, { theme: LIGHT_THEME }).svg;
		expect(plain).not.toMatch(/@import|googleapis|gstatic/);
		const withFonts = sceneToSvg(elements, { theme: LIGHT_THEME, webFonts: true }).svg;
		expect(withFonts).toContain("<style>@import url('https://fonts.googleapis.com/css2?family=Inter");
		// `&` must be escaped to stay well-formed XML
		expect(withFonts).toContain("&amp;family=Lato");
		expect(withFonts).not.toMatch(/[^;]&family/);
	});
});

describe("parseWebFontFaces", () => {
	const faces = parseWebFontFaces(fixture);

	it("reads every rule of Google's stylesheet", () => {
		expect(faces.map((f) => `${f.family} ${f.descriptors.weight}`)).toEqual([
			"Inter 400",
			"Inter 700",
			"Roboto 500",
			"Open Sans 400",
			"Montserrat 600",
			"Lato 400",
			"Inter 400",
		]);
	});

	it("keeps the source, weight, stretch and unicode range for the FontFace API", () => {
		const [cyr] = faces;
		expect(cyr.source).toBe("url(https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa2JL7SUc.woff2) format('woff2')");
		expect(cyr.descriptors).toEqual({
			display: "swap",
			style: "normal",
			weight: "400",
			unicodeRange: "U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F",
		});
		expect(faces[2].descriptors.stretch).toBe("100%");
		expect(faces[3].family).toBe("Open Sans");
	});

	it("reads the TrueType form Google serves to clients it does not know", () => {
		const ttf = faces[faces.length - 1];
		expect(ttf.source).toMatch(/\.ttf\) format\('truetype'\)$/);
		expect(ttf.descriptors.unicodeRange).toBeUndefined();
	});

	it("ignores comments and unrelated rules", () => {
		const css = `/* @font-face { font-family: 'Inter'; src: url(https://fonts.gstatic.com/x.woff2); } */ body { color: red; }`;
		expect(parseWebFontFaces(css)).toEqual([]);
	});

	const rule = (family: string, src: string) => `@font-face { font-family: ${family}; font-weight: 400; src: ${src}; }`;
	const good = "url(https://fonts.gstatic.com/s/inter/v20/x.woff2) format('woff2')";

	it("accepts quoted urls and families", () => {
		expect(parseWebFontFaces(rule(`"Inter"`, `url("https://fonts.gstatic.com/s/inter/x.woff2")`))).toHaveLength(1);
		expect(parseWebFontFaces(rule(`'Open Sans'`, `url('https://fonts.gstatic.com/s/o/x.woff2') format("woff2")`))).toHaveLength(1);
		expect(parseWebFontFaces(rule("Inter", good))).toHaveLength(1);
	});

	it("only trusts Google's font host, one source per rule", () => {
		const bad = [
			"url(https://evil.example/x.woff2)",
			"url(http://fonts.gstatic.com/s/x.woff2)",
			"url(https://fonts.gstatic.com.evil.example/x.woff2)",
			"url(https://fonts.gstatic.com@evil.example/x.woff2)",
			"url(//fonts.gstatic.com/x.woff2)",
			"url(data:font/woff2;base64,AAAA)",
			"url(file:///etc/passwd)",
			"local(Inter)",
			`${good}, url(https://evil.example/y.woff2)`,
			"url(https://fonts.gstatic.com/x.woff2) tech(variations)",
		];
		for (const src of bad) expect(parseWebFontFaces(rule("Inter", src)), src).toEqual([]);
	});

	it("only registers the families the font list asks for", () => {
		for (const family of ["'Segoe UI'", "Arial", "'Comic Sans MS'", "monospace", "''"]) {
			expect(parseWebFontFaces(rule(family, good)), family).toEqual([]);
		}
		expect(parseWebFontFaces(`@font-face { src: ${good}; }`)).toEqual([]);
	});
});

describe("measuring text after fonts changed", () => {
	it("clearTextMeasureCache makes the next measure use the new font", () => {
		let wide = 1;
		setTextMeasure(() => 10 * wide);
		expect(measureText("cache me", 14)).toBe(10);
		wide = 2;
		expect(measureText("cache me", 14)).toBe(10); // cached
		clearTextMeasureCache();
		expect(measureText("cache me", 14)).toBe(20);
		useEstimatedTextMeasure();
	});
});
