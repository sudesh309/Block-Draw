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

/** Every request to a web address is refused and recorded: the editor must work entirely offline. */
const external = [];
async function offline(ctx) {
	await ctx.route(/^https?:/, (route) => {
		external.push(route.request().url());
		return route.abort();
	});
	return ctx;
}

const context = await offline(await browser.newContext({ viewport: { width: 1280, height: 800 } }));

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

test("block comments: panel toggle and clicking the canvas badge", async () => {
	const a = await addBlock(400, 300, "Checkout");
	assert.equal(await page.locator(".bd-comment-badge").count(), 0);
	await page.evaluate((id) => window.bd.editor.updateElement(id, { comment: "Ask about discount codes" }), a.id);
	await frame();
	assert.equal(await page.locator(".bd-comment-badge").count(), 1);
	assert.equal(await page.locator(".bd-comment-callout").count(), 0);
	// the eye in the Comment label row drives commentOpen
	await page.click('.bd-props .bd-visibility-btn[title="Show comment on the canvas"]');
	await frame();
	assert.equal((await els()).find((e) => e.id === a.id).commentOpen, true);
	assert.equal(await page.locator(".bd-comment-callout").count(), 1);
	assert.equal(await page.locator(".bd-comment-badge.is-open").count(), 1);
	await shot("05-comment-open");
	// clicking the badge on the canvas toggles it back off
	const b = (await els()).find((e) => e.id === a.id);
	const badge = await toScreen({ x: b.x + b.width - 12, y: b.y + b.height - 12 });
	await page.mouse.click(badge.x, badge.y);
	await frame();
	assert.equal((await els()).find((e) => e.id === a.id).commentOpen, false);
	assert.equal(await page.locator(".bd-comment-callout").count(), 0);
	// the badge is still there (the comment itself was not removed), just collapsed
	assert.equal(await page.locator(".bd-comment-badge").count(), 1);
});

