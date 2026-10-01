// End-to-end UI tests for the editor, driven with real pointer/keyboard input in Chromium.
// Run: npm run test:ui   (set CHROMIUM_PATH if Chromium is not at /opt/pw-browsers/chromium,
// and SHOTS=<dir> to save screenshots).
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const url = "file://" + join(here, "dist", "index.html");
const SHOTS = process.env.SHOTS || null;
const print = (line) => process.stdout.write(`${line}\n`);
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

let page;
let errors = [];

async function fresh() {
	if (page) await page.close();
	page = await context.newPage();
	errors = [];
	page.on("console", (m) => {
		if (m.type() === "error") errors.push(m.text());
	});
	page.on("pageerror", (e) => errors.push(e.message));
	await page.goto(url);
	await page.waitForFunction(() => !!window.bd);
	await page.waitForTimeout(50);
}

const els = () => page.evaluate(() => window.bd.editor.getElements());
const sel = () => page.evaluate(() => [...window.bd.editor.selection]);
const frame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
/** Screen position of a world point. */
const toScreen = (p) => page.evaluate((p) => window.bd.editor.worldToScreen(p), p);
async function centerOf(id) {
	const el = await page.evaluate((id) => window.bd.editor.byId.get(id), id);
	return toScreen({ x: el.x + el.width / 2, y: el.y + el.height / 2 });
}
async function sideDot(id, side) {
	return page.evaluate(
		({ id, side }) => {
			const ed = window.bd.editor;
			const b = ed.byId.get(id);
			const off = 16 / ed.vp.zoom;
			const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
			const p =
				side === "right" ? { x: b.x + b.width + off, y: c.y } : side === "left" ? { x: b.x - off, y: c.y } : side === "top" ? { x: c.x, y: b.y - off } : { x: c.x, y: b.y + b.height + off };
			return ed.worldToScreen(p);
		},
		{ id, side },
	);
}
async function drag(from, to, opts = {}) {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	const steps = opts.steps ?? 8;
	for (let i = 1; i <= steps; i++) {
		await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
	}
	await page.mouse.up();
	await frame();
}
async function addBlock(x, y, title) {
	await page.mouse.dblclick(x, y);
	await frame();
	await page.keyboard.type(title);
	await page.keyboard.press("Enter");
	await frame();
	const list = await els();
	return list[list.length - 1];
}
async function shot(name) {
	if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

/* ------------------------------------------------------------------ tests */

test("shows the empty state and renders without errors", async () => {
	assert.equal(await page.isVisible(".bd-empty-hint"), true);
	assert.equal(await page.locator(".bd-toolbar .bd-btn").count() >= 10, true);
	await shot("00-empty");
});

test("double-click creates a block and typing sets its title", async () => {
	const b = await addBlock(400, 300, "Start");
	assert.equal(b.type, "block");
	assert.equal(b.title, "Start");
	assert.equal(b.x % 20, 0);
	assert.equal(await page.isVisible(".bd-empty-hint"), false);
	assert.equal(await page.evaluate(() => window.bd.changes > 0), true);
});

test("block tool drag creates a block of the dragged size", async () => {
	await page.keyboard.press("b");
	await drag({ x: 400, y: 500 }, { x: 600, y: 600 });
	await page.keyboard.press("Escape");
	const list = await els();
	assert.equal(list.length, 1);
	assert.equal(list[0].width, 200);
	assert.equal(list[0].height, 100);
	assert.equal(await page.evaluate(() => window.bd.editor.tool), "select");
});

test("long titles grow the block height", async () => {
	const b = await addBlock(400, 300, "A very long block title that certainly needs several lines to fit inside");
	assert.ok(b.height > 80, `height ${b.height}`);
});

test("dragging an edge dot onto another block connects them", async () => {
	const a = await addBlock(300, 300, "A");
	const b = await addBlock(700, 300, "B");
	await page.mouse.click(10, 790); // deselect
	await page.mouse.move((await centerOf(a.id)).x, (await centerOf(a.id)).y);
	await frame();
	const dot = await sideDot(a.id, "right");
	await drag(dot, await centerOf(b.id));
	const conns = (await els()).filter((e) => e.type === "connector");
	assert.equal(conns.length, 1);
	assert.equal(conns[0].from.id, a.id);
	assert.equal(conns[0].to.id, b.id);
	await shot("01-connected");
});

test("dropping a connection on empty space creates a connected block", async () => {
	const a = await addBlock(300, 300, "A");
	await page.mouse.click((await centerOf(a.id)).x, (await centerOf(a.id)).y);
	const dot = await sideDot(a.id, "bottom");
	await drag(dot, { x: 300, y: 560 });
	assert.equal(await page.evaluate(() => window.bd.editor.editingId !== null), true);
	await page.keyboard.type("Created");
	await page.keyboard.press("Enter");
	const list = await els();
	const blocks = list.filter((e) => e.type === "block");
	const conns = list.filter((e) => e.type === "connector");
	assert.equal(blocks.length, 2);
	assert.equal(blocks[1].title, "Created");
	assert.equal(conns.length, 1);
	assert.equal(conns[0].to.id, blocks[1].id);
});

test("clicking an edge dot adds a connected block in that direction", async () => {
	const a = await addBlock(300, 300, "A");
	await page.mouse.click((await centerOf(a.id)).x, (await centerOf(a.id)).y);
	await page.mouse.click(...Object.values(await sideDot(a.id, "right")));
	await page.keyboard.press("Escape");
	const blocks = (await els()).filter((e) => e.type === "block");
	assert.equal(blocks.length, 2);
	assert.ok(blocks[1].x > a.x + a.width, "new block is to the right");
	assert.equal(blocks[1].y, a.y);
});

test("moving snaps to the grid and undo/redo restore positions", async () => {
	const a = await addBlock(300, 300, "Move me");
	const c = await centerOf(a.id);
	await drag(c, { x: c.x + 113, y: c.y + 47 });
	const moved = (await els())[0];
	assert.equal(moved.x % 20, 0);
	assert.equal(moved.y % 20, 0);
	assert.notEqual(moved.x, a.x);
	await page.keyboard.press("Control+z");
	await frame();
	assert.equal((await els())[0].x, a.x);
	await page.keyboard.press("Control+Shift+z");
	await frame();
	assert.equal((await els())[0].x, moved.x);
});

test("marquee selects, Delete removes blocks with their connectors, undo restores", async () => {
	const a = await addBlock(300, 300, "A");
	const b = await addBlock(600, 300, "B");
	await page.evaluate(({ a, b }) => window.bd.editor.connect(a, b), { a: a.id, b: b.id });
	await page.mouse.click(10, 790);
	await drag({ x: 150, y: 150 }, { x: 900, y: 450 });
	assert.equal((await sel()).length, 3);
	await page.keyboard.press("Delete");
	assert.equal((await els()).length, 0);
	await page.keyboard.press("Control+z");
	await frame();
	assert.equal((await els()).length, 3);
});

test("frame tool adopts blocks inside; moving the frame carries them", async () => {
	const a = await addBlock(400, 300, "Inside");
	await addBlock(1100, 650, "Outside");
	await page.keyboard.press("f");
	await drag({ x: 300, y: 160 }, { x: 760, y: 520 });
	await page.keyboard.type("Overview");
	await page.keyboard.press("Enter");
	const list = await els();
	const f = list.find((e) => e.type === "frame");
	assert.equal(f.title, "Overview");
	const inside = list.find((e) => e.id === a.id);
	const outside = list.find((e) => e.title === "Outside");
	assert.equal(inside.frameId, f.id);
	assert.equal(outside.frameId, null);
	// drag by the title
	const titlePos = await toScreen({ x: f.x + 20, y: f.y - 12 });
	await drag(titlePos, { x: titlePos.x + 100, y: titlePos.y + 40 });
	const after = await els();
	const f2 = after.find((e) => e.id === f.id);
	const inside2 = after.find((e) => e.id === a.id);
	assert.equal(f2.x - f.x, 100);
	assert.equal(inside2.x - inside.x, 100);
	assert.equal(after.find((e) => e.title === "Outside").x, outside.x);
	await shot("02-frame");
});

test("dragging a block out of / into a frame updates membership", async () => {
	await page.evaluate(() => {
		const ed = window.bd.editor;
		ed.addFrame({ x: 400, y: 100, width: 400, height: 300 });
	});
	const fid = (await els())[0].id;
	const p = await toScreen({ x: 600, y: 250 });
	const b = await addBlock(p.x, p.y, "Member");
	assert.equal(b.frameId, fid);
	const c = await centerOf(b.id);
	const out = await toScreen({ x: 1000, y: 250 });
	await drag(c, out);
	assert.equal((await els()).find((e) => e.id === b.id).frameId, null);
	await drag(out, c);
	assert.equal((await els()).find((e) => e.id === b.id).frameId, fid);
});

test("blocks link to frames; following and going back moves the view", async () => {
	await page.evaluate(() => {
		const ed = window.bd.editor;
		ed.addFrame({ x: 0, y: 0, width: 500, height: 400 });
		ed.addFrame({ x: 1600, y: 900, width: 500, height: 400 });
		const [f1, f2] = ed.frames();
		ed.updateElement(f1.id, { title: "Login" });
		ed.updateElement(f2.id, { title: "Dashboard" });
		ed.insertBlocks([ed.makeBlock({ x: 100, y: 100, width: 160, height: 80 }, { title: "Sign in" })]);
		ed.zoomToBounds({ x: 0, y: 0, width: 500, height: 400 }, { animate: false });
	});
	const [f1, f2] = (await els()).filter((e) => e.type === "frame");
	const block = (await els()).find((e) => e.type === "block");
	assert.equal(block.frameId, f1.id);
	// select the block and pick the frame from the link dropdown
	await page.mouse.click((await centerOf(block.id)).x, (await centerOf(block.id)).y);
	await page.selectOption(".bd-props .bd-select", `frame:${f2.id}`);
	await frame();
	assert.equal((await els()).find((e) => e.id === block.id).link, `frame:${f2.id}`);
	assert.equal(await page.locator(".bd-link-badge").count(), 1);
	await shot("03-linked-block");
	// click the badge
	const badge = await toScreen({ x: block.x + block.width - 12, y: block.y + 12 });
	await page.mouse.click(badge.x, badge.y);
	await page.waitForTimeout(500);
	const center = await page.evaluate(() => {
		const ed = window.bd.editor;
		const s = ed.viewSize();
		return ed.screenToWorld({ x: s.width / 2, y: s.height / 2 });
	});
	assert.ok(Math.abs(center.x - (f2.x + f2.width / 2)) < 30, `x ${center.x}`);
	assert.equal(await page.isVisible(".bd-back-btn.is-visible"), true);
	await shot("04-followed-link");
	await page.click(".bd-back-btn");
	await page.waitForTimeout(500);
	const back = await page.evaluate(() => {
		const ed = window.bd.editor;
		const s = ed.viewSize();
		return ed.screenToWorld({ x: s.width / 2, y: s.height / 2 });
	});
	assert.ok(Math.abs(back.x - 250) < 30, `back x ${back.x}`);
	// Ctrl+click follows too
	const c = await centerOf(block.id);
	await page.keyboard.down("Control");
	await page.mouse.click(c.x, c.y);
	await page.keyboard.up("Control");
	await page.waitForTimeout(500);
	const again = await page.evaluate(() => window.bd.editor.navStack.length);
	assert.equal(again, 1);
});

test("note links go through the host picker and open via the host", async () => {
	const b = await addBlock(400, 300, "Spec");
	await page.evaluate(() => {
		window.bd.nextPick = "[[Specs/Login spec]]";
	});
	await page.selectOption(".bd-props .bd-select", "__pick__");
	await page.waitForTimeout(50);
	assert.equal((await els()).find((e) => e.id === b.id).link, "[[Specs/Login spec]]");
	const c = await centerOf(b.id);
	await page.keyboard.down("Control");
	await page.mouse.click(c.x, c.y);
	await page.keyboard.up("Control");
	const opened = await page.evaluate(() => window.bd.opened);
	assert.deepEqual(opened, [{ link: "[[Specs/Login spec]]", newLeaf: false }]);
	await page.keyboard.press("Control+k");
	await page.waitForTimeout(20);
	assert.equal(await page.evaluate(() => window.bd.pickCalls.length), 2);
});

test("double-clicking a connector edits its label", async () => {
	const a = await addBlock(300, 300, "Q?");
	const b = await addBlock(700, 300, "Yes path");
	await page.evaluate(({ a, b }) => window.bd.editor.connect(a, b), { a: a.id, b: b.id });
	await frame();
	const mid = await toScreen({ x: (a.x + a.width + b.x) / 2, y: a.y + a.height / 2 });
	await page.mouse.dblclick(mid.x, mid.y);
	await page.keyboard.type("yes");
	await page.keyboard.press("Enter");
	const conn = (await els()).find((e) => e.type === "connector");
	assert.equal(conn.label, "yes");
	assert.equal(await page.locator(".bd-connector-label").count(), 1);
});

test("properties panel changes shape and fill", async () => {
	const b = await addBlock(400, 300, "Styled");
	await page.click('.bd-props .bd-seg-btn[title="Decision"]');
	await page.click('.bd-props .bd-swatch[title="#ffc9c9"]');
	const after = (await els()).find((e) => e.id === b.id);
	assert.equal(after.shape, "diamond");
	assert.equal(after.style.fill, "#ffc9c9");
	// new blocks inherit the current style
	const c = await addBlock(800, 300, "Next");
	assert.equal(c.style.fill, "#ffc9c9");
});

test("resize handle changes the block size", async () => {
	const b = await addBlock(400, 300, "Resize");
	const se = await toScreen({ x: b.x + b.width + 4, y: b.y + b.height + 4 });
	await drag(se, { x: se.x + 80, y: se.y + 40 });
	const after = (await els()).find((e) => e.id === b.id);
	assert.equal(after.width, b.width + 80);
	assert.equal(after.height, b.height + 40);
});

test("copy/paste and duplicate create offset copies", async () => {
	const b = await addBlock(400, 300, "Copy me");
	await page.keyboard.press("Control+c");
	await page.keyboard.press("Control+v");
	await frame();
	let blocks = (await els()).filter((e) => e.type === "block");
	assert.equal(blocks.length, 2);
	assert.equal(blocks[1].title, "Copy me");
	assert.equal(blocks[1].x, b.x + 20);
	await page.keyboard.press("Control+d");
	blocks = (await els()).filter((e) => e.type === "block");
	assert.equal(blocks.length, 3);
});

test("alt+drag duplicates", async () => {
	const b = await addBlock(400, 300, "Alt");
	const c = await centerOf(b.id);
	await page.keyboard.down("Alt");
	await drag(c, { x: c.x + 200, y: c.y });
	await page.keyboard.up("Alt");
	const blocks = (await els()).filter((e) => e.type === "block");
	assert.equal(blocks.length, 2);
	assert.equal(blocks[0].x, b.x);
	assert.equal(blocks[1].x, b.x + 200);
});

test("context menu offers block actions", async () => {
	const b = await addBlock(400, 300, "Menu");
	const c = await centerOf(b.id);
	await page.mouse.click(c.x, c.y, { button: "right" });
	const menus = await page.evaluate(() => window.bd.menus);
	const titles = menus[menus.length - 1];
	assert.ok(titles.includes("Link to frame or note…"));
	assert.ok(titles.includes("Duplicate"));
	assert.ok(titles.includes("Delete"));
	await page.evaluate(() => window.bd.clickMenu("Duplicate"));
	assert.equal((await els()).filter((e) => e.type === "block").length, 2);
});

test("re-attaching a connector end to another block", async () => {
	const a = await addBlock(300, 250, "A");
	const b = await addBlock(700, 250, "B");
	const c = await addBlock(700, 550, "C");
	await page.evaluate(({ a, b }) => window.bd.editor.connect(a, b, { select: true }), { a: a.id, b: b.id });
	await frame();
	const end = await page.evaluate(() => {
		const ed = window.bd.editor;
		const conn = ed.selectedConnectors()[0];
		return ed.worldToScreen(ed.renderer.route(conn).route.end);
	});
	await drag(end, await centerOf(c.id));
	const conn = (await els()).find((e) => e.type === "connector");
	assert.equal(conn.to.id, c.id);
});

test("wheel zooms with ctrl and pans without", async () => {
	await addBlock(400, 300, "Zoom");
	const z0 = await page.evaluate(() => window.bd.editor.vp.zoom);
	await page.mouse.move(400, 300);
	await page.keyboard.down("Control");
	await page.mouse.wheel(0, -200);
	await page.keyboard.up("Control");
	await frame();
	const z1 = await page.evaluate(() => window.bd.editor.vp.zoom);
	assert.ok(z1 > z0);
	const x0 = await page.evaluate(() => window.bd.editor.vp.x);
	await page.mouse.wheel(120, 0);
	await frame();
	assert.equal(await page.evaluate(() => window.bd.editor.vp.x), x0 - 120);
	await page.keyboard.press("Shift+Digit1");
	await page.waitForTimeout(450);
});

test("frames panel lists frames and navigates", async () => {
	await page.evaluate(() => {
		const ed = window.bd.editor;
		ed.addFrame({ x: 0, y: 0, width: 400, height: 300 });
		ed.addFrame({ x: 2000, y: 0, width: 400, height: 300 });
	});
	await page.click('.bd-toolbar .bd-btn[aria-label="Frames"]');
	await frame();
	assert.equal(await page.locator(".bd-frame-item").count(), 2);
	await page.click(".bd-frame-item >> nth=1");
	await page.waitForTimeout(450);
	const center = await page.evaluate(() => {
		const ed = window.bd.editor;
		const s = ed.viewSize();
		return ed.screenToWorld({ x: s.width / 2, y: s.height / 2 });
	});
	assert.ok(Math.abs(center.x - 2200) < 30);
	await shot("05-frames-panel");
	// reorder: move second up
	await page.hover(".bd-frame-item >> nth=1");
	await page.click('.bd-frame-item >> nth=1 >> .bd-btn[aria-label="Move up"]');
	await frame();
	const order = (await els()).filter((e) => e.type === "frame").map((f) => f.x);
	assert.deepEqual(order, [2000, 0]);
});

test("arrow keys nudge, Escape clears the selection", async () => {
	const b = await addBlock(400, 300, "Nudge");
	await page.keyboard.press("ArrowRight");
	await page.keyboard.press("Shift+ArrowDown");
	const after = (await els())[0];
	assert.equal(after.x, b.x + 20);
	assert.equal(after.y, b.y + 100);
	await page.keyboard.press("Escape");
	assert.equal((await sel()).length, 0);
});

test("serialization round-trips the drawing", async () => {
	const a = await addBlock(300, 300, "A");
	const b = await addBlock(700, 300, "B");
	await page.evaluate(({ a, b }) => window.bd.editor.connect(a, b), { a: a.id, b: b.id });
	const text = await page.evaluate(() => window.bd.serialize());
	const before = await els();
	await page.evaluate((t) => window.bd.load(t), text);
	assert.deepEqual(await els(), before);
	const json = await page.evaluate(() => window.bd.structuredJson());
	assert.equal(json.stats.blocks, 2);
	assert.equal(json.unframed.connections.length, 1);
	const svg = await page.evaluate(() => window.bd.svg());
	assert.ok(svg.startsWith("<svg"));
	assert.ok(svg.includes(">A<") && svg.includes(">B<"));
});

test("composed diagram screenshot (light and dark)", async () => {
	await page.evaluate(() => {
		const ed = window.bd.editor;
		const f1 = ed.addFrame({ x: 0, y: 0, width: 760, height: 420 });
		const f2 = ed.addFrame({ x: 860, y: 0, width: 520, height: 420 });
		ed.updateElement(f1.id, { title: "Checkout flow" });
		ed.updateElement(f2.id, { title: "Payment details" });
		const mk = (x, y, title, extra = {}) => ed.makeBlock({ x, y, width: 160, height: 80 }, { title, ...extra });
		const cart = mk(40, 60, "Cart");
		const check = mk(300, 60, "Logged in?", { shape: "diamond", style: { ...ed.current.block, fill: "#ffec99" } });
		const login = mk(300, 260, "Sign in", { style: { ...ed.current.block, fill: "#ffc9c9" } });
		const pay = mk(560, 60, "Payment", { link: `frame:${f2.id}`, description: "Card, wallet or invoice" });
		const card = mk(900, 60, "Card form", { style: { ...ed.current.block, fill: "#b2f2bb" } });
		const db = mk(1160, 260, "Orders DB", { shape: "cylinder", style: { ...ed.current.block, fill: "#d0bfff" } });
		const done = mk(900, 260, "Confirmation", { shape: "ellipse" });
		ed.insertBlocks([cart, check, login, pay, card, db, done]);
		ed.connect(cart.id, check.id);
		const yes = ed.connect(check.id, pay.id);
		const no = ed.connect(check.id, login.id);
		ed.updateElement(yes.id, { label: "yes" });
		ed.updateElement(no.id, { label: "no" });
		ed.connect(login.id, pay.id);
		ed.connect(card.id, done.id);
		const save = ed.connect(done.id, db.id);
		ed.updateElement(save.id, { routing: "curved", style: { ...ed.current.connector, strokeStyle: "dashed" } });
		ed.clearSelection();
		ed.zoomToFit({ animate: false });
	});
	await frame();
	assert.equal(errors.length, 0, errors.join("\n"));
	await shot("06-composed-light");
	await page.evaluate(() => document.body.classList.add("theme-dark"));
	await frame();
	await shot("07-composed-dark");
	await page.evaluate(() => document.body.classList.remove("theme-dark"));
	const json = await page.evaluate(() => window.bd.structuredJson());
	assert.equal(json.frames.length, 2);
	assert.equal(json.frames[0].linksTo[0].title, "Payment details");
	assert.equal(json.frames[1].linkedFrom[0].title, "Checkout flow");
});

test("double-tap on a touch screen adds a block", async () => {
	const touch = await browser.newContext({ viewport: { width: 900, height: 700 }, hasTouch: true, isMobile: true });
	const tp = await touch.newPage();
	try {
		await tp.goto(url);
		await tp.waitForFunction(() => !!window.bd);
		await tp.touchscreen.tap(450, 350);
		await tp.waitForTimeout(80);
		await tp.touchscreen.tap(452, 351);
		await tp.waitForTimeout(150);
		const n = await tp.evaluate(() => window.bd.editor.getElements().length);
		assert.equal(n, 1, "one block, not two (native dblclick must not double up)");
		assert.equal(await tp.evaluate(() => window.bd.editor.editingId !== null), true);
	} finally {
		await touch.close();
	}
});

/* ------------------------------------------------------------------ runner */

let failed = 0;
for (const t of tests) {
	await fresh();
	try {
		await t.fn();
		assert.deepEqual(errors, [], "console errors");
		print(`  ✓ ${t.name}`);
	} catch (e) {
		failed++;
		print(`  ✗ ${t.name}\n    ${String(e && e.stack ? e.stack : e).split("\n").slice(0, 6).join("\n    ")}`);
		if (SHOTS) await page.screenshot({ path: join(SHOTS, `FAILED-${t.name.replace(/[^a-z0-9]+/gi, "-")}.png`) });
	}
}
await browser.close();
print(`\n${tests.length - failed}/${tests.length} UI tests passed`);
process.exit(failed ? 1 : 0);
