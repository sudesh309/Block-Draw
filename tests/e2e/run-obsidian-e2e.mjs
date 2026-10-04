// End-to-end tests inside the real Obsidian desktop app.
//
//   npm run build
//   OBSIDIAN_BIN=/path/to/obsidian node tests/e2e/run-obsidian-e2e.mjs
//
// OBSIDIAN_BIN is the Obsidian executable (e.g. from `Obsidian-x.y.z.AppImage --appimage-extract`,
// squashfs-root/obsidian). Needs xvfb-run on Linux without a display. Set SHOTS=<dir> to keep
// screenshots and PLUGIN_DIR=<dir> to install main.js/manifest.json/styles.css from somewhere
// other than the repository root (e.g. files downloaded from a release). A fresh temporary vault
// and Obsidian profile are used; nothing else is touched. The mock Apps Script bridge serves https
// with a throwaway certificate made by openssl, which must be on the PATH.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
import { chromium } from "playwright-core";
import { startCdpShim } from "./cdpShim.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const BIN = process.env.OBSIDIAN_BIN;
if (!BIN) {
	console.error("Set OBSIDIAN_BIN to the Obsidian executable.");
	process.exit(2);
}
const SHOTS = process.env.SHOTS || null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const PORT = 9400 + Math.floor(Math.random() * 400);

/* -------------------------------------------------------------- set up */

await esbuild.build({
	entryPoints: [join(here, "mockBridge.ts")],
	bundle: true,
	platform: "node",
	format: "esm",
	outfile: join(here, "dist", "mockBridge.mjs"),
	logLevel: "warning",
});
const { startMockBridge } = await import("./dist/mockBridge.mjs");
const SECRET = "e2e-secret";
const work = mkdtempSync(join(tmpdir(), "bd-e2e-"));
// The plugin only sends requests over https, so the bridge needs a certificate. Obsidian is
// started with --ignore-certificate-errors to accept this self-signed one.
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1", "-keyout", join(work, "key.pem"), "-out", join(work, "cert.pem")], { stdio: "ignore" });
const bridge = await startMockBridge(root, SECRET, { key: readFileSync(join(work, "key.pem"), "utf8"), cert: readFileSync(join(work, "cert.pem"), "utf8") });

const home = join(work, "home");
const vault = join(work, "vault");
const pluginDir = join(vault, ".obsidian", "plugins", "block-draw");
mkdirSync(join(home, ".config", "obsidian"), { recursive: true });
mkdirSync(pluginDir, { recursive: true });
const pluginSource = process.env.PLUGIN_DIR || root;
for (const f of ["main.js", "manifest.json", "styles.css"]) cpSync(join(pluginSource, f), join(pluginDir, f));
writeFileSync(join(vault, ".obsidian", "community-plugins.json"), JSON.stringify(["block-draw"]));
writeFileSync(join(vault, "Welcome.md"), "# Welcome\n");
writeFileSync(
	join(home, ".config", "obsidian", "obsidian.json"),
	JSON.stringify({ vaults: { e2evault0000000: { path: vault, ts: Date.now(), open: true } }, updateDisabled: true }),
);

const args = [BIN, "--no-sandbox", "--disable-gpu", "--ignore-certificate-errors", `--remote-debugging-port=${PORT}`];
const proc = spawn(process.platform === "linux" && !process.env.DISPLAY ? "xvfb-run" : args.shift(), process.platform === "linux" && !process.env.DISPLAY ? ["-a", "-s", "-screen 0 1440x900x24", ...args] : args, {
	env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
	detached: true,
	stdio: "ignore",
});

