import {
	App,
	Notice,
	Platform,
	PluginSettingTab,
	requireApiVersion,
	Setting,
	type SettingDefinitionItem,
	type SliderComponent,
} from "obsidian";
import APPS_SCRIPT_CODE from "../../apps-script/Code.gs";
import { AppsScriptTransport } from "../export/gsheets/transport";
import { getPath, setPath, type SettingDef } from "../kernel/settings";
import { GOOGLE_SCOPE } from "./googleAuth";
import { confirmAppsScriptUrl } from "./exports";
import { obsidianHttp } from "./net";
import type { BlockDrawHost } from "./plugin";
import { settingDef, type BlockDrawSettings, type SettingKey } from "./settings";

const DECLARATIVE_SETTINGS = "1.13.0";

/** One settings row, rendered either declaratively (1.13+) or imperatively (older). */
interface Row {
	name: string;
	desc?: string | DocumentFragment;
	visible?: () => boolean;
	/** Adds the row's controls. The return value is ignored. */
	render?: (setting: Setting) => unknown;
}

interface Group {
	heading: string;
	rows: Row[];
}

/** A text field the row's extra controls can update. */
type TextInput = { setValue(v: string): unknown };

interface RowOptions {
	visible?: () => boolean;
	/** Runs after the value changed and was saved. */
	changed?: () => void;
	/** Adds more controls, such as a button, after the setting's own control. */
	extra?: (setting: Setting, input: TextInput | null) => void;
}

