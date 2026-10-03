import type { Plugin } from "obsidian";
import type { BlockDrawView } from "./BlockDrawView";
import type { ExportKind } from "./exporters";
import type { GoogleAuth } from "./googleAuth";
import type { BlockDrawSettings } from "./settings";

/**
 * What the drawing views, the note embeds and the settings tab need from the plugin. main.ts
 * implements it, so nothing in obsidian/ has to import main.ts (which imports all of obsidian/).
 */
export interface BlockDrawHost extends Plugin {
	settings: BlockDrawSettings;
	readonly auth: GoogleAuth;
	saveSettings(): Promise<void>;
	/** True when this device could not take the secret and it stays in data.json. */
	isSecretInVault(key: string): boolean;
	runExport(view: BlockDrawView, kind: ExportKind, frameId?: string | null): Promise<void>;
}
