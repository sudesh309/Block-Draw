import type { App } from "obsidian";
import type { SecretStore } from "../kernel/settings";

interface AppWithStorage {
	/** Obsidian 1.11.4+ */
	secretStorage?: { getSecret(id: string): string | null; setSecret(id: string, secret: string): void };
	/** Obsidian 1.8.7+, scoped to the vault. */
	loadLocalStorage?: (key: string) => unknown;
	saveLocalStorage?: (key: string, data: unknown) => void;
}

/** Short stable hash of the vault name, so two vaults on one device keep separate secrets. */
export function vaultTag(app: App): string {
	let h = 0x811c9dc5;
	for (const ch of app.vault.getName()) {
		h ^= ch.codePointAt(0) ?? 0;
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h.toString(16).padStart(8, "0");
}

/**
 * Values that must stay on this device and out of the synced vault: Obsidian's secret storage
 * when the app has it, otherwise this vault's local storage. `prefix` is put in front of every name.
 */
export function deviceSecrets(app: App, prefix = ""): SecretStore {
	const st = app as unknown as AppWithStorage;
	const fallbackKey = (id: string) => `${app.vault.getName()}:${id}`;
	return {
		get(name) {
			const id = prefix + name;
			try {
				let raw: unknown = null;
				if (st.secretStorage) raw = st.secretStorage.getSecret(id);
				if (!raw && st.loadLocalStorage) raw = st.loadLocalStorage(id);
				if (!raw) raw = window.localStorage.getItem(fallbackKey(id));
				return typeof raw === "string" && raw ? raw : null;
			} catch {
				return null;
			}
		},
		set(name, value) {
			const id = prefix + name;
			try {
				if (st.secretStorage) st.secretStorage.setSecret(id, value);
				else if (st.saveLocalStorage) st.saveLocalStorage(id, value || null);
				else if (value) window.localStorage.setItem(fallbackKey(id), value);
				else window.localStorage.removeItem(fallbackKey(id));
				return true;
			} catch (e) {
				console.error("Block Draw: could not store a secret on this device", e);
				return false;
			}
		},
	};
}
