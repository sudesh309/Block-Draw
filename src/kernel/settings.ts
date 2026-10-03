/**
 * The settings mechanism. The host defines one row per setting (its SETTINGS table); these
 * functions derive the defaults, validate what was saved, decide what goes into data.json and keep
 * secrets out of it. Nothing here knows any particular setting.
 */

/** Something a setting lets the plugin reach while it is on, e.g. "net:fonts.googleapis.com". */
export type Capability = `net:${string}`;

interface SettingBase<T> {
	/** Dotted path in the settings object and in data.json, e.g. "sheets.cellSize". */
	key: string;
	name: string;
	desc?: string;
	default: T;
	/**
	 * What the plugin may reach because of this setting. A toggle that reaches the network counts
	 * as on only when it was saved as a literal `true`, so it can never be switched on by accident.
	 */
	needs?: readonly Capability[];
}

export interface TextSetting extends SettingBase<string> {
	type: "text" | "folder";
	placeholder?: string;
	/** Stored instead of an empty value. */
	emptyAs?: string;
}

export interface SecretSetting extends SettingBase<string> {
	type: "secret";
	/** Name in the device's secret store: lowercase letters, digits and dashes. */
	secretName: string;
}

export interface ToggleSetting extends SettingBase<boolean> {
	type: "toggle";
}

export interface SliderSetting extends SettingBase<number> {
	type: "slider";
	min: number;
	max: number;
	step: number;
}

export interface ChoiceSetting extends SettingBase<string> {
	type: "choice";
	options: readonly { value: string; label: string }[];
}

export type SettingDef = TextSetting | SecretSetting | ToggleSetting | SliderSetting | ChoiceSetting;

/** Where secrets are kept instead of data.json (which syncs with the vault). */
export interface SecretStore {
	get(name: string): string | null;
	/** Stores a secret; an empty value removes it. Returns false when this device cannot keep it. */
	set(name: string, value: string): boolean;
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const copy = (v: Obj): Obj => JSON.parse(JSON.stringify(v)) as Obj;

export function getPath(obj: unknown, key: string): unknown {
	let cur = obj;
	for (const part of key.split(".")) {
		if (!isObj(cur)) return undefined;
		cur = cur[part];
	}
	return cur;
}

export function setPath(obj: Obj, key: string, value: unknown): void {
	const parts = key.split(".");
	let cur = obj;
	for (const part of parts.slice(0, -1)) {
		if (!isObj(cur[part])) cur[part] = {};
		cur = cur[part] as Obj;
	}
	cur[parts[parts.length - 1]] = value;
}

/** Removes a key, and any object it leaves empty. */
function deletePath(obj: Obj, key: string): void {
	const [head, ...rest] = key.split(".");
	if (!rest.length) {
		delete obj[head];
		return;
	}
	const inner = obj[head];
	if (!isObj(inner)) return;
	deletePath(inner, rest.join("."));
	if (!Object.keys(inner).length) delete obj[head];
}

export const reachesNetwork = (def: SettingDef): boolean => def.needs?.some((n) => n.startsWith("net:")) ?? false;

/** The value a setting takes from what was saved: the saved value when it is valid, otherwise the default. */
export function validSetting(def: SettingDef, raw: unknown): unknown {
	switch (def.type) {
		case "text":
		case "folder":
		case "secret":
			return typeof raw === "string" ? raw : def.default;
		case "toggle":
			if (reachesNetwork(def)) return raw === true;
			return typeof raw === "boolean" ? raw : def.default;
		case "slider":
			return typeof raw === "number" && Number.isFinite(raw) ? Math.min(def.max, Math.max(def.min, raw)) : def.default;
		case "choice":
			return def.options.some((o) => o.value === raw) ? raw : def.default;
	}
}

export function settingDefaults<T>(defs: readonly SettingDef[]): T {
	const out: Obj = {};
	for (const def of defs) setPath(out, def.key, def.default);
	return out as T;
}

export interface StoredSettings {
	/** Keys in data.json that no row knows (written by a newer release); saved back unchanged. */
	unknown: Obj;
	/** Secrets the secret store could not take; they stay in data.json. */
	inVault: Set<string>;
}

export interface LoadedSettings<T> extends StoredSettings {
	values: T;
	/** Secrets found in data.json and moved into the secret store; data.json should be saved again. */
	migrated: string[];
}

/**
 * Reads data.json. A secret comes from the secret store; when the store has none but data.json
 * does (written by 0.4.x or by a device that could not store it), that value is used and moved to
 * the store.
 */
export function loadSettings<T>(defs: readonly SettingDef[], saved: unknown, store: SecretStore): LoadedSettings<T> {
	const data = isObj(saved) ? saved : {};
	const values: Obj = {};
	const unknown = copy(data);
	const migrated: string[] = [];
	const inVault = new Set<string>();
	for (const def of defs) {
		const raw = getPath(data, def.key);
		deletePath(unknown, def.key);
		if (def.type !== "secret") {
			setPath(values, def.key, validSetting(def, raw));
			continue;
		}
		let value = store.get(def.secretName) ?? "";
		const legacy = typeof raw === "string" ? raw : "";
		if (!value && legacy) {
			if (store.set(def.secretName, legacy)) migrated.push(def.key);
			else inVault.add(def.key);
			value = legacy;
		}
		setPath(values, def.key, value);
	}
	return { values: values as T, unknown, migrated, inVault };
}

/**
 * What to write to data.json: the unknown keys as they were, then every value that differs from
 * its default. Secrets go to the secret store instead; only one the store refuses stays in data.json.
 */
export function settingsToSave(defs: readonly SettingDef[], values: unknown, stored: StoredSettings, store: SecretStore): Obj {
	const out = copy(stored.unknown);
	for (const def of defs) {
		const value = getPath(values, def.key);
		if (def.type === "secret") {
			const secret = typeof value === "string" ? value : "";
			if (store.set(def.secretName, secret)) {
				stored.inVault.delete(def.key);
			} else {
				stored.inVault.add(def.key);
				if (secret) setPath(out, def.key, secret);
			}
		} else if (value !== def.default) {
			setPath(out, def.key, value);
		}
	}
	return out;
}
