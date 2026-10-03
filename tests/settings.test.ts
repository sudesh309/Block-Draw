import { describe, expect, it } from "vitest";
import { getPath, loadSettings, reachesNetwork, settingsToSave, type SecretStore } from "../src/kernel/settings";
import { DEFAULT_SETTINGS, SETTINGS, type BlockDrawSettings } from "../src/obsidian/settings";

/** A secret store in memory; `broken` makes it refuse every write, like a device without storage. */
function memoryStore(initial: Record<string, string> = {}, broken = false): SecretStore & { data: Record<string, string> } {
	const data = { ...initial };
	return {
		data,
		get: (name) => data[name] || null,
		set(name, value) {
			if (broken) return false;
			if (value) data[name] = value;
			else delete data[name];
			return true;
		},
	};
}

const load = (saved: unknown, store = memoryStore()) => loadSettings<BlockDrawSettings>(SETTINGS, saved, store);

/** The defaults of 0.4.6, written out: the schema must reproduce them exactly. */
const DEFAULTS_046 = {
	newFileFolder: "",
	newFilePrefix: "Drawing",
	gridSize: 20,
	snapToGrid: true,
	showGrid: true,
	exportFolder: "",
	jsonFormat: "structured",
	webFonts: false,
	sheets: {
		method: "apps-script",
		appsScriptUrl: "",
		appsScriptSecret: "",
		oauthClientId: "",
		oauthClientSecret: "",
		cellSize: 20,
		cellPixels: 20,
		includeIndex: true,
		includeDataSheets: true,
		includeUnframed: true,
		updateExisting: true,
		openAfterExport: true,
	},
};

describe("the SETTINGS table", () => {
	it("reproduces the 0.4.6 defaults", () => {
		expect(DEFAULT_SETTINGS).toEqual(DEFAULTS_046);
		expect(load(undefined).values).toEqual(DEFAULTS_046);
	});

	it("has one row per key, each named", () => {
		const keys = SETTINGS.map((d) => d.key);
		expect(new Set(keys).size).toBe(keys.length);
		for (const def of SETTINGS) expect(def.name.length, def.key).toBeGreaterThan(0);
	});

	it("keeps every setting that reaches the network off by default", () => {
		const online = SETTINGS.filter(reachesNetwork);
		expect(online.map((d) => d.key)).toEqual(["webFonts"]);
		for (const def of online) expect(def.default, def.key).toBe(false);
	});
});

describe("reading data.json", () => {
	it("keeps valid values and replaces invalid ones with the default", () => {
		const v = load({
			gridSize: 30,
			showGrid: "yes",
			jsonFormat: "xml",
			newFilePrefix: 7,
			sheets: { cellSize: 500, cellPixels: -3, method: "oauth", includeIndex: false },
		}).values;
		expect(v.gridSize).toBe(30);
		expect(v.showGrid).toBe(true);
		expect(v.jsonFormat).toBe("structured");
		expect(v.newFilePrefix).toBe("Drawing");
		expect(v.sheets.cellSize).toBe(60); // clamped to the slider's range
		expect(v.sheets.cellPixels).toBe(10);
		expect(v.sheets.method).toBe("oauth");
		expect(v.sheets.includeIndex).toBe(false);
	});

	it("turns on a setting that reaches the network only for a literal true", () => {
		expect(load({ webFonts: true }).values.webFonts).toBe(true);
		for (const v of ["true", 1, "yes", {}, null]) expect(load({ webFonts: v }).values.webFonts).toBe(false);
	});
});

describe("writing data.json", () => {
	it("stores only what differs from the defaults", () => {
		const loaded = load({ gridSize: 30, showGrid: true, sheets: { cellSize: 20, includeIndex: false } });
		expect(settingsToSave(SETTINGS, loaded.values, loaded, memoryStore())).toEqual({ gridSize: 30, sheets: { includeIndex: false } });
		const fresh = load(undefined);
		expect(settingsToSave(SETTINGS, fresh.values, fresh, memoryStore())).toEqual({});
	});

	it("keeps keys written by a newer release", () => {
		const loaded = load({ gridSize: 30, futureOption: { on: true }, sheets: { futureSheetOption: 3 } });
		expect(settingsToSave(SETTINGS, loaded.values, loaded, memoryStore())).toEqual({
			gridSize: 30,
			futureOption: { on: true },
			sheets: { futureSheetOption: 3 },
		});
	});
});

describe("secrets", () => {
	it("never go into data.json; they live in the secret store", () => {
		const store = memoryStore();
		const loaded = load({}, store);
		loaded.values.sheets.appsScriptSecret = "s3cret";
		loaded.values.sheets.oauthClientSecret = "client-secret";
		const saved = settingsToSave(SETTINGS, loaded.values, loaded, store);
		expect(JSON.stringify(saved)).not.toContain("s3cret");
		expect(JSON.stringify(saved)).not.toContain("client-secret");
		expect(store.data).toEqual({ "apps-script-secret": "s3cret", "oauth-client-secret": "client-secret" });
		expect(load(saved, store).values.sheets.appsScriptSecret).toBe("s3cret");
	});

	it("written by 0.4.x into data.json move into the store on the first load", () => {
		const store = memoryStore();
		const old = { gridSize: 30, sheets: { appsScriptUrl: "https://script.google.com/macros/s/x/exec", appsScriptSecret: "old-secret" } };
		const loaded = load(old, store);
		expect(loaded.values.sheets.appsScriptSecret).toBe("old-secret");
		expect(loaded.migrated).toEqual(["sheets.appsScriptSecret"]);
		expect(store.data["apps-script-secret"]).toBe("old-secret");
		const saved = settingsToSave(SETTINGS, loaded.values, loaded, store);
		expect(getPath(saved, "sheets.appsScriptSecret")).toBeUndefined();
		expect(getPath(saved, "sheets.appsScriptUrl")).toBe("https://script.google.com/macros/s/x/exec");
	});

	it("prefer the store over an older copy in data.json", () => {
		const store = memoryStore({ "apps-script-secret": "new" });
		const loaded = load({ sheets: { appsScriptSecret: "old" } }, store);
		expect(loaded.values.sheets.appsScriptSecret).toBe("new");
		expect(loaded.migrated).toEqual([]);
	});

	it("stay in data.json when the device cannot store them", () => {
		const store = memoryStore({}, true);
		const loaded = load({ sheets: { appsScriptSecret: "kept" } }, store);
		expect(loaded.values.sheets.appsScriptSecret).toBe("kept");
		expect([...loaded.inVault]).toEqual(["sheets.appsScriptSecret"]);
		expect(getPath(settingsToSave(SETTINGS, loaded.values, loaded, store), "sheets.appsScriptSecret")).toBe("kept");
	});
});