test("connector comments: badge near the label and the context menu", async () => {
	const a = await addBlock(300, 300, "Start");
	const b = await addBlock(700, 300, "Finish");
	const conn = await page.evaluate(({ a, b }) => window.bd.editor.connect(a, b, { select: true }), { a: a.id, b: b.id });
	await page.evaluate((id) => window.bd.editor.updateElement(id, { comment: "Double-check timeout handling" }), conn.id);
	await frame();
	assert.equal(await page.locator(".bd-comment-badge").count(), 1);
	const mid = await toScreen({ x: (a.x + a.width + b.x) / 2, y: a.y + a.height / 2 });
	await page.mouse.click(mid.x, mid.y, { button: "right" });
	const menus = await page.evaluate(() => window.bd.menus);
	const titles = menus[menus.length - 1];
	assert.ok(titles.includes("Show comment"));
	assert.ok(titles.includes("Remove comment"));
	await page.evaluate(() => window.bd.clickMenu("Show comment"));
	await frame();
	assert.equal((await els()).find((e) => e.type === "connector").commentOpen, true);
	assert.equal(await page.locator(".bd-comment-callout").count(), 1);
	// "Remove comment" clears it and the badge disappears entirely
	await page.mouse.click(mid.x, mid.y, { button: "right" });
	await page.evaluate(() => window.bd.clickMenu("Remove comment"));
	await frame();
	const after = (await els()).find((e) => e.type === "connector");
	assert.equal(after.comment, "");
	assert.equal(after.commentOpen, false);
	assert.equal(await page.locator(".bd-comment-badge").count(), 0);
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

/** The ids of the drawn blocks in stacking order, bottom first, as the SVG has them. */
const blockStack = () => page.evaluate(() => [...document.querySelectorAll(".bd-layer-blocks > .bd-block, .bd-layer-blocks-front > .bd-block")].map((n) => n.getAttribute("data-id")));

test("bring to front and send to back work from the panel, the menu and the keyboard", async () => {
	const a = await addBlock(300, 300, "A");
	const b = await addBlock(400, 330, "B");
	const c = await addBlock(500, 360, "C");
	const ids = [a.id, b.id, c.id];
	assert.deepEqual(await blockStack(), ids);
	const select = async (id) => {
		await page.evaluate((id) => window.bd.editor.setSelection([id]), id);
		await frame();
	};

	await select(a.id);
	await page.click('.bd-panel .bd-btn[aria-label="Bring to front"]');
	await frame();
	assert.deepEqual(await blockStack(), [b.id, c.id, a.id], "panel: bring to front");
	await page.click('.bd-panel .bd-btn[aria-label="Send to back"]');
	await frame();
	assert.deepEqual(await blockStack(), ids, "panel: send to back");

	await select(b.id);
	await page.keyboard.press("Control+Shift+BracketRight");
	await frame();
	assert.deepEqual(await blockStack(), [a.id, c.id, b.id], "keyboard: bring to front");
	await page.keyboard.press("Control+Shift+BracketLeft");
	await frame();
	assert.deepEqual(await blockStack(), [b.id, a.id, c.id], "keyboard: send to back");
	await page.keyboard.press("Control+BracketRight");
	await frame();
	assert.deepEqual(await blockStack(), [a.id, b.id, c.id], "keyboard: bring forward");
	await page.keyboard.press("Control+BracketLeft");
	await frame();
	assert.deepEqual(await blockStack(), [b.id, a.id, c.id], "keyboard: send backward");

	// the right-click menu, on the block that is now on top of the others
	await select(c.id);
	const at = await centerOf(c.id);
	await page.mouse.click(at.x, at.y, { button: "right" });
	await frame();
	await page.locator(".harness-menu-item", { hasText: "Send to back" }).click();
	await frame();
	assert.deepEqual(await blockStack(), [c.id, b.id, a.id], "menu: send to back");
});

test("a block can be brought in front of a link, and a link sent behind a block", async () => {
	const id = await page.evaluate(() => {
		const ed = window.bd.editor;
		const a = ed.makeBlock({ x: 100, y: 100, width: 160, height: 80 }, { title: "A" });
		const c = ed.makeBlock({ x: 600, y: 100, width: 160, height: 80 }, { title: "C" });
		// a small block that sits on the straight link between the two
		const onLink = ed.makeBlock({ x: 350, y: 110, width: 160, height: 60 }, { title: "On the link" });
		ed.insertBlocks([a, c, onLink]);
		const link = ed.connect(a.id, c.id);
		ed.updateElement(link.id, { routing: "straight" });
		ed.clearSelection();
		ed.zoomToFit({ animate: false });
		return { onLink: onLink.id, link: link.id };
	});
	await frame();
	const onLinkPoint = { x: 430, y: 140 };
	const hit = () => page.evaluate((p) => window.bd.editor.hitTest(p), onLinkPoint);
	/** The element drawn on top at that point, as the browser sees it. */
	const drawnTop = async () => {
		const at = await toScreen(onLinkPoint);
		return page.evaluate(({ x, y }) => {
			const rect = document.querySelector(".bd-canvas, svg")?.getBoundingClientRect();
			const el = document.elementsFromPoint(x + (rect?.left ?? 0), y + (rect?.top ?? 0)).find((e) => e.closest(".bd-block, .bd-connector"));
			return el?.closest(".bd-block, .bd-connector")?.getAttribute("data-id") ?? null;
		}, at);
	};
	const panel = (label) => page.click(`.bd-panel .bd-btn[aria-label="${label}"]`);

	assert.deepEqual([(await hit()).kind, await drawnTop()], ["connector", id.link], "a link is above the blocks to begin with");

	await page.evaluate((id) => window.bd.editor.setSelection([id]), id.onLink);
	await frame();
	await panel("Bring to front");
	await frame();
	assert.equal(await page.locator(`.bd-layer-blocks-front > [data-id="${id.onLink}"]`).count(), 1, "the block moved to the layer above the links");
	assert.deepEqual([(await hit()).kind, (await hit()).id, await drawnTop()], ["block", id.onLink, id.onLink], "the block now covers the link and takes its clicks");

	await panel("Send to back");
	await frame();
	assert.equal(await page.locator(`.bd-layer-blocks-front > [data-id="${id.onLink}"]`).count(), 0);
	assert.deepEqual([(await hit()).kind, await drawnTop()], ["connector", id.link], "sent back: the link is on top again");

	await page.evaluate((id) => window.bd.editor.setSelection([id]), id.link);
	await frame();
	await panel("Send to back");
	await frame();
	assert.equal(await page.locator(`.bd-layer-connectors-behind > [data-id="${id.link}"]`).count(), 1, "the link moved below the blocks");
	// (a selected link shows a grip in its middle, drawn above everything: look at it unselected)
	await page.evaluate(() => window.bd.editor.clearSelection());
	await frame();
	assert.deepEqual([(await hit()).kind, await drawnTop()], ["block", id.onLink], "a link sent behind is covered by the block");
	// where nothing covers it, the link can still be clicked
	const free = await page.evaluate((p) => window.bd.editor.hitTest(p), { x: 300, y: 140 });
	assert.deepEqual([free.kind, free.id], ["connector", id.link]);
	await page.evaluate((id) => window.bd.editor.setSelection([id]), id.link);
	await frame();
	await panel("Bring to front");
	await frame();
	assert.equal(await page.locator(`.bd-layer-connectors > [data-id="${id.link}"]`).count(), 1, "bring to front puts the link back above the blocks");
	await shot("z-order-link-and-block");
});

test("a link can be bent by dragging it, and its bends move, copy, reset and undo with it", async () => {
	const id = await page.evaluate(() => {
		const ed = window.bd.editor;
		const a = ed.makeBlock({ x: 100, y: 200, width: 160, height: 80 }, { title: "A" });
		const c = ed.makeBlock({ x: 600, y: 200, width: 160, height: 80 }, { title: "C" });
		ed.insertBlocks([a, c]);
		const link = ed.connect(a.id, c.id);
		ed.zoomToFit({ animate: false });
		ed.setSelection([link.id]);
		return { a: a.id, c: c.id, link: link.id };
	});
	await frame();
	const bends = async (linkId = id.link) => (await els()).find((e) => e.id === linkId).waypoints ?? null;
	const drag = async (from, to) => {
		const [a, b] = [await toScreen(from), await toScreen(to)];
		await page.mouse.move(a.x, a.y);
		await page.mouse.down();
		await page.mouse.move(b.x, b.y, { steps: 6 });
		await page.mouse.up();
		await frame();
	};
	/** Whether the drawn route has a corner or end at the point. */
	const routePasses = (p, linkId = id.link) =>
		page.evaluate(
			({ p, linkId }) => {
				const ed = window.bd.editor;
				return ed.renderer.route(ed.byId.get(linkId)).route.points.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-6);
			},
			{ p, linkId },
		);

	assert.equal(await bends(), null, "a new link has no bends of its own");
	// the grip in the middle of the straight link (430, 240) pulled up makes a first bend
	await drag({ x: 430, y: 240 }, { x: 440, y: 120 });
	assert.deepEqual(await bends(), [{ x: 440, y: 120 }], "the bend is where it was dropped (on the grid)");
	assert.equal(await routePasses({ x: 440, y: 120 }), true, "the link goes through the bend");
	assert.deepEqual(await sel(), [id.link], "the link stays selected");
	await shot("link-bent");

	// the handle moves it; grabbing a handle never adds a second bend
	await drag({ x: 440, y: 120 }, { x: 440, y: 60 });
	assert.deepEqual(await bends(), [{ x: 440, y: 60 }]);
	await page.keyboard.press("Control+z");
	await frame();
	assert.deepEqual(await bends(), [{ x: 440, y: 120 }], "moving a bend is one undo step");
	await page.keyboard.press("Control+z");
	await frame();
	assert.equal(await bends(), null, "and adding it was another");
	await page.keyboard.press("Control+Shift+z");
	await frame();
	assert.deepEqual(await bends(), [{ x: 440, y: 120 }]);

	// a second bend goes between the first and the end, in route order
	await page.evaluate((id) => window.bd.editor.setSelection([id]), id.link);
	await frame();
	await drag({ x: 600, y: 120 }, { x: 600, y: 120 }); // a click on empty space deselects ...
	await page.evaluate((id) => window.bd.editor.setSelection([id]), id.link);
	await frame();
	const second = await page.evaluate((id) => {
		const ed = window.bd.editor;
		const pts = ed.renderer.route(ed.byId.get(id)).route.points;
		// the middle of the last long stretch, which comes after the first bend
		let best = null;
		for (let i = 1; i < pts.length; i++) {
			const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
			if (len > 60 && (!best || i > best.i)) best = { i, p: { x: (pts[i].x + pts[i - 1].x) / 2, y: (pts[i].y + pts[i - 1].y) / 2 } };
		}
		return best.p;
	}, id.link);
	await drag(second, { x: 540, y: 340 });
	const two = await bends();
	assert.equal(two.length, 2);
	assert.deepEqual(two[0], { x: 440, y: 120 }, "the first bend is still first");
	assert.deepEqual(two[1], { x: 540, y: 340 });

	// double-click removes a bend
	const at = await toScreen({ x: 440, y: 120 });
	await page.mouse.dblclick(at.x, at.y);
	await frame();
	assert.deepEqual(await bends(), [{ x: 540, y: 340 }], "double-clicking a bend removes it");
	assert.equal(await page.locator(".bd-textedit, textarea.bd-inline-edit").count(), 0, "and does not start editing the label");

	// bends travel with the blocks, whether they are moved or copied
	await page.keyboard.press("Control+a");
	await page.keyboard.press("ArrowRight");
	await frame();
	assert.deepEqual(await bends(), [{ x: 560, y: 340 }], "nudging the blocks moves the bends with them");
	await page.keyboard.press("Control+d");
	await frame();
	const links = (await els()).filter((e) => e.type === "connector");
	assert.equal(links.length, 2);
	const copy = links.find((l) => l.id !== id.link);
	const [orig, dup] = [await page.evaluate((i) => window.bd.editor.byId.get(i), id.a), null];
	const copyFrom = await page.evaluate((i) => window.bd.editor.byId.get(i), copy.from.id);
	assert.deepEqual(
		[copy.waypoints[0].x - copyFrom.x, copy.waypoints[0].y - copyFrom.y],
		[560 - orig.x, 340 - orig.y],
		"a copy keeps its bends in the same place relative to its blocks",
	);
	assert.equal(dup, null);

	// reset: from the panel, and from the context menu
	await page.evaluate((id) => window.bd.editor.setSelection([id]), id.link);
	await frame();
	await page.click(".bd-panel .bd-reset-route");
	await frame();
	assert.equal(await bends(), null, "reset route takes the bends out");
	await page.keyboard.press("Control+z");
	await frame();
	assert.equal((await bends()).length, 1, "and is one undo step");
	const where = await toScreen({ x: 560, y: 340 });
	await page.mouse.click(where.x + 40, where.y - 40, { button: "right" }).catch(() => undefined);
	await page.evaluate((id) => window.bd.editor.setSelection([id]), id.link);
	await frame();
	const mid = await page.evaluate((id) => {
		const ed = window.bd.editor;
		const r = ed.renderer.route(ed.byId.get(id)).route;
		return r.points[Math.floor(r.points.length / 2)];
	}, id.link);
	const ms = await toScreen(mid);
	await page.mouse.click(ms.x, ms.y, { button: "right" });
	await frame();
	await page.locator(".harness-menu-item", { hasText: "Reset route" }).click();
	await frame();
	assert.equal(await bends(), null, "the context menu resets the route too");
	assert.deepEqual(errors, []);
});

test("icons and active controls stay readable on dark themes, whatever the accent color", async () => {
	await page.evaluate(() => {
		const ed = window.bd.editor;
		const b = ed.makeBlock({ x: 100, y: 100, width: 160, height: 80 }, { title: "A", description: "d", comment: "c" });
		ed.insertBlocks([b]);
		ed.setSelection([b.id]);
	});
	await frame();
	/** The colors a control really shows: its text over its own background over the panel's. */
	const shown = (selector) =>
		page.evaluate((selector) => {
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
			const rgb = (a) => `rgb(${a.join(",")})`;
			const panel = px(getComputedStyle(document.querySelector(".bd-props")).backgroundColor, "#000");
			return [...document.querySelectorAll(selector)]
				.filter((e) => e.offsetParent !== null)
				.map((e) => {
					const cs = getComputedStyle(e);
					const bg = px(cs.backgroundColor, rgb(panel));
					return { name: e.title || e.textContent, bg, fg: px(cs.color, rgb(bg)) };
				});
		}, selector);
	const lum = (c) => {
		const [r, g, b] = c.map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
		return 0.2126 * r + 0.7152 * g + 0.0722 * b;
	};
	const contrast = (a, b) => {
		const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
		return (hi + 0.05) / (lo + 0.05);
	};
	const themes = [
		["light", false, {}],
		["dark", true, {}],
		["dark with a black accent", true, { "--interactive-accent": "#000000" }],
		["dark with a navy accent", true, { "--interactive-accent": "#1a237e" }],
		["dark, black panel, dull text", true, { "--background-primary": "#000000", "--text-muted": "#4a4a4a", "--interactive-accent": "#2b2b2b" }],
	];
	try {
		for (const [name, dark, vars] of themes) {
			await page.evaluate(
				([dark, vars]) => {
					document.body.classList.toggle("theme-dark", dark);
					document.body.removeAttribute("style");
					for (const [k, v] of Object.entries(vars)) document.body.style.setProperty(k, v);
				},
				[dark, vars],
			);
			await frame();
			const controls = [
				...(await shown(".bd-visibility-btn")),
				...(await shown(".bd-btn.is-active")),
				...(await shown(".bd-seg-btn.is-active")),
			];
			assert.ok(controls.length >= 4, `${name}: the eyes and the active controls are on screen`);
			for (const c of controls) {
				assert.ok(contrast(c.fg, c.bg) >= 3, `${name}: “${c.name}” is ${contrast(c.fg, c.bg).toFixed(2)}:1 against its background, below the 3:1 icons need`);
			}
		}
	} finally {
		await page.evaluate(() => {
			document.body.classList.remove("theme-dark");
			document.body.removeAttribute("style");
		});
	}
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

/** Three connected blocks A → B → C, an isolated D, and two frames. */
async function sampleChain() {
	return page.evaluate(() => {
		const ed = window.bd.editor;
		const f1 = ed.addFrame({ x: 0, y: 0, width: 640, height: 300 });
		const f2 = ed.addFrame({ x: 740, y: 0, width: 420, height: 300 });
		ed.updateElement(f1.id, { title: "Front end" });
		ed.updateElement(f2.id, { title: "Back end" });
		const mk = (x, y, title, fill) => ed.makeBlock({ x, y, width: 160, height: 80 }, { title, style: { ...ed.current.block, fill } });
		const a = mk(40, 100, "Web app", "#a5d8ff");
		const b = mk(320, 100, "API gateway", "#b2f2bb");
		const c = mk(780, 100, "Orders service", "#b2f2bb");
		const d = mk(780, 200, "Audit log", "#ffec99");
		ed.insertBlocks([a, b, c, d]);
		ed.connect(a.id, b.id);
		ed.connect(b.id, c.id);
		ed.clearSelection();
		ed.zoomToFit({ animate: false });
		return { a: a.id, b: b.id, c: c.id, d: d.id, f1: f1.id, f2: f2.id };
	});
}

const classesOf = (id) => page.evaluate((id) => document.querySelector(`.bd-block[data-id="${id}"]`)?.getAttribute("class") ?? "", id);

test("3D effect: panel toggle raises blocks and links, and context menu toggles it back", async () => {
	const ids = await sampleChain();
	const c = await centerOf(ids.b);
	await page.mouse.click(c.x, c.y);
	await page.click('.bd-props .bd-seg-btn[title="Raised 3D tile"]');
	await frame();
	let b = (await els()).find((e) => e.id === ids.b);
	assert.equal(b.style.threeD, true);
	assert.match(await classesOf(ids.b), /bd-3d/);
	// extrusion paths plus a gradient face
	const parts = await page.evaluate((id) => document.querySelectorAll(`.bd-block[data-id="${id}"] > path`).length, ids.b);
	assert.ok(parts > 5, `expected extrusion paths, got ${parts}`);
	assert.equal(await page.evaluate((id) => !!document.querySelector(`.bd-block[data-id="${id}"] linearGradient`), ids.b), true);
	await page.mouse.click(c.x, c.y, { button: "right" });
	await page.evaluate(() => window.bd.clickMenu("3D effect"));
	b = (await els()).find((e) => e.id === ids.b);
	assert.equal(b.style.threeD, false);
	// connectors: select one and raise it
	const conn = (await els()).find((e) => e.type === "connector");
	await page.evaluate((id) => window.bd.editor.setSelection([id]), conn.id);
	await frame();
	await page.click('.bd-props .bd-seg-btn[title="Raised 3D line with shadow"]');
	await page.click('.bd-props .bd-seg-btn[title="Animated flow along the arrowheads (both ways when there are two)"]');
	await frame();
	const after = (await els()).find((e) => e.id === conn.id);
	assert.equal(after.style.threeD, true);
	assert.equal(after.style.flow, true);
	const cls = await page.evaluate((id) => document.querySelector(`.bd-connector[data-id="${id}"]`)?.getAttribute("class"), conn.id);
	assert.match(cls, /bd-flow/);
	assert.match(cls, /bd-3d/);
	assert.equal(await page.locator(`.bd-connector[data-id="${conn.id}"] .bd-connector-shadow`).count(), 1);
});

test("themes restyle the drawing in one undoable step; palettes switch the swatches", async () => {
	const ids = await sampleChain();
	await page.mouse.click(640, 760, { button: "right" });
	await page.evaluate(() => window.bd.clickMenu("Theme: Futuristic"));
	await frame();
	let all = await els();
	const blocks = all.filter((e) => e.type === "block");
	assert.ok(blocks.every((b) => b.style.threeD));
	const byId = Object.fromEntries(blocks.map((b) => [b.id, b]));
	// blocks that shared a fill still share one, and differ from the other groups
	assert.equal(byId[ids.b].style.fill, byId[ids.c].style.fill);
	assert.notEqual(byId[ids.a].style.fill, byId[ids.b].style.fill);
	const conn = all.find((e) => e.type === "connector" && e.from.id === ids.a);
	assert.equal(conn.style.stroke, byId[ids.a].style.stroke, "futuristic links take their source block's neon");
	assert.equal(all.find((e) => e.id === ids.f1).style.fill, "#0f172a");
	await page.keyboard.press("Control+z");
	all = await els();
	assert.equal(all.find((e) => e.id === ids.a).style.fill, "#a5d8ff");
	assert.equal(all.find((e) => e.id === ids.a).style.threeD, false);
	// quick theme on the selection only
	await page.evaluate((id) => window.bd.editor.setSelection([id]), ids.d);
	await frame();
	await page.click('.bd-props .bd-theme-btn[data-theme="executive"]');
	all = await els();
	assert.equal(all.find((e) => e.id === ids.d).style.threeD, true);
	assert.equal(all.find((e) => e.id === ids.a).style.threeD, false);
	// palette switch
	await page.click('.bd-props .bd-seg-btn[title="Futuristic colors"]');
	await frame();
	assert.equal(await page.locator('.bd-props .bd-swatch[title="#22d3ee"]').count() > 0, true);
	await page.click('.bd-props .bd-swatch[title="#1e1b4b"]');
	assert.equal((await els()).find((e) => e.id === ids.d).style.fill, "#1e1b4b");
});

test("tag shows above the title and is saved", async () => {
	const b = await addBlock(400, 300, "Orders");
	await page.fill('.bd-props input[placeholder^="e.g. Service"]', "Service · Java");
	await page.evaluate(() => document.activeElement.blur());
	await frame();
	const after = (await els()).find((e) => e.id === b.id);
	assert.equal(after.tag, "Service · Java");
	const text = await page.evaluate((id) => document.querySelector(`.bd-block[data-id="${id}"] .bd-text`).textContent, b.id);
	assert.ok(text.startsWith("SERVICE · JAVA"), text);
	const json = await page.evaluate(() => window.bd.structuredJson());
	assert.equal(json.unframed.blocks[0].tag, "Service · Java");
});

test("trace highlights upstream and downstream, dims the rest", async () => {
	const ids = await sampleChain();
	const c = await centerOf(ids.b);
	await page.mouse.click(c.x, c.y);
	await page.keyboard.press("t");
	await frame();
	assert.match(await classesOf(ids.b), /bd-trace-root/);
	assert.match(await classesOf(ids.a), /bd-trace-up/);
	assert.match(await classesOf(ids.c), /bd-trace-down/);
	assert.match(await classesOf(ids.d), /bd-dimmed/);
	assert.equal(await page.locator(".bd-connector.bd-trace-path").count(), 2);
	assert.match(await page.textContent(".bd-hint"), /1 upstream .* 1 downstream/);
	await shot("08-trace");
	await page.keyboard.press("Escape");
	await frame();
	assert.doesNotMatch(await classesOf(ids.d), /bd-dimmed/);
	assert.equal(await page.locator(".bd-svg.bd-tracing").count(), 0);
});

test("presentation: overview then frames, spotlight on click, Esc restores the editor", async () => {
	const ids = await sampleChain();
	const before = await page.evaluate(() => ({ ...window.bd.editor.vp }));
	await page.keyboard.press("p");
	await page.waitForTimeout(400);
	assert.equal(await page.locator(".bd-editor.bd-presenting").count(), 1);
	assert.equal(await page.textContent(".bd-present-counter"), "1 / 3");
	assert.equal(await page.textContent(".bd-present-title"), "Overview");
	assert.equal(await page.isVisible(".bd-toolbar"), false);
	await page.keyboard.press("ArrowRight");
	await page.waitForTimeout(450);
	assert.equal(await page.textContent(".bd-present-title"), "Front end");
	await page.keyboard.press("ArrowRight");
	await page.waitForTimeout(450);
	assert.equal(await page.textContent(".bd-present-counter"), "3 / 3");
	await page.keyboard.press("s");
	await page.mouse.move(600, 380);
	const c = await centerOf(ids.c);
	await page.mouse.click(c.x, c.y);
	await frame();
	assert.match(await classesOf(ids.c), /bd-trace-root/);
	// clicks never edit or move anything
	assert.equal((await els()).find((e) => e.id === ids.c).x, 780);
	await shot("09-presentation-dark");
	await page.keyboard.press("Escape");
	await frame();
	assert.equal(await page.locator(".bd-editor.bd-presenting").count(), 1, "first Esc clears the spotlight");
	await page.keyboard.press("Escape");
	await frame();
	assert.equal(await page.locator(".bd-editor.bd-presenting").count(), 0);
	assert.equal(await page.locator(".bd-present-bar").count(), 0);
	assert.equal(await page.evaluate(() => window.bd.editor.options.readOnly), false);
	await page.waitForTimeout(400);
	const after = await page.evaluate(() => ({ ...window.bd.editor.vp }));
	assert.deepEqual(after, before);
});

/** A → B on one row with a link between them; returns the ids. */
async function linkedPair(style = {}) {
	const ids = await page.evaluate((style) => {
		const ed = window.bd.editor;
		const a = ed.makeBlock({ x: 100, y: 200, width: 160, height: 80 }, { title: "Service A" });
		const b = ed.makeBlock({ x: 500, y: 200, width: 160, height: 80 }, { title: "Service B" });
		ed.insertBlocks([a, b]);
		const c = ed.connect(a.id, b.id, { select: true });
		ed.updateElement(c.id, { style: { ...c.style, ...style } });
		ed.zoomToFit({ animate: false });
		return { a: a.id, b: b.id, c: c.id };
	}, style);
	await frame();
	return ids;
}

/** Direction (+1 left to right, -1 right to left) and animation of each strand of a link. */
const strands = (id) =>
	page.evaluate((id) => {
		return [...document.querySelectorAll(`.bd-connector[data-id="${id}"] .bd-connector-line`)].map((el) => {
			const nums = el.getAttribute("d").match(/-?\d+(?:\.\d+)?/g).map(Number);
			return { dir: Math.sign(nums[nums.length - 2] - nums[0]), anim: getComputedStyle(el).animationName };
		});
	}, id);

const FLOW_BUTTON = '.bd-props .bd-seg-btn[title="Animated flow along the arrowheads (both ways when there are two)"]';

test("flow on a two-way link animates two lanes in opposite directions", async () => {
	const ids = await linkedPair({ startArrow: "arrow", endArrow: "arrow" });
	const conn = `.bd-connector[data-id="${ids.c}"]`;
	assert.equal((await strands(ids.c)).length, 1, "a plain two-way link is one line");
	await page.click(FLOW_BUTTON);
	await frame();
	assert.equal(await page.locator(`${conn} .bd-flow-lane`).count(), 2);
	const lanes = await strands(ids.c);
	assert.ok(lanes.every((l) => l.anim === "bd-flow-dash"), "both lanes animate");
	assert.deepEqual(lanes.map((l) => l.dir).sort(), [-1, 1], "one lane runs each way");
	await shot("15-two-way-flow");
	// the animation really moves each lane's dashes along its own direction
	const offsets = await page.evaluate((sel) => {
		const lanes = [...document.querySelectorAll(`${sel} .bd-flow-lane`)];
		const anims = document.getAnimations().filter((a) => lanes.includes(a.effect?.target));
		for (const a of anims) {
			a.pause();
			a.currentTime = 450;
		}
		return lanes.map((el) => parseFloat(getComputedStyle(el).strokeDashoffset));
	}, conn);
	assert.ok(offsets.length === 2 && offsets.every((o) => o < -5), `dashes advance along each path: ${offsets}`);
	// switching Flow off restores the single line
	await page.click('.bd-props .bd-seg-btn[title="Static line"]');
	await frame();
	assert.equal(await page.locator(`${conn} .bd-flow-lane`).count(), 0);
	assert.equal((await strands(ids.c)).length, 1);
});

test("flow follows the arrowheads: end-only runs forward, start-only runs backward", async () => {
	const ids = await linkedPair({ flow: true });
	assert.deepEqual((await strands(ids.c)).map((l) => l.dir), [1], "default arrow at the end: left to right");
	await page.evaluate((id) => {
		const ed = window.bd.editor;
		const c = ed.byId.get(id);
		ed.updateElement(id, { style: { ...c.style, startArrow: "arrow", endArrow: "none" } });
	}, ids.c);
	await frame();
	assert.deepEqual((await strands(ids.c)).map((l) => l.dir), [-1], "arrow at the start: right to left");
	assert.equal((await strands(ids.c)).length, 1);
});

test("tracing a block animates two-way links in both directions, and only while traced", async () => {
	const ids = await linkedPair({ startArrow: "arrow", endArrow: "arrow" });
	const conn = `.bd-connector[data-id="${ids.c}"]`;
	assert.equal(await page.locator(`${conn} .bd-flow-lane`).count(), 0);
	await page.evaluate((id) => window.bd.editor.traceBlock(id), ids.a);
	await frame();
	assert.equal(await page.locator(`${conn} .bd-flow-lane`).count(), 2, "lanes while the link is on the trace");
	assert.deepEqual((await strands(ids.c)).map((l) => l.dir).sort(), [-1, 1]);
	assert.ok((await strands(ids.c)).every((l) => l.anim === "bd-flow-dash"));
	await page.keyboard.press("Escape");
	await frame();
	assert.equal(await page.locator(`${conn} .bd-flow-lane`).count(), 0, "back to one line afterwards");
});

test("blocks inside another block: their links are drawn above it and can be selected", async () => {
	const ids = await page.evaluate(() => {
		const ed = window.bd.editor;
		const box = ed.makeBlock({ x: 60, y: 60, width: 520, height: 260 }, { title: "Platform", style: { ...ed.current.block, fill: "#e7f5ff", textVAlign: "top" } });
		const web = ed.makeBlock({ x: 100, y: 140, width: 140, height: 70 }, { title: "Web" });
		const api = ed.makeBlock({ x: 400, y: 140, width: 140, height: 70 }, { title: "API" });
		ed.insertBlocks([box, web, api]);
		const link = ed.connect(web.id, api.id);
		ed.updateElement(link.id, { label: "calls", comment: "over HTTPS" });
		ed.clearSelection();
		ed.zoomToFit({ animate: false });
		return { box: box.id, web: web.id, api: api.id, link: link.id };
	});
	await frame();
	// a point on the link, between "Web" and its label (the link is a straight line at y = 175)
	const onLink = await toScreen({ x: 270, y: 175 });
	const topmost = (p) =>
		page.evaluate(({ x, y }) => {
			const el = document.elementFromPoint(x, y);
			return { link: el?.closest(".bd-connector")?.getAttribute("data-id") ?? null, block: el?.closest(".bd-block")?.getAttribute("data-id") ?? null };
		}, p);
	assert.deepEqual(await topmost(onLink), { link: ids.link, block: null }, "the link is the topmost thing at its own pixels, not hidden under the container");
	// the label and the comment badge of that link are above the container as well
	const label = await page.evaluate(() => {
		const r = document.querySelector(".bd-connector-label rect").getBoundingClientRect();
		const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
		return !!el?.closest(".bd-connector-label");
	});
	assert.equal(label, true, "the label is visible on top of the container");
	await shot("17-nested-links");
	// clicking the link selects it (not the container around it)
	await page.mouse.click(onLink.x, onLink.y);
	assert.deepEqual(await sel(), [ids.link]);
	// the blocks keep their clicks: the container, and the inner blocks next to their own link
	const inWeb = await centerOf(ids.web);
	await page.mouse.click(inWeb.x, inWeb.y);
	assert.deepEqual(await sel(), [ids.web]);
	const inBox = await toScreen({ x: 150, y: 280 });
	await page.mouse.click(inBox.x, inBox.y);
	assert.deepEqual(await sel(), [ids.box]);
	const nearWeb = await toScreen({ x: 236, y: 175 }); // just inside Web's right edge, where its link starts
	await page.mouse.click(nearWeb.x, nearWeb.y);
	assert.deepEqual(await sel(), [ids.web], "a link does not steal clicks from its own end blocks");
});

test("cursors: hover cursors come from data-cursor; tools and panning override them", async () => {
	const b = await addBlock(400, 300, "Hover");
	const cursor = () => page.evaluate(() => getComputedStyle(window.bd.editor.svg).cursor);
	const c = await centerOf(b.id);
	await page.mouse.move(c.x, c.y);
	assert.equal(await cursor(), "move");
	const se = await toScreen({ x: b.x + b.width + 4, y: b.y + b.height + 4 });
	await page.mouse.move(se.x, se.y);
	assert.equal(await cursor(), "nwse-resize", "a resize handle of the selected block");
	await page.mouse.move(c.x, c.y);
	await page.keyboard.down("Space");
	assert.equal(await cursor(), "grab", "holding Space pans, even over a block");
	await page.keyboard.up("Space");
	assert.equal(await cursor(), "move");
	await page.keyboard.press("b");
	await page.mouse.move(c.x + 5, c.y);
	assert.equal(await cursor(), "crosshair", "drawing tools show a crosshair");
	await page.keyboard.press("h");
	await page.mouse.move(c.x, c.y);
	assert.equal(await cursor(), "grab", "the pan tool grabs");
	await page.mouse.down();
	assert.equal(await cursor(), "grabbing", "and grabs harder while dragging");
	await page.mouse.up();
	assert.equal(await cursor(), "grab");
});

test("vertical text alignment: top, middle and bottom from the panel", async () => {
	const b = await addBlock(400, 300, "Orders");
	const current = async () => (await els()).find((e) => e.id === b.id);
	const textY = () => page.evaluate((id) => parseFloat(document.querySelector(`.bd-block[data-id="${id}"] .bd-text tspan`).getAttribute("y")), b.id);
	assert.equal((await current()).style.textVAlign, "middle", "centered by default");
	const middle = await textY();
	await page.click('.bd-props .bd-seg-btn[title="Align text to the top"]');
	await frame();
	assert.equal((await current()).style.textVAlign, "top");
	const top = await textY();
	await page.click('.bd-props .bd-seg-btn[title="Align text to the bottom"]');
	await frame();
	assert.equal((await current()).style.textVAlign, "bottom");
	const bottom = await textY();
	assert.ok(top < middle && middle < bottom, `top ${top} < middle ${middle} < bottom ${bottom}`);
	assert.ok(top < 30 && bottom > 50, "the title really sits near the top and the bottom edge of the 80 unit block");
	await shot("16-title-bottom");
	// new blocks start with the alignment that was chosen last
	await page.click('.bd-props .bd-seg-btn[title="Align text to the top"]');
	const next = await addBlock(800, 300, "Next");
	assert.equal(next.style.textVAlign, "top");
	// the inline editor opens where the text is, so editing does not make it jump
	await page.evaluate((id) => window.bd.editor.textEditor.start(id), next.id);
	await frame();
	const where = await page.evaluate((id) => {
		const ed = window.bd.editor;
		const blk = ed.byId.get(id);
		const area = document.querySelector(".bd-text-editor.is-active").getBoundingClientRect();
		const svg = ed.svg.getBoundingClientRect();
		return { areaTop: area.top - svg.top, blockTop: ed.worldToScreen({ x: blk.x, y: blk.y }).y, zoom: ed.vp.zoom };
	}, next.id);
	assert.ok(Math.abs(where.areaTop - where.blockTop - 8 * where.zoom) < 2, `editor sits at the top inset: ${JSON.stringify(where)}`);
	await page.keyboard.press("Escape");
});

test("description: eye toggle in the panel and the right-click menu", async () => {
	const b = await addBlock(400, 300, "Orders service");
	const field = '.bd-props textarea[placeholder^="Optional details"]';
	await page.fill(field, "Handles checkout and refunds");
	await page.evaluate(() => document.activeElement.blur());
	await frame();
	const textOf = () => page.evaluate((id) => document.querySelector(`.bd-block[data-id="${id}"] .bd-text`)?.textContent ?? "", b.id);
	const current = async () => (await els()).find((e) => e.id === b.id);
	assert.equal((await current()).descriptionOpen, true, "shown by default");
	assert.match(await textOf(), /Handles checkout/);
	// panel: Hidden
	await page.click('.bd-props .bd-visibility-btn[title="Hide description on the block"]');
	await frame();
	assert.equal((await current()).descriptionOpen, false);
	assert.doesNotMatch(await textOf(), /Handles checkout/);
	assert.match(await textOf(), /Orders service/);
	assert.equal((await current()).description, "Handles checkout and refunds", "the text is kept");
	assert.equal(await page.inputValue(field), "Handles checkout and refunds", "and still editable in the panel");
	assert.equal(await page.locator('.bd-props .bd-visibility-btn[title="Show description on the block"][aria-pressed="false"]').count(), 1);
	await shot("14-description-hidden");
	// right-click menu offers the opposite action
	const c = await centerOf(b.id);
	await page.mouse.click(c.x, c.y, { button: "right" });
	const menus = await page.evaluate(() => window.bd.menus);
	assert.ok(menus[menus.length - 1].includes("Show description"));
	await page.evaluate(() => window.bd.clickMenu("Show description"));
	await frame();
	assert.equal((await current()).descriptionOpen, true);
	assert.match(await textOf(), /Handles checkout/);
	assert.equal(await page.locator('.bd-props .bd-visibility-btn[title="Hide description on the block"][aria-pressed="true"]').count(), 1);
	// one undo step per toggle
	await page.keyboard.press("Control+z");
	await frame();
	assert.equal((await current()).descriptionOpen, false);
	// a block without a description has nothing to hide, so the menu does not offer it
	const plain = await addBlock(700, 300, "Plain");
	const pc = await centerOf(plain.id);
	await page.mouse.click(pc.x, pc.y, { button: "right" });
	const plainMenu = (await page.evaluate(() => window.bd.menus)).at(-1);
	assert.ok(!plainMenu.some((t) => /description/i.test(t)));
	await page.keyboard.press("Escape");
});

test("side panel: show/hide is a small eye in the label row, and rows stay tidy", async () => {
	const b = await addBlock(400, 300, "Orders service");
	await page.evaluate((id) => window.bd.editor.updateElement(id, { description: "Handles checkout", comment: "Owned by payments" }), b.id);
	await frame();
	const box = (sel) => page.evaluate((sel) => {
		const el = document.querySelector(sel);
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), height: Math.round(r.height) };
	}, sel);
	// no wide Hidden / Shown buttons any more
	const texts = await page.$$eval(".bd-props .bd-seg-btn", (els) => els.map((e) => e.textContent.trim()));
	assert.ok(!texts.includes("Hidden") && !texts.includes("Shown"), `old toggle buttons are gone (${texts.join(", ")})`);
	for (const key of ["description", "comment"]) {
		const section = `.bd-props .bd-section[data-section="${key}"]`;
		const label = await box(`${section} .bd-section-label`);
		const eye = await box(`${section} .bd-visibility-btn`);
		const field = await box(`${section} .bd-textarea`);
		assert.ok(eye.width <= 26 && eye.height <= 26, `${key}: the toggle is a small icon button (${eye.width}×${eye.height})`);
		assert.ok(eye.top >= label.top - 6 && eye.bottom <= label.bottom + 6, `${key}: the toggle shares the label's row`);
		assert.ok(eye.left > label.right, `${key}: and sits to its right`);
		assert.ok(field.top - label.bottom < 12, `${key}: the field follows the label directly, with no extra row (${field.top - label.bottom}px)`);
		// a description is shown by default, a comment starts collapsed
		assert.equal(await page.getAttribute(`${section} .bd-visibility-btn`, "aria-pressed"), key === "description" ? "true" : "false");
	}
	// the icon changes with the state, and a hidden field reads as switched off
	await page.click('.bd-props .bd-visibility-btn[title="Hide description on the block"]');
	await frame();
	assert.equal(await page.locator('.bd-props .bd-section[data-section="description"].is-off').count(), 1);
	assert.equal(await page.locator('.bd-props .bd-section[data-section="description"] .bd-visibility-btn.is-on').count(), 0);
	const opacity = await page.evaluate(() => getComputedStyle(document.querySelector('.bd-props [data-section="description"] .bd-textarea')).opacity);
	assert.ok(Number(opacity) < 1, "the hidden description's field is dimmed");
	assert.equal(await page.inputValue('.bd-props [data-section="description"] .bd-textarea'), "Handles checkout", "but it keeps its text and stays editable");
	// color rows: the custom picker is never alone on a row
	const rows = (title) =>
		page.evaluate((title) => {
			const sec = [...document.querySelectorAll(".bd-props .bd-section")].find((s) => s.querySelector(".bd-section-label")?.textContent === title);
			const tops = [...sec.querySelectorAll(".bd-swatch, .bd-color-input")].map((e) => Math.round(e.getBoundingClientRect().top));
			const counts = new Map();
			for (const t of tops) counts.set(t, (counts.get(t) ?? 0) + 1);
			return [...counts.values()];
		}, title);
	assert.deepEqual(await rows("Stroke"), [9], "stroke colors and the picker fit one row");
	assert.ok((await rows("Fill")).every((n) => n >= 2), "no lone swatch on the last fill row");
	// a few options read as one joined control
	assert.ok((await page.locator(".bd-props .bd-segmented.is-joined").count()) >= 4);
	await shot("18-side-panel");
});

test("presenting: clicking a comment badge shows or hides the comment, and the drawing is left alone", async () => {
	const ids = await page.evaluate(() => {
		const ed = window.bd.editor;
		const a = ed.makeBlock({ x: 40, y: 100, width: 160, height: 80 }, { title: "Web app", comment: "Owned by the web team" });
		const b = ed.makeBlock({ x: 400, y: 100, width: 160, height: 80 }, { title: "API", comment: "Rate limited", commentOpen: true });
		ed.insertBlocks([a, b]);
		const c = ed.connect(a.id, b.id);
		ed.updateElement(c.id, { label: "calls", comment: "gRPC over TLS" });
		ed.clearSelection();
		ed.zoomToFit({ animate: false });
		return { a: a.id, b: b.id, c: c.id };
	});
	await frame();
	const savedBefore = await page.evaluate(() => window.bd.serialize());
	await page.evaluate(() => window.bd.editor.presenter.start());
	await page.waitForTimeout(450);
	const callouts = () => page.locator(".bd-comment-callout").count();
	const clickBadge = async (selector) => {
		const box = await page.locator(selector).first().boundingBox();
		assert.ok(box, `badge ${selector} is visible`);
		await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
		await frame();
	};
	// as authored: only the API block's comment is open
	assert.equal(await callouts(), 1);
	// block badge: closed -> open
	await clickBadge(`.bd-block[data-id="${ids.a}"] .bd-comment-badge`);
	assert.equal(await callouts(), 2, "the first click shows the comment");
	assert.equal(await page.locator(`.bd-block[data-id="${ids.a}"] .bd-comment-badge.is-open`).count(), 1);
	// the click was a comment toggle, not a spotlight
	assert.equal(await page.evaluate(() => window.bd.editor.traceRootId), null);
	await shot("13-presenting-comment");
	// block badge: open -> closed, and an authored-open comment can be hidden too
	await clickBadge(`.bd-block[data-id="${ids.a}"] .bd-comment-badge`);
	assert.equal(await callouts(), 1, "the second click hides it again");
	await clickBadge(`.bd-block[data-id="${ids.b}"] .bd-comment-badge`);
	assert.equal(await callouts(), 0, "an authored-open comment can be hidden while presenting");
	// connector badge works the same way
	await clickBadge(".bd-layer-labels .bd-comment-badge");
	assert.equal(await callouts(), 1, "connector comment shown");
	await clickBadge(".bd-layer-labels .bd-comment-badge");
	assert.equal(await callouts(), 0, "connector comment hidden");
	// the drawing itself never changed, so nothing was saved
	assert.equal(await page.evaluate(() => window.bd.serialize()), savedBefore);
	assert.equal(await page.evaluate((id) => window.bd.editor.byId.get(id).commentOpen, ids.b), true);
	// leaving the presentation restores the saved state, whatever was clicked
	await clickBadge(`.bd-block[data-id="${ids.a}"] .bd-comment-badge`);
	await page.keyboard.press("Escape");
	await frame();
	assert.equal(await page.locator(".bd-editor.bd-presenting").count(), 0);
	assert.equal(await callouts(), 1, "back to the authored state: only the API comment is open");
	assert.equal(await page.evaluate(() => window.bd.serialize()), savedBefore);
});

test("themed diagram screenshots (executive, futuristic)", async () => {
	await sampleChain();
	await page.evaluate(() => {
		const ed = window.bd.editor;
		const blocks = ed.getElements().filter((e) => e.type === "block");
		ed.updateElement(blocks[1].id, { tag: "Gateway · Kong" });
		ed.updateElement(blocks[2].id, { tag: "Service · Java", shape: "rounded" });
		ed.updateElement(blocks[3].id, { tag: "PostgreSQL", shape: "cylinder" });
		ed.applyTheme("executive");
		ed.zoomToFit({ animate: false });
	});
	await frame();
	await shot("10-theme-executive");
	await page.evaluate(() => {
		const ed = window.bd.editor;
		ed.applyTheme("futuristic");
		for (const c of ed.getElements().filter((e) => e.type === "connector")) ed.updateElement(c.id, { style: { ...c.style, flow: true } });
	});
	await frame();
	await shot("11-theme-futuristic");
	await page.evaluate(() => window.bd.editor.applyTheme("minimal"));
	await frame();
	await shot("12-theme-minimal");
	const svg = await page.evaluate(() => window.bd.svg());
	assert.ok(svg.includes("linearGradient") === false, "minimal is flat");
	assert.equal(errors.length, 0, errors.join("\n"));
});

test("double-tap on a touch screen adds a block", async () => {
	const touch = await offline(await browser.newContext({ viewport: { width: 900, height: 700 }, hasTouch: true, isMobile: true }));
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

test("web fonts are opt-in: the font picker explains it, and nothing is requested", async () => {
	const b = await addBlock(300, 250, "Fonts");
	const c = await centerOf(b.id);
	await page.mouse.click(c.x, c.y);
	await frame();
	const note = () =>
		page.evaluate(() => {
			const n = document.querySelector(".bd-props .bd-field-note");
			return n ? !n.hidden : null;
		});
	const pick = async (id) => {
		await page.selectOption(".bd-font-select", id);
		await frame();
	};
	await pick("inter");
	assert.equal(await note(), true, "Inter is a web font and web fonts are off");
	await pick("segoe");
	assert.equal(await note(), false, "Segoe UI is a system font");
	await pick("roboto");
	assert.equal(await note(), true);
	await page.evaluate(() => window.bd.editor.setOptions({ webFonts: true }));
	await frame();
	assert.equal(await note(), false, "nothing to explain once web fonts are on");
	assert.deepEqual(external, [], "no network request while editing");
});

test("relayout() wraps the text again after the fonts changed", async () => {
	const b = await addBlock(300, 250, "alpha beta gamma delta");
	const lines = () => page.evaluate((id) => document.querySelectorAll(`[data-id="${id}"] tspan`).length, b.id);
	const before = await lines();
	assert.ok(before >= 1);
	// a much wider font: nothing changes on screen until the editor is told to measure again
	await page.evaluate(() => window.bd.setTextMeasure((text, size) => text.length * size * 1.4));
	await frame();
	assert.equal(await lines(), before, "cached drawing is kept");
	await page.evaluate(() => window.bd.editor.relayout());
	await frame();
	assert.ok((await lines()) > before, `wide text wraps onto more lines (${before} → ${await lines()})`);
	await page.evaluate(() => window.bd.setTextMeasure(null));
});

test("the editor never requests anything from the network", async () => {
	assert.deepEqual(external, [], `refused requests:\n${external.join("\n")}`);
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