async function waitForCdp() {
	for (let i = 0; i < 120; i++) {
		try {
			const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
			if (res.ok) return;
		} catch {
			// not up yet
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error("Obsidian did not start");
}

function shutdown() {
	try {
		process.kill(-proc.pid, "SIGTERM");
	} catch {
		// already gone
	}
}
process.on("exit", shutdown);

await waitForCdp();
let browser;
try {
	browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
} catch (e) {
	if (!/Browser context management is not supported/.test(String(e))) throw e;
	browser = await chromium.connectOverCDP(await startCdpShim(PORT));
}
let page;
for (let i = 0; i < 60 && !page; i++) {
	page = browser.contexts()[0]?.pages().find((p) => p.url().startsWith("app://"));
	if (!page) await new Promise((r) => setTimeout(r, 500));
}
assert.ok(page, "Obsidian window not found");
await page.setViewportSize({ width: 1440, height: 900 });
const errors = [];
page.on("pageerror", (e) => {
	// Obsidian 1.13 itself throws this bare string now and then while it enables community plugins: the same
	// plugin build passes and fails, and the text is not in main.js.
	if (e.message.trim() === "illegal access") return;
	errors.push(`pageerror: ${e.message}\n${e.stack}`);
});
page.on("console", (m) => {
	if (m.type() !== "error") return;
	const text = m.text();
	if (/net::|Failed to load resource|ERR_|obsidian\.md|sync/i.test(text)) return;
	errors.push(text);
});
/** Renderer requests to Google's font hosts: there must be none until web fonts are switched on. */
const fontRequests = [];
let currentTest = "start-up";
page.on("request", (r) => {
	if (/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(r.url())) fontRequests.push(`${r.resourceType()} during "${currentTest}": ${r.url()}`);
});
await page.waitForFunction(() => window.app?.workspace?.layoutReady === true, null, { timeout: 60000 });

/* ------------------------------------------------------------- helpers */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const print = (line) => process.stdout.write(`${line}\n`);
const shot = async (name) => SHOTS && page.screenshot({ path: join(SHOTS, `${name}.png`) });
const frame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
/** Runs fn(editor, arg) in the page with the editor of the visible drawing. */
async function editorEval(fn, arg) {
	const ed = await page.evaluateHandle(
		() => window.app.workspace.getLeavesOfType("block-draw-view").find((l) => l.view.containerEl.isShown())?.view?.editor,
	);
	try {
		return await ed.evaluate(fn, arg);
	} finally {
		await ed.dispose();
	}
}
/** Page coordinates of a world point in the visible drawing. */
const toPage = (p) =>
	editorEval((ed, p) => {
		const r = ed.svg.getBoundingClientRect();
		const s = ed.worldToScreen(p);
		return { x: r.left + s.x, y: r.top + s.y };
	}, p);
const canvasRect = () => editorEval((ed) => JSON.parse(JSON.stringify(ed.svg.getBoundingClientRect())));
const elements = () => editorEval((ed) => JSON.parse(JSON.stringify(ed.getElements())));
async function drag(from, to, steps = 10) {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	for (let i = 1; i <= steps; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
	await page.mouse.up();
	await frame();
}
async function addBlock(x, y, title) {
	await page.mouse.dblclick(x, y);
	await frame();
	await page.keyboard.type(title);
	await page.keyboard.press("Enter");
	await frame();
	const els = await elements();
	return els[els.length - 1];
}
/** Waits until a locator stops moving: presenting animates the view when it starts and between slides. */
async function settled(locator) {
	let last = JSON.stringify(await locator.boundingBox());
	for (let i = 0; i < 30; i++) {
		await sleep(100);
		const now = JSON.stringify(await locator.boundingBox());
		if (now === last) return;
		last = now;
	}
	throw new Error("the page kept moving");
}
const readFile = (path) => page.evaluate((p) => window.app.vault.adapter.read(p), path);
const command = (id) => page.evaluate((id) => window.app.commands.executeCommandById(id), id);
async function waitFor(fn, what, timeout = 15000) {
	const t0 = Date.now();
	for (;;) {
		const v = await fn();
		if (v) return v;
		if (Date.now() - t0 > timeout) throw new Error(`Timed out waiting for ${what}`);
		await sleep(250);
	}
}

const FONTS_CSS = readFileSync(join(root, "tests", "fixtures", "google-fonts.css"), "utf8");

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const state = {};

/* --------------------------------------------------------------- tests */

test("vault trust prompt enables the plugin", async () => {
	const trust = page.getByRole("button", { name: "Trust author and enable plugins" });
	await trust.waitFor({ state: "visible", timeout: 8000 }).catch(() => undefined);
	if (await trust.isVisible().catch(() => false)) {
		await trust.click();
	} else {
		// No trust prompt (e.g. already answered): turn off restricted mode like the settings toggle.
		await page.evaluate(async () => {
			await window.app.plugins.setEnable(true);
			await window.app.plugins.enablePluginAndSave("block-draw");
		});
	}
	await waitFor(() => page.evaluate(() => !!window.app.plugins.plugins["block-draw"]), "plugin to load");
	// Older versions open Settings → Community plugins after trusting the vault.
	for (let i = 0; i < 3 && (await page.isVisible(".modal-container")); i++) {
		await page.keyboard.press("Escape");
		await sleep(200);
	}
	print(`    Obsidian ${await page.evaluate(() => window.require("electron").ipcRenderer.sendSync("version"))}`);
	const reg = await page.evaluate(() => ({
		ext: window.app.viewRegistry.getTypeByExtension("blockdraw"),
		cmd: !!window.app.commands.commands["block-draw:create-drawing"],
	}));
	assert.deepEqual(reg, { ext: "block-draw-view", cmd: true });
});

test("command palette creates and opens a drawing", async () => {
	await command("block-draw:create-drawing");
	await page.waitForSelector(".bd-editor", { timeout: 10000 });
	state.path = await page.evaluate(() => window.app.workspace.getActiveFile()?.path);
	assert.match(state.path, /^Drawing .*\.blockdraw$/);
	await frame();
	assert.equal(await page.isVisible(".bd-empty-hint.is-visible"), true);
	await shot("e2e-01-new-drawing");
});

test("the drawing fills its pane: Obsidian's padding is overridden without !important", async () => {
	const pad = await page.evaluate(() => {
		const view = window.app.workspace.getLeavesOfType("block-draw-view").find((l) => l.view.containerEl.isShown()).view;
		const cs = getComputedStyle(view.contentEl);
		return { sides: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft], overflow: cs.overflow, inPane: view.contentEl.matches(".workspace-leaf-content .view-content.bd-view-container") };
	});
	assert.deepEqual(pad.sides, ["0px", "0px", "0px", "0px"]);
	assert.equal(pad.inPane, true);
	const box = await editorEval((ed) => JSON.parse(JSON.stringify(ed.root.getBoundingClientRect())));
	const pane = await page.evaluate(() => JSON.parse(JSON.stringify(window.app.workspace.getLeavesOfType("block-draw-view").find((l) => l.view.containerEl.isShown()).view.contentEl.getBoundingClientRect())));
	assert.ok(Math.abs(box.width - pane.width) < 1.5 && Math.abs(box.height - pane.height) < 1.5, `canvas ${box.width}×${box.height} fills pane ${pane.width}×${pane.height}`);
});

test("draws blocks, connects them and saves to disk", async () => {
	const r = await canvasRect();
	const a = await addBlock(r.left + 380, r.top + 260, "Start");
	const b = await addBlock(r.left + 760, r.top + 260, "Finish");
	await page.mouse.click(r.left + 20, r.bottom - 20);
	const ca = await toPage({ x: a.x + a.width / 2, y: a.y + a.height / 2 });
	await page.mouse.move(ca.x, ca.y);
	await frame();
	const dot = await toPage({ x: a.x + a.width + 16, y: a.y + a.height / 2 });
	const cb = await toPage({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
	await drag(dot, cb);
	await editorEval((ed, id) => ed.updateElement(id, { comment: "Confirm with design", commentOpen: true }), a.id);
	await frame();
	assert.equal(await page.locator(".bd-comment-callout").count(), 1);
	const els = await elements();
	assert.equal(els.filter((e) => e.type === "block").length, 2);
	assert.equal(els.filter((e) => e.type === "connector").length, 1);
	await sleep(2600); // requestSave is debounced by 2 s
	const saved = JSON.parse(await readFile(state.path));
	assert.equal(saved.type, "block-draw");
	assert.deepEqual(
		saved.elements.filter((e) => e.type === "block").map((e) => e.title),
		["Start", "Finish"],
	);
	assert.equal(saved.elements.filter((e) => e.type === "connector").length, 1);
	const startSaved = saved.elements.find((e) => e.title === "Start");
	assert.equal(startSaved.comment, "Confirm with design");
	assert.equal(startSaved.commentOpen, true);
	await shot("e2e-02-blocks");
});

test("frames group blocks and blocks link to frames", async () => {
	const r = await canvasRect();
	await page.mouse.click(r.left + 20, r.bottom - 20);
	await page.keyboard.press("f");
	const els = await elements();
	const blocks = els.filter((e) => e.type === "block");
	const tl = await toPage({ x: blocks[0].x - 60, y: blocks[0].y - 80 });
	const br = await toPage({ x: blocks[1].x + blocks[1].width + 60, y: blocks[1].y + blocks[1].height + 120 });
	await drag(tl, br);
	await page.keyboard.type("Overview");
	await page.keyboard.press("Enter");
	await command("block-draw:add-frame");
	await sleep(500);
	const c = await canvasRect();
	await addBlock(c.left + c.width / 2, c.top + c.height / 2, "Detail");
	const all = await elements();
	const [overview, second] = all.filter((e) => e.type === "frame");
	assert.equal(overview.title, "Overview");
	assert.ok(all.filter((e) => e.type === "block" && e.frameId === overview.id).length === 2, "blocks adopted by Overview");
	assert.ok(all.some((e) => e.type === "block" && e.title === "Detail" && e.frameId === second.id), "Detail in the new frame");
	state.overview = overview;
	state.second = second;

	await command("block-draw:previous-frame");
	await sleep(500);
	const start = all.find((e) => e.title === "Start");
	const p = await toPage({ x: start.x + start.width / 2, y: start.y + start.height / 2 });
	await page.mouse.click(p.x, p.y);
	await frame();
	await page.selectOption(".bd-props .bd-select", `frame:${second.id}`);
	await frame();
	await shot("e2e-03-linked");
	const badge = await toPage({ x: start.x + start.width - 12, y: start.y + 12 });
	await page.mouse.click(badge.x, badge.y);
	await sleep(600);
	const center = await editorEval((ed) => {
		const s = ed.viewSize();
		return ed.screenToWorld({ x: s.width / 2, y: s.height / 2 });
	});
	assert.ok(Math.abs(center.x - (second.x + second.width / 2)) < 40, `navigated to the linked frame (x=${center.x})`);
	await shot("e2e-04-followed");
	await page.click(".bd-back-btn");
	await sleep(600);
	await sleep(2200);
	const saved = JSON.parse(await readFile(state.path));
	assert.equal(saved.elements.find((e) => e.title === "Start").link, `frame:${second.id}`);
});

test("reopening the file restores the drawing", async () => {
	await page.evaluate(() => window.app.workspace.getLeavesOfType("block-draw-view").forEach((l) => l.detach()));
	await page.evaluate((p) => window.app.workspace.openLinkText(p, "", false), state.path);
	await page.waitForSelector(".bd-editor");
	await frame();
	const els = await elements();
	assert.equal(els.filter((e) => e.type === "frame").length, 2);
	assert.equal(els.filter((e) => e.type === "block").length, 3);
	// the comment and its open state survive the round trip through disk.
	const start = els.find((e) => e.title === "Start");
	assert.equal(start.comment, "Confirm with design");
	assert.equal(start.commentOpen, true);
	assert.equal(await page.locator(".bd-comment-callout").count(), 1);
});

test("a link with #Frame opens the drawing at that frame", async () => {
	await page.evaluate(() => window.app.workspace.getLeavesOfType("block-draw-view").forEach((l) => l.detach()));
	await page.evaluate((p) => window.app.workspace.openLinkText(`${p}#Overview`, "", false), state.path);
	await page.waitForSelector(".bd-editor");
	await sleep(400);
	const center = await editorEval((ed) => {
		const s = ed.viewSize();
		return ed.screenToWorld({ x: s.width / 2, y: s.height / 2 });
	});
	const o = state.overview;
	assert.ok(Math.abs(center.x - (o.x + o.width / 2)) < 40, `centered on Overview (x=${center.x})`);
});

test("exports JSON, Excel, SVG and PNG files", async () => {
	await editorEval((ed) => ed.clearSelection());
	for (const id of ["export-json", "export-xlsx", "export-svg", "export-png"]) await command(`block-draw:${id}`);
	const base = state.path.replace(/\.blockdraw$/, "");
	const exists = (p) => page.evaluate((p) => window.app.vault.adapter.exists(p), p);
	await waitFor(async () => (await exists(`${base}.json`)) && (await exists(`${base}.xlsx`)) && (await exists(`${base}.svg`)) && (await exists(`${base}.png`)), "export files");
	const jsonText = await readFile(`${base}.json`);
	const json = JSON.parse(jsonText);
	assert.equal(json.format, "block-draw/export");
	assert.equal(json.version, 2);
	assert.equal(json.frames[0].title, "Overview");
	// only what the diagram says: no colors or styles, positions, drawing name or timestamp
	for (const gone of ['"style"', '"fill"', '"stroke"', '"bounds"', '"canvasBounds"', '"routing"', '"commentOpen"', '"exportedAt"', '"name"']) {
		assert.ok(!jsonText.includes(gone), `the JSON export has no ${gone}`);
	}
	assert.ok(!/#[0-9a-f]{6}/i.test(jsonText), "and no color codes");
	assert.ok(jsonText.includes('"tag"'), "but every block has its tag");
	assert.equal(json.frames[0].linksTo[0].frameId, state.second.id);
	const head = await page.evaluate(async (p) => {
		const bin = new Uint8Array(await window.app.vault.adapter.readBinary(p));
		return [bin[0], bin[1], bin.length];
	}, `${base}.xlsx`);
	assert.deepEqual(head.slice(0, 2), [0x50, 0x4b]);
	const png = await page.evaluate(async (p) => Array.from(new Uint8Array(await window.app.vault.adapter.readBinary(p)).slice(0, 4)), `${base}.png`);
	assert.deepEqual(png, [0x89, 0x50, 0x4e, 0x47]);
	assert.match(await readFile(`${base}.svg`), /^<svg[^>]+viewBox/);
	// with a frame selected, image exports contain just that frame
	await editorEval((ed, id) => ed.setSelection([id]), state.second.id);
	await command("block-draw:export-svg");
	const frameSvg = `${base} - Frame 2.svg`;
	await waitFor(() => exists(frameSvg), "frame SVG");
	const svg = await readFile(frameSvg);
	assert.ok(svg.includes(">Detail<") && !svg.includes(">Start<"));
});

test("theme, 3D and presentation commands work in Obsidian", async () => {
	await editorEval((ed) => ed.clearSelection());
	await command("block-draw:theme-futuristic");
	await frame();
	let els = await elements();
	assert.ok(els.filter((e) => e.type === "block").every((b) => b.style.threeD), "futuristic raises every block");
	await waitFor(async () => (await readFile(state.path)).includes('"threeD":true'), "3D saved to disk");
	assert.ok((await page.locator(".bd-block.bd-3d").count()) >= 3);
	await shot("e2e-08-futuristic");
	await command("block-draw:present");
	await page.waitForSelector(".bd-editor.bd-presenting");
	assert.equal(await page.isVisible(".bd-toolbar"), false);
	// clicking a comment badge while presenting shows or hides the comment, and never touches the file
	const savedText = await readFile(state.path);
	const callouts = () => page.locator(".bd-comment-callout").count();
	assert.equal(await callouts(), 1, "the saved comment is open");
	await settled(page.locator(".bd-block .bd-comment-badge").first());
	for (const expected of [0, 1]) {
		const box = await page.locator(".bd-block .bd-comment-badge").first().boundingBox();
		await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
		await frame();
		const seen = await callouts();
		const why = await page.evaluate(() => {
			const ed = window.app.workspace.getLeavesOfType("block-draw-view").find((l) => l.view.containerEl.isShown())?.view?.editor;
			return JSON.stringify({ overrides: ed ? [...ed.presenter.commentOverrides] : null, badges: document.querySelectorAll(".bd-comment-badge").length, views: window.app.workspace.getLeavesOfType("block-draw-view").length });
		});
		assert.equal(seen, expected, `each click on the badge toggles the comment (${why})`);
	}
	assert.equal(await readFile(state.path), savedText, "presenting does not change the drawing file");
	const first = await page.textContent(".bd-present-counter");
	await page.keyboard.press("ArrowRight");
	await sleep(450);
	assert.notEqual(await page.textContent(".bd-present-counter"), first);
	await shot("e2e-09-presenting");
	await page.keyboard.press("Escape");
	await frame();
	assert.equal(await page.locator(".bd-editor.bd-presenting").count(), 0);
	assert.equal(await page.isVisible(".bd-toolbar"), true);
	await command("block-draw:toggle-3d");
	els = await elements();
	assert.ok(els.filter((e) => e.type !== "frame").every((e) => !e.style.threeD), "toggle-3d turns it off everywhere");
});

test("Google Sheets export goes through the Apps Script bridge and updates in place", async () => {
	await page.evaluate(
		async ([url, secret]) => {
			const p = window.app.plugins.plugins["block-draw"];
			p.settings.sheets.appsScriptUrl = url;
			p.settings.sheets.appsScriptSecret = secret;
			p.settings.sheets.openAfterExport = false;
			await p.saveSettings();
		},
		[bridge.url, SECRET],
	);
	// The secret is kept on this device, not in the vault's data.json, and comes back on load.
	const saved = readFileSync(join(pluginDir, "data.json"), "utf8");
	assert.ok(!saved.includes(SECRET), "the Apps Script secret is not written to data.json");
	assert.match(saved, /"appsScriptUrl"/);
	const reloaded = await page.evaluate(async () => {
		const p = window.app.plugins.plugins["block-draw"];
		await p.loadSettings();
		return p.settings.sheets.appsScriptSecret;
	});
	assert.equal(reloaded, SECRET, "the secret is read back from this device's secret storage");

	// 127.0.0.1 is not a Google Apps Script host: the first export asks before sending anything.
	await command("block-draw:export-google-sheets");
	const ask = page.locator(".modal", { hasText: "Send drawings to this address?" });
	await ask.waitFor({ timeout: 10000 });
	assert.match(await ask.textContent(), /127\.0\.0\.1 is not a Google Apps Script address/);
	assert.equal(bridge.log.length, 0, "nothing is sent before the address is confirmed");
	await ask.getByRole("button", { name: "Send" }).click();
	const first = await waitFor(async () => JSON.parse(await readFile(state.path)).exports?.googleSheet, "export info saved in the drawing", 20000);
	assert.equal(bridge.svc.spreadsheets.size, 1);
	const titles = [...bridge.svc.spreadsheets.get(first.spreadsheetId).sheets].sort((a, b) => a.index - b.index).map((s) => s.title);
	assert.deepEqual(titles, ["Index", "Overview", "Frame 2", "Blocks", "Connections"]);
	assert.ok(bridge.log.includes("GET echo ok"), "followed the Apps Script redirect");
	// Confirmed once per session: the second export does not ask again.
	await command("block-draw:export-google-sheets");
	await waitFor(
		async () => JSON.parse(await readFile(state.path)).exports?.googleSheet?.exportedAt !== first.exportedAt,
		"second export",
		20000,
	);
	assert.equal(bridge.svc.spreadsheets.size, 1, "re-export updated the same spreadsheet");
	assert.equal(await page.locator(".modal", { hasText: "Send drawings to this address?" }).count(), 0, "the address is not asked for twice");
	await shot("e2e-05-after-gsheet");
});

test("settings tab renders and tests the bridge connection", async () => {
	await page.evaluate(() => {
		window.app.setting.open();
		window.app.setting.openTabById("block-draw");
	});
	try {
		// Obsidian 1.13 shows settings in a popout window; older versions use a modal.
		const headingsOf = (p) =>
			p.evaluate(() => [...document.querySelectorAll(".setting-item-heading .setting-item-name")].map((e) => e.textContent)).catch(() => []);
		const settingsPage = await waitFor(async () => {
			for (const p of page.context().pages()) if ((await headingsOf(p)).length) return p;
			return null;
		}, "settings window");
		assert.deepEqual(await headingsOf(settingsPage), ["Drawings", "Export", "Google Sheets"]);
		const fontsRow = await settingsPage.evaluate(() => {
			const row = [...document.querySelectorAll(".setting-item")].find((r) => r.querySelector(".setting-item-name")?.textContent === "Load web fonts from Google Fonts");
			return row ? { on: row.querySelector(".checkbox-container")?.classList.contains("is-enabled") ?? null, desc: row.querySelector(".setting-item-description")?.textContent ?? "" } : null;
		});
		assert.ok(fontsRow, "the web fonts setting is listed");
		assert.equal(fontsRow.on, false, "web fonts are off by default");
		assert.match(fontsRow.desc, /never contacts Google for fonts/);
		// every setting shows its control; only the two rows that explain a step have none
		const withoutControl = await settingsPage.evaluate(() =>
			[...document.querySelectorAll(".setting-item:not(.setting-item-heading)")]
				.filter((r) => r.offsetParent !== null && !r.querySelector(".setting-item-control")?.children.length)
				.map((r) => r.querySelector(".setting-item-name")?.textContent),
		);
		assert.deepEqual(withoutControl, ["How it works", "Apps Script setup"]);
		await settingsPage.getByRole("button", { name: "Test" }).click();
		const noticeShown = async () => {
			for (const p of page.context().pages()) {
				const found = await p
					.evaluate(() => [...document.querySelectorAll(".notice")].some((n) => /Connected to the Block Draw bridge as e2e@example\.com/.test(n.textContent)))
					.catch(() => false);
				if (found) return true;
			}
			return false;
		};
		await waitFor(noticeShown, "connection notice");
		if (SHOTS) await settingsPage.screenshot({ path: join(SHOTS, "e2e-06-settings.png") });
	} finally {
		// close it even after a failure, or the settings modal (Obsidian 1.5) covers the next test
		await page.evaluate(() => window.app.setting.close());
	}
});

test("nested blocks, text alignment and opt-in web fonts work in Obsidian", async () => {
	await command("block-draw:create-drawing");
	await waitFor(() => page.evaluate((p) => window.app.workspace.getActiveFile()?.path !== p, state.path), "a new drawing");
	state.fontsPath = await page.evaluate(() => window.app.workspace.getActiveFile().path);
	await waitFor(() => editorEval((ed) => ed.viewSize().width > 0 && ed.viewSize().height > 0).catch(() => false), "the new drawing's editor to be laid out");
	const ids = await editorEval((ed) => {
		const box = ed.makeBlock({ x: 60, y: 60, width: 520, height: 260 }, { title: "Platform", style: { ...ed.current.block, fill: "#e7f5ff", textVAlign: "top" } });
		const web = ed.makeBlock({ x: 100, y: 140, width: 140, height: 70 }, { title: "Web" });
		const api = ed.makeBlock({ x: 400, y: 140, width: 140, height: 70 }, { title: "API" });
		ed.insertBlocks([box, web, api]);
		const link = ed.connect(web.id, api.id);
		ed.updateElement(link.id, { label: "calls" });
		ed.clearSelection();
		ed.zoomToFit({ animate: false });
		return { box: box.id, web: web.id, api: api.id, link: link.id };
	});
	await frame();

	// a link between two blocks inside another block is drawn above it
	const onLink = await toPage({ x: 270, y: 175 });
	const topmost = await page.evaluate(({ x, y }) => {
		const el = document.elementFromPoint(x, y);
		return { link: el?.closest(".bd-connector")?.getAttribute("data-id") ?? null, block: el?.closest(".bd-block")?.getAttribute("data-id") ?? null };
	}, onLink);
	assert.deepEqual(topmost, { link: ids.link, block: null });
	await shot("e2e-10-nested-links");

	// a block's title can sit at the top
	const gap = await page.evaluate((id) => {
		const g = [...document.querySelectorAll(`.bd-block[data-id="${id}"]`)].find((n) => n.getClientRects().length);
		const shape = g.querySelector("rect, path, ellipse, polygon").getBoundingClientRect();
		const title = g.querySelector("tspan").getBoundingClientRect();
		return { above: title.top - shape.top, below: shape.bottom - title.bottom };
	}, ids.box);
	assert.ok(gap.above < 40 && gap.below > gap.above * 3, `title at the top (${JSON.stringify(gap)})`);

	// web fonts: nothing is requested, added or imported while the setting is off
	const fontState = () =>
		page.evaluate(() => {
			const p = window.app.plugins.plugins["block-draw"];
			return {
				on: p.settings.webFonts,
				faces: p.webFonts.count(document),
				link: !!document.querySelector('link[href*="fonts.googleapis.com"]'),
				imported: [...document.querySelectorAll("style")].some((st) => /fonts\.(googleapis|gstatic)\.com/.test(st.textContent)),
				montserrat: [...document.fonts].some((f) => f.family.replace(/["']/g, "") === "Montserrat"),
			};
		});
	assert.deepEqual(await fontState(), { on: false, faces: 0, link: false, imported: false, montserrat: false });
	assert.deepEqual(fontRequests, [], "no request to Google's font hosts so far");
	const note = () => page.locator(".workspace-leaf.mod-active .bd-props .bd-field-note").isVisible();
	const inBox = await toPage({ x: 150, y: 290 });
	await page.mouse.click(inBox.x, inBox.y);
	await frame();
	assert.equal(await note(), true, "the font picker explains that Inter is a web font while they are off");
	// the side panel: show/hide is a small eye in the label row, not a pair of wide buttons
	const eyeSel = ".workspace-leaf.mod-active .bd-props .bd-section[data-section='description'] .bd-visibility-btn";
	const eye = await page.locator(eyeSel).boundingBox();
	const label = await page.locator(".workspace-leaf.mod-active .bd-props .bd-section[data-section='description'] .bd-section-label").boundingBox();
	assert.ok(eye && eye.width <= 26 && eye.height <= 26, `the description toggle is a small icon button (${eye?.width}×${eye?.height})`);
	assert.ok(eye.y >= label.y - 6 && eye.y + eye.height <= label.y + label.height + 6 && eye.x > label.x + label.width, "in the label's row, to its right");
	// the color swatches wrap into even rows: the custom picker is not alone on the last row
	const swatchRows = await page.evaluate(() => {
		const panel = document.querySelector(".workspace-leaf.mod-active .bd-props");
		const sec = [...panel.querySelectorAll(".bd-section")].find((s) => s.querySelector(".bd-section-label")?.textContent === "Stroke");
		const counts = new Map();
		for (const e of sec.querySelectorAll(".bd-swatch, .bd-color-input")) {
			const top = Math.round(e.getBoundingClientRect().top);
			counts.set(top, (counts.get(top) ?? 0) + 1);
		}
		return [...counts.values()];
	});
	assert.deepEqual(swatchRows, [9], "the stroke colors and the picker fit one row");
	const shown = () => editorEval((ed, id) => ed.byId.get(id).descriptionOpen, ids.box);
	assert.equal(await shown(), true);
	await page.locator(eyeSel).click();
	await frame();
	assert.equal(await shown(), false, "the eye hides the description");
	assert.equal(await page.locator(eyeSel).getAttribute("aria-pressed"), "false");
	await page.locator(eyeSel).click();
	await frame();
	assert.equal(await shown(), true);

	// switching them on adds the fonts (through the FontFace API, no <link> or <style>) …
	await page.evaluate(async (css) => {
		const p = window.app.plugins.plugins["block-draw"];
		p.webFonts.fetchStylesheet = async () => css;
		p.settings.webFonts = true;
		await p.saveSettings();
	}, FONTS_CSS);
	await waitFor(async () => (await fontState()).faces === 7, "the web fonts to be added");
	assert.deepEqual({ ...(await fontState()), faces: 0 }, { on: true, faces: 0, link: false, imported: false, montserrat: true });
	await frame();
	assert.equal(await note(), false, "nothing to explain once they are on");
	// … and SVG exports then import them too
	const svgPath = state.fontsPath.replace(/\.blockdraw$/, ".svg");
	await command("block-draw:export-svg");
	await waitFor(async () => (await readFile(svgPath).catch(() => "")).includes("@import url('https://fonts.googleapis.com/css2?family=Inter"), "SVG with the font import");
	// switching them off removes them again
	await page.evaluate(async () => {
		const p = window.app.plugins.plugins["block-draw"];
		p.settings.webFonts = false;
		await p.saveSettings();
	});
	await waitFor(async () => {
		const f = await fontState();
		return f.faces === 0 && !f.montserrat;
	}, "the web fonts to be removed");
	await frame();
	assert.equal(await note(), true);
	await command("block-draw:export-svg");
	await waitFor(async () => !(await readFile(svgPath)).includes("googleapis"), "SVG without the font import");
	await shot("e2e-11-web-fonts-off");
});

test("a link can be bent by dragging it, and a block can be brought in front of a link", async () => {
	// in the drawing the previous test left open, away from what it drew
	const id = await editorEval((ed) => {
		const a = ed.makeBlock({ x: 700, y: 400, width: 140, height: 70 }, { title: "Left" });
		const c = ed.makeBlock({ x: 1100, y: 400, width: 140, height: 70 }, { title: "Right" });
		const onLink = ed.makeBlock({ x: 900, y: 405, width: 100, height: 60 }, { title: "On the link" });
		ed.insertBlocks([a, c, onLink]);
		const link = ed.connect(a.id, c.id);
		ed.updateElement(link.id, { routing: "straight" });
		ed.setSelection([link.id]);
		ed.zoomToFit({ animate: false });
		return { link: link.id, onLink: onLink.id };
	});
	await frame();
	const linkOf = async () => (await elements()).find((e) => e.id === id.link);

	// pull the grip in the middle of the link up: it becomes a bend where it is dropped
	await drag(await toPage({ x: 970, y: 435 }), await toPage({ x: 980, y: 340 }));
	await frame();
	assert.deepEqual((await linkOf()).waypoints, [{ x: 980, y: 340 }], "the bend is where it was dropped");
	const passes = await editorEval((ed, id) => ed.renderer.route(ed.byId.get(id)).route.points.some((p) => p.x === 980 && p.y === 340), id.link);
	assert.equal(passes, true, "the drawn link goes through the bend");
	await shot("e2e-12-bent-link");

	// it is saved in the file, and the bends come back when the file is read again
	const file = state.fontsPath;
	await waitFor(async () => (await readFile(file).catch(() => "")).includes('"waypoints":[{"x":980,"y":340}]'), "the bend in the saved file", 20000);

	// a block brought in front of the links leaves the layer of the others
	await editorEval((ed, id) => ed.setSelection([id]), id.onLink);
	await frame();
	await page.click('.bd-panel .bd-btn[aria-label="Bring to front"]:visible');
	await frame();
	assert.equal(await page.locator(`.bd-layer-blocks-front > [data-id="${id.onLink}"]`).count(), 1, "the block is drawn above the links");
	await waitFor(async () => (await readFile(file).catch(() => "")).includes('"inFront":true'), "inFront in the saved file", 20000);
	await page.click('.bd-panel .bd-btn[aria-label="Send to back"]:visible');
	await frame();
	assert.equal(await page.locator(`.bd-layer-blocks-front > [data-id="${id.onLink}"]`).count(), 0);

	// reset takes the bend out again
	await editorEval((ed, id) => ed.setSelection([id]), id.link);
	await frame();
	await page.click(".bd-panel .bd-reset-route:visible");
	await frame();
	assert.equal((await linkOf()).waypoints, undefined, "reset route takes the bends out");
});

test("the show/hide eyes stay readable on a dark theme, even with a dark accent color", async () => {
	await editorEval((ed) => {
		const b = ed.makeBlock({ x: 700, y: 700, width: 160, height: 80 }, { title: "Dark", description: "shown", comment: "hidden" });
		ed.insertBlocks([b]);
		ed.setSelection([b.id]);
	});
	await frame();
	const wasDark = await page.evaluate(() => document.body.classList.contains("theme-dark"));
	const eyes = () =>
		page.evaluate(() => {
			const px = (css, under) => {
				const c = document.createElement("canvas");
				c.width = c.height = 1;
				const g = c.getContext("2d");
				g.fillStyle = under;
				g.fillRect(0, 0, 1, 1);
				g.fillStyle = css;
				g.fillRect(0, 0, 1, 1);
				const d = g.getImageData(0, 0, 1, 1).data;
				return [d[0], d[1], d[2]];
			};
			const lum = (c) => {
				const [r, g, b] = c.map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
				return 0.2126 * r + 0.7152 * g + 0.0722 * b;
			};
			const panelEl = [...document.querySelectorAll(".bd-props")].find((e) => e.offsetParent !== null);
			const panel = px(getComputedStyle(panelEl).backgroundColor, "#000");
			return [...panelEl.querySelectorAll(".bd-visibility-btn")].map((b) => {
				const fg = px(getComputedStyle(b).color, `rgb(${panel.join(",")})`);
				const [hi, lo] = [lum(fg), lum(panel)].sort((x, y) => y - x);
				return { name: b.title, ratio: (hi + 0.05) / (lo + 0.05) };
			});
		});
	try {
		for (const [name, accent] of [["the default accent", null], ["a black accent", "#000000"], ["a navy accent", "#1a237e"]]) {
			await page.evaluate(
				(accent) => {
					document.body.classList.replace("theme-light", "theme-dark");
					document.body.classList.add("theme-dark");
					document.body.style.removeProperty("--interactive-accent");
					if (accent) document.body.style.setProperty("--interactive-accent", accent);
				},
				accent,
			);
			await sleep(300);
			await frame();
			const found = await eyes();
			assert.equal(found.length, 2, "the Description and Comment eyes are shown");
			for (const e of found) assert.ok(e.ratio >= 3, `dark theme with ${name}: “${e.name}” is ${e.ratio.toFixed(2)}:1 against the panel, below the 3:1 icons need`);
		}
		await shot("e2e-13-eyes-dark");
	} finally {
		await page.evaluate((wasDark) => {
			document.body.style.removeProperty("--interactive-accent");
			if (!wasDark) document.body.classList.replace("theme-dark", "theme-light");
		}, wasDark);
	}
});

test("code block embeds render a live preview", async () => {
	const linktext = state.path.replace(/\.blockdraw$/, ".blockdraw");
	await page.evaluate(async (lt) => {
		const f = await window.app.vault.create("Embed test.md", `# Embed\n\n\`\`\`blockdraw\nfile: ${lt}\nframe: Overview\n\`\`\`\n`);
		const leaf = window.app.workspace.getLeaf(false);
		await leaf.openFile(f, { state: { mode: "preview" } });
	}, linktext);
	await page.waitForSelector(".markdown-preview-view .bd-embed svg", { timeout: 10000 });
	const texts = await page.$$eval(".markdown-preview-view .bd-embed svg text tspan", (els) => els.map((e) => e.textContent));
	assert.ok(texts.includes("Start") && texts.includes("Finish"));
	assert.ok(!texts.includes("Detail"), "only the Overview frame is shown");
	await shot("e2e-07-embed");
});

test("files that cannot be parsed are shown as an error and left untouched", async () => {
	await page.evaluate(async () => {
		const f = await window.app.vault.create("Broken.blockdraw", "{ this is not json");
		await window.app.workspace.getLeaf(false).openFile(f);
	});
	await page.waitForSelector(".bd-load-error", { timeout: 10000 });
	await sleep(2600);
	assert.equal(await readFile("Broken.blockdraw"), "{ this is not json");
});

test("no errors were logged", async () => {
	assert.deepEqual(errors, []);
});

test("the plugin never asked Google's font hosts for anything itself", async () => {
	// the stylesheet was stubbed, so a request here would mean a font file that text really used
	const unexpected = fontRequests.filter((u) => !/ https:\/\/fonts\.gstatic\.com\/s\//.test(u));
	assert.deepEqual(unexpected, [], "only font files that text really used may be requested, never the stylesheet");
});

/* -------------------------------------------------------------- runner */

let failed = 0;
for (const t of tests) {
	const before = errors.length;
	currentTest = t.name;
	try {
		await t.fn();
		if (errors.length > before) print(`  !! new page errors during "${t.name}": ${JSON.stringify(errors.slice(before))}`);
		print(`  ✓ ${t.name}`);
	} catch (e) {
		failed++;
		print(`  ✗ ${t.name}\n    ${String(e?.stack ?? e).split("\n").slice(0, 40).join("\n    ")}`);
		if (SHOTS) await page.screenshot({ path: join(SHOTS, `e2e-FAILED-${t.name.replace(/[^a-z0-9]+/gi, "-")}.png`) }).catch(() => undefined);
	}
}
print(`\n${tests.length - failed}/${tests.length} Obsidian e2e tests passed`);
await browser.close().catch(() => undefined);
await bridge.close();
shutdown();
process.exit(failed ? 1 : 0);
