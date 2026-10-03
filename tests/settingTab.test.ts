import { describe, expect, it, vi } from "vitest";
import { getPath, type SettingDef } from "../src/kernel/settings";
import type { BlockDrawHost } from "../src/obsidian/plugin";
import { BlockDrawSettingTab } from "../src/obsidian/SettingTab";
import { DEFAULT_SETTINGS, SETTINGS, type BlockDrawSettings } from "../src/obsidian/settings";
import { Setting, type FakeContainer, type FakeControl } from "./fakes/obsidian";

/** Obsidian's global createFragment(), enough for the numbered steps in two descriptions. */
function fakeElement(): Record<string, unknown> {
	const el: Record<string, unknown> = { text: "" };
	const child = (opts?: { text?: string }) => {
		const c = fakeElement();
		if (opts?.text) c.text = opts.text;
		return c;
	};
	el.createDiv = child;
	el.createEl = (_tag: string, opts?: { text?: string }) => child(opts);
	el.setText = (t: string) => (el.text = t);
	el.appendText = (t: string) => (el.text = `${el.text as string}${t}`);
	return el;
}
vi.stubGlobal("createFragment", fakeElement);

function settingTab(settings: BlockDrawSettings): BlockDrawSettingTab {
	const host = {
		settings,
		auth: { isSignedIn: () => false, signIn: async () => {}, signOut: async () => {} },
		saveSettings: async () => {},
		isSecretInVault: () => false,
		runExport: async () => {},
	};
	return new BlockDrawSettingTab({} as never, host as unknown as BlockDrawHost);
}

/** The control each type of setting gets. */
const CONTROL: Record<SettingDef["type"], FakeControl["kind"]> = {
	text: "text",
	folder: "text",
	secret: "text",
	toggle: "toggle",
	slider: "slider",
	choice: "dropdown",
};

/** Settings that differ from the defaults, so a control showing a default by mistake is caught. */
function changedSettings(): BlockDrawSettings {
	const s = structuredClone(DEFAULT_SETTINGS);
	s.newFilePrefix = "Sketch";
	s.gridSize = 30;
	s.snapToGrid = false;
	s.webFonts = true;
	s.jsonFormat = "raw";
	s.sheets.method = "oauth";
	s.sheets.appsScriptSecret = "s3cret";
	s.sheets.cellPixels = 32;
	return s;
}

type DeclarativeGroup = { heading: string; items: { name: string; render?: (setting: Setting) => void }[] };

/** Renders every row the way Obsidian 1.13+ does, hidden rows included. */
function declarativeRows(settings: BlockDrawSettings): Setting[] {
	const groups = settingTab(settings).getSettingDefinitions() as unknown as DeclarativeGroup[];
	return groups.flatMap((g) =>
		g.items.map((item) => {
			const setting = new Setting().setName(item.name);
			item.render?.(setting);
			return setting;
		}),
	);
}

function expectControl(def: SettingDef, control: FakeControl | undefined, settings: BlockDrawSettings): void {
	expect(control?.kind, def.key).toBe(CONTROL[def.type]);
	const value = getPath(settings, def.key);
	expect(control?.value, def.key).toEqual(def.type === "toggle" ? value === true : value);
	if (def.type === "secret") expect(control?.inputType, def.key).toBe("password");
	if (def.type === "choice") expect(control?.options, def.key).toEqual(def.options.map((o) => o.value));
}

describe("the settings tab", () => {
	it("gives every row of the SETTINGS table one place, with the control its type needs and the current value", () => {
		const settings = changedSettings();
		const rows = declarativeRows(settings);
		const names = SETTINGS.map((d) => d.name);
		expect(new Set(names).size, "every setting has its own name").toBe(names.length);
		for (const def of SETTINGS) {
			const matching = rows.filter((r) => r.name === def.name);
			expect(matching, `${def.key} is placed in the tab once`).toHaveLength(1);
			expectControl(def, matching[0].controls[0], settings);
		}
	});

	it.each(["apps-script", "oauth"] as const)("shows the same controls on Obsidian before 1.13, for the %s method's rows", (method) => {
		const settings = changedSettings();
		settings.sheets.method = method;
		const tab = settingTab(settings);
		tab.display();
		const rows = (tab.containerEl as unknown as FakeContainer).settings;
		expect(rows.filter((r) => r.heading).map((r) => r.name)).toEqual(["Drawings", "Export", "Google Sheets"]);
		const otherMethod = method === "oauth" ? "sheets.appsScript" : "sheets.oauth";
		for (const def of SETTINGS) {
			const row = rows.find((r) => r.name === def.name);
			if (def.key.startsWith(otherMethod)) expect(row, `${def.key} is hidden`).toBeUndefined();
			else expectControl(def, row?.controls[0], settings);
		}
	});
});