function randomSecret(): string {
	const bytes = new Uint8Array(24);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function steps(intro: string, items: (string | ((li: HTMLElement) => void))[]): DocumentFragment {
	const frag = createFragment();
	frag.createDiv({ text: intro });
	const ol = frag.createEl("ol", { cls: "bd-settings-steps" });
	for (const item of items) {
		const li = ol.createEl("li");
		if (typeof item === "string") li.setText(item);
		else item(li);
	}
	return frag;
}

/** Older Obsidian versions only show a slider's value as a tooltip. */
function showSliderValue(slider: SliderComponent): void {
	if (!requireApiVersion(DECLARATIVE_SETTINGS)) {
		(slider as unknown as { setDynamicTooltip?: () => void }).setDynamicTooltip?.();
	}
}

export class BlockDrawSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: BlockDrawHost,
	) {
		super(app, plugin);
	}

	private get s(): BlockDrawSettings {
		return this.plugin.settings;
	}

	private async save(): Promise<void> {
		await this.plugin.saveSettings();
	}

	/** Re-applies visibility after a setting that others depend on changed. */
	private refresh(): void {
		if (requireApiVersion("1.13.0")) this.refreshDomState();
		else this.renderLegacy();
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return this.groups().map((g) => ({
			type: "group",
			heading: g.heading,
			items: g.rows.map((r) => ({
				name: r.name,
				desc: r.desc,
				visible: r.visible,
				render: (setting: Setting) => {
					r.render?.(setting);
				},
			})),
		}));
	}

	/** Obsidian versions before 1.13 render settings imperatively. */
	display(): void {
		this.renderLegacy();
	}

	private renderLegacy(): void {
		const { containerEl } = this;
		containerEl.empty();
		for (const g of this.groups()) {
			new Setting(containerEl).setName(g.heading).setHeading();
			for (const r of g.rows) {
				if (r.visible && !r.visible()) continue;
				const setting = new Setting(containerEl).setName(r.name);
				if (r.desc) setting.setDesc(r.desc);
				r.render?.(setting);
			}
		}
	}

	/* ---------------------------------------------------------------- rows */

	private groups(): Group[] {
		return [
			{ heading: "Drawings", rows: this.drawingRows() },
			{ heading: "Touch and pen", rows: this.touchRows() },
			{ heading: "Export", rows: this.exportRows() },
			{ heading: "Google Sheets", rows: this.sheetsRows() },
		];
	}

	/** A row whose name, description and control come from its entry in the SETTINGS table. */
	private row(key: SettingKey, opts: RowOptions = {}): Row {
		const def = settingDef(key);
		return {
			name: def.name,
			desc: this.describe(def),
			visible: opts.visible,
			render: (st) => {
				// Two statements on purpose: in `opts.extra?.(st, this.control(...))` a row without
				// extras would never get its control, because an optional call skips its arguments.
				const input = this.control(st, def, opts.changed);
				opts.extra?.(st, input);
			},
		};
	}

	/** A secret's row also says where the secret is kept. */
	private describe(def: SettingDef): string | undefined {
		if (def.type !== "secret") return def.desc;
		const where = this.plugin.isSecretInVault(def.key)
			? "This device cannot keep secrets outside the vault, so it is saved in the plugin's data.json."
			: "Kept on this device only, not in the vault: enter it once on each device.";
		return def.desc ? `${def.desc} ${where}` : where;
	}

	private async changeSetting(def: SettingDef, value: unknown, changed?: () => void): Promise<void> {
		setPath(this.s as unknown as Record<string, unknown>, def.key, value);
		await this.save();
		changed?.();
	}

	/** Adds the control for a setting's type. Returns the text field, for text-like settings. */
	private control(st: Setting, def: SettingDef, changed?: () => void): TextInput | null {
		const value = getPath(this.s, def.key);
		switch (def.type) {
			case "text":
			case "folder":
			case "secret": {
				let input: TextInput | null = null;
				st.addText((t) => {
					input = t;
					if (def.type === "secret") t.inputEl.type = "password";
					else if (def.placeholder) t.setPlaceholder(def.placeholder);
					const empty = def.type === "secret" ? "" : (def.emptyAs ?? "");
					t.setValue(typeof value === "string" ? value : "").onChange((v) => this.changeSetting(def, v.trim() || empty, changed));
				});
				return input;
			}
			case "toggle":
				st.addToggle((t) => t.setValue(value === true).onChange((v) => this.changeSetting(def, v, changed)));
				return null;
			case "slider":
				st.addSlider((sl) => {
					sl.setLimits(def.min, def.max, def.step)
						.setValue(typeof value === "number" ? value : def.default)
						.onChange((v) => this.changeSetting(def, v, changed));
					showSliderValue(sl);
				});
				return null;
			case "choice":
				st.addDropdown((d) => {
					for (const o of def.options) d.addOption(o.value, o.label);
					d.setValue(typeof value === "string" ? value : def.default).onChange((v) => this.changeSetting(def, v, changed));
				});
				return null;
		}
	}

	private drawingRows(): Row[] {
		return [this.row("newFileFolder"), this.row("newFilePrefix"), this.row("gridSize"), this.row("snapToGrid"), this.row("showGrid"), this.row("webFonts")];
	}

	private touchRows(): Row[] {
		return [this.row("tabletMode")];
	}

	private exportRows(): Row[] {
		return [this.row("exportFolder"), this.row("jsonFormat")];
	}

	private sheetsRows(): Row[] {
		const s = this.s;
		const appsScript = () => s.sheets.method === "apps-script";
		const oauth = () => s.sheets.method === "oauth";
		return [
			{
				name: "How it works",
				desc: "Every frame becomes a tab of one workbook: blocks are drawn with cells, connections with cell borders, and blocks that link to a frame link to that frame's tab. An index tab and tables of all blocks and connections are added too.",
			},
			this.row("sheets.method", { changed: () => this.refresh() }),
			...this.appsScriptRows(appsScript),
			...this.oauthRows(oauth),
			this.row("sheets.cellSize"),
			this.row("sheets.cellPixels"),
			this.row("sheets.includeIndex"),
			this.row("sheets.includeDataSheets"),
			this.row("sheets.includeUnframed"),
			this.row("sheets.updateExisting"),
			this.row("sheets.openAfterExport"),
		];
	}

	private appsScriptRows(visible: () => boolean): Row[] {
		const s = this.s;
		return [
			{
				name: "Apps Script setup",
				visible,
				desc: steps("One-time setup, about three minutes:", [
					"Generate a secret below, then copy the bridge code.",
					"Open Apps Script, create a project and replace its code with the bridge code.",
					"In the editor sidebar, add the Google Sheets API service.",
					"Deploy it as a web app that executes as you and that anyone can access, then authorize it.",
					"Paste the web app address below and test the connection.",
				]),
			},
			this.row("sheets.appsScriptSecret", {
				visible,
				extra: (st, input) => {
					st.addButton((b) =>
						b.setButtonText("Generate").onClick(async () => {
							s.sheets.appsScriptSecret = randomSecret();
							input?.setValue(s.sheets.appsScriptSecret);
							await this.save();
							new Notice("A new secret was generated. Copy the bridge code again so it includes it.");
						}),
					);
				},
			}),
			{
				name: "Bridge code",
				visible,
				desc: "The Apps Script code to paste into your project, with your secret filled in. It is also in the plugin repository.",
				render: (st) =>
					st
						.addButton((b) =>
							b.setButtonText("Copy code").onClick(async () => {
								const secret = s.sheets.appsScriptSecret;
								const code = secret
									? APPS_SCRIPT_CODE.replace("'change-me-to-a-long-random-string'", `'${secret}'`)
									: APPS_SCRIPT_CODE;
								await navigator.clipboard.writeText(code);
								new Notice(secret ? "Bridge code copied, with your secret filled in." : "Bridge code copied. Generate a secret first to have it filled in.");
							}),
						)
						.addButton((b) =>
							b.setButtonText("Open Apps Script").onClick(() => window.open("https://script.google.com/home/projects/create")),
						),
			},
			this.row("sheets.appsScriptUrl", {
				visible,
				extra: (st) => {
					st.addButton((b) =>
						b.setButtonText("Test").onClick(async () => {
							if (!s.sheets.appsScriptUrl) {
								new Notice("Enter the web app address first.");
								return;
							}
							try {
								await confirmAppsScriptUrl(this.app, s.sheets.appsScriptUrl);
								const res = await new AppsScriptTransport(s.sheets.appsScriptUrl, s.sheets.appsScriptSecret, obsidianHttp).ping();
								new Notice(`Connected to the Block Draw bridge${res.user ? ` as ${res.user}` : ""}.`);
							} catch (e) {
								new Notice(`Connection failed: ${(e as Error).message}`, 10000);
							}
						}),
					);
				},
			}),
		];
	}

	private oauthRows(visible: () => boolean): Row[] {
		const auth = this.plugin.auth;
		return [
			{
				name: "Google account setup",
				visible,
				desc: steps(
					Platform.isDesktopApp
						? "One-time setup in the Google Cloud console:"
						: "Signing in with a Google account only works in the desktop app. Use the Apps Script bridge on mobile.",
					[
						"Create a project and enable the Google Sheets API.",
						"Configure the consent screen for external users, add yourself as a test user, then publish it to avoid signing in again every week.",
						"Create an OAuth client ID for a desktop app and paste its ID and secret below.",
						(li) => {
							li.appendText("Sign in. Block Draw only asks for ");
							li.createEl("code", { text: GOOGLE_SCOPE.replace("https://www.googleapis.com/auth/", "") });
							li.appendText(", which gives access to the spreadsheets it creates and nothing else in your Drive.");
						},
					],
				),
			},
			this.row("sheets.oauthClientId", { visible }),
			this.row("sheets.oauthClientSecret", { visible }),
			{
				name: "Google account",
				visible,
				render: (st) => {
					const draw = () => {
						st.controlEl.empty();
						const signedIn = auth.isSignedIn();
						st.setDesc(signedIn ? "Signed in on this device." : "Not signed in on this device.");
						st.addButton((b) => {
							if (signedIn) {
								b.setButtonText("Sign out").onClick(async () => {
									await auth.signOut();
									draw();
								});
							} else {
								b.setButtonText("Sign in with Google")
									.setCta()
									.setDisabled(!Platform.isDesktopApp)
									.onClick(async () => {
										try {
											new Notice("Finish signing in in your browser…");
											await auth.signIn();
											new Notice("Signed in to Google.");
										} catch (e) {
											new Notice((e as Error).message, 10000);
										}
										draw();
									});
							}
						});
					};
					draw();
				},
			},
		];
	}
}
