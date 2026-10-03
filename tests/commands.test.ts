import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMMANDS, EDITOR_KEYMAP, GESTURES, HELP_GROUPS, helpRows, shortcut } from "../src/editor/commands";
import { compileKeymap, formatChord, parseChord, type KeyPress } from "../src/kernel/commands";
import { updatingGolden } from "./golden";

const press = (key: string, mods: Partial<KeyPress> = {}): KeyPress => ({
	key,
	code: /^\d$/.test(key) ? `Digit${key}` : /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : "",
	ctrlKey: false,
	metaKey: false,
	shiftKey: false,
	altKey: false,
	...mods,
});
const idFor = (p: KeyPress) => EDITOR_KEYMAP.find(p)?.id ?? null;

describe("the COMMANDS table", () => {
	it("parses every key, and no key is listed twice", () => {
		expect(() => compileKeymap(COMMANDS)).not.toThrow();
		const specs = COMMANDS.flatMap((c) => c.keys);
		expect(new Set(specs).size).toBe(specs.length);
		const ids = COMMANDS.map((c) => c.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const c of COMMANDS) expect(HELP_GROUPS, c.id).toContain(c.group);
	});

	it("rejects keys it cannot read", () => {
		expect(() => parseChord("Hyper+X")).toThrow();
		expect(() => parseChord("Mod+")).toThrow();
	});

	it("sends each key to the command 0.4.6 ran for it", () => {
		const cases: [KeyPress, string | null][] = [
			[press("v"), "tool-select"],
			[press("V", { shiftKey: true }), "tool-select"],
			[press("1"), "tool-select"],
			[press("h"), "tool-pan"],
			[press("b"), "tool-block"],
			[press("2"), "tool-block"],
			[press("r"), "tool-rectangle"],
			[press("o"), "tool-ellipse"],
			[press("d"), "tool-decision"],
			[press("a"), "tool-connector"],
			[press("c"), "tool-connector"],
			[press("f"), "tool-frame"],
			[{ ...press("!", { shiftKey: true }), code: "Digit1" }, "zoom-fit"],
			[{ ...press("1", { shiftKey: true }), code: "Digit1" }, "zoom-fit"], // AZERTY types digits with Shift
			[{ ...press("@", { shiftKey: true }), code: "Digit2" }, "zoom-selection"],
			[{ ...press(")", { shiftKey: true }), code: "Digit0" }, "zoom-reset"],
			[press("+", { shiftKey: true }), "zoom-in"],
			[press("="), "zoom-in"],
			[press("-"), "zoom-out"],
			[press("_", { shiftKey: true }), "zoom-out"],
			[press("g"), "toggle-grid"],
			[press("z", { ctrlKey: true }), "undo"],
			[press("z", { metaKey: true }), "undo"],
			[press("Z", { ctrlKey: true, shiftKey: true }), "redo"],
			[press("y", { ctrlKey: true }), "redo"],
			[press("a", { ctrlKey: true }), "select-all"],
			[press("d", { metaKey: true }), "duplicate"],
			[press("k", { ctrlKey: true }), "edit-link"],
			[press("]", { ctrlKey: true }), "forward"],
			[press("}", { ctrlKey: true, shiftKey: true }), "to-front"],
			[press("]", { ctrlKey: true, shiftKey: true }), "to-front"],
			[press("[", { ctrlKey: true }), "backward"],
			[press("{", { ctrlKey: true, shiftKey: true }), "to-back"],
			[press("Enter", { ctrlKey: true }), "follow-link"],
			[press("Enter"), "edit-text"],
			[press("Enter", { shiftKey: true }), "edit-text"],
			[press("Delete"), "delete"],
			[press("Backspace"), "delete"],
			[press("ArrowLeft"), "nudge"],
			[press("ArrowUp", { shiftKey: true }), "nudge"],
			[press("ArrowLeft", { altKey: true }), "back"],
			[press("]"), "next-frame"],
			[press("PageDown"), "next-frame"],
			[press("["), "previous-frame"],
			[press("PageUp"), "previous-frame"],
			[press("p"), "present"],
			[press("t"), "trace"],
			[press("?", { shiftKey: true }), "help"],
			[press("Escape"), "cancel"],
			// keys the editor leaves to Obsidian
			[press("p", { ctrlKey: true }), null],
			[press("v", { altKey: true }), null],
			[press("x"), null],
			[press("Tab"), null],
		];
		for (const [p, id] of cases) expect(idFor(p), JSON.stringify(p)).toBe(id);
	});

	it("formats keys for people", () => {
		expect(formatChord("Mod+Shift+Z")).toBe("Ctrl/Cmd+Shift+Z");
		expect(formatChord("Shift+Digit1")).toBe("Shift+1");
		expect(formatChord("Alt+ArrowLeft")).toBe("Alt+←");
		expect(formatChord("Minus")).toBe("−");
		expect(shortcut("tool-pan")).toBe("H");
		expect(shortcut("undo")).toBe("Ctrl/Cmd+Z");
	});
});

describe("help and docs", () => {
	it("list every command and gesture once, under its heading", () => {
		const rows = helpRows();
		expect(rows.map((g) => g.group)).toEqual([...HELP_GROUPS]);
		expect(rows.flatMap((g) => g.rows).length).toBe(COMMANDS.length + GESTURES.length);
	});

	it("keep the shortcut table in docs/DESIGN.md in step with the table", () => {
		const path = join(__dirname, "..", "docs", "DESIGN.md");
		const doc = readFileSync(path, "utf8");
		const start = doc.indexOf("<!-- shortcuts:start");
		const end = doc.indexOf("<!-- shortcuts:end -->");
		expect(start).toBeGreaterThan(-1);
		expect(end).toBeGreaterThan(start);
		const head = doc.indexOf("-->", start) + 3;
		const table = helpRows()
			.map(({ group, rows }) => [`**${group}**`, "", "| Keys | Action |", "| --- | --- |", ...rows.map((r) => `| ${r.keys} | ${r.label} |`)].join("\n"))
			.join("\n\n");
		const generated = `\n${table}\n`;
		if (updatingGolden) writeFileSync(path, doc.slice(0, head) + generated + doc.slice(end));
		else expect(doc.slice(head, end)).toBe(generated);
	});
});
