// End-to-end tests inside the real Obsidian desktop app.
//
//   npm run build
//   OBSIDIAN_BIN=/path/to/obsidian node tests/e2e/run-obsidian-e2e.mjs
//
// OBSIDIAN_BIN is the Obsidian executable (e.g. from `Obsidian-x.y.z.AppImage --appimage-extract`,
// squashfs-root/obsidian). Needs xvfb-run on Linux without a display. Set SHOTS=<dir> to keep
// screenshots and PLUGIN_DIR=<dir> to install main.js/manifest.json/styles.css from somewhere
// other than the repository root (e.g. files downloaded from a release). A fresh temporary vault
// and Obsidian profile are used; nothing else is touched.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
const bridge = await startMockBridge(root, SECRET);

const work = mkdtempSync(join(tmpdir(), "bd-e2e-"));
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

const args = [BIN, "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${PORT}`];
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
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}\n${e.stack}`));
page.on("console", (m) => {
	if (m.type() !== "error") return;
	const text = m.text();
	if (/net::|Failed to load resource|ERR_|obsidian\.md|sync/i.test(text)) return;
	errors.push(text);
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
	const json = JSON.parse(await readFile(`${base}.json`));
	assert.equal(json.format, "block-draw/export");
	assert.equal(json.frames[0].title, "Overview");
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
	await command("block-draw:export-google-sheets");
	const first = await waitFor(async () => JSON.parse(await readFile(state.path)).exports?.googleSheet, "export info saved in the drawing", 20000);
	assert.equal(bridge.svc.spreadsheets.size, 1);
	const titles = [...bridge.svc.spreadsheets.get(first.spreadsheetId).sheets].sort((a, b) => a.index - b.index).map((s) => s.title);
	assert.deepEqual(titles, ["Index", "Overview", "Frame 2", "Blocks", "Connections"]);
	assert.ok(bridge.log.includes("GET echo ok"), "followed the Apps Script redirect");
	await command("block-draw:export-google-sheets");
	await waitFor(
		async () => JSON.parse(await readFile(state.path)).exports?.googleSheet?.exportedAt !== first.exportedAt,
		"second export",
		20000,
	);
	assert.equal(bridge.svc.spreadsheets.size, 1, "re-export updated the same spreadsheet");
	await shot("e2e-05-after-gsheet");
});

test("settings tab renders and tests the bridge connection", async () => {
	await page.evaluate(() => {
		window.app.setting.open();
		window.app.setting.openTabById("block-draw");
	});
	// Obsidian 1.13 shows settings in a popout window; older versions use a modal.
	const headingsOf = (p) =>
		p.evaluate(() => [...document.querySelectorAll(".setting-item-heading .setting-item-name")].map((e) => e.textContent)).catch(() => []);
	const settingsPage = await waitFor(async () => {
		for (const p of page.context().pages()) if ((await headingsOf(p)).length) return p;
		return null;
	}, "settings window");
	assert.deepEqual(await headingsOf(settingsPage), ["Drawings", "Export", "Google Sheets"]);
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
	await page.evaluate(() => window.app.setting.close());
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

/* -------------------------------------------------------------- runner */

let failed = 0;
for (const t of tests) {
	const before = errors.length;
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
