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
import { GOOGLE_SCOPE } from "./googleAuth";
import { obsidianHttp } from "./exports";
import type BlockDrawPlugin from "../main";
import type { BlockDrawSettings, SheetsMethod } from "./settings";

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
		private readonly plugin: BlockDrawPlugin,
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
			{ heading: "Export", rows: this.exportRows() },
			{ heading: "Google Sheets", rows: this.sheetsRows() },
		];
	}

	private drawingRows(): Row[] {
		const s = this.s;
		return [
			{
				name: "Folder for new drawings",
				desc: "Leave empty to use the default location for new notes.",
				render: (st) =>
					st.addText((t) =>
						t
							.setPlaceholder("Drawings")
							.setValue(s.newFileFolder)
							.onChange(async (v) => {
								s.newFileFolder = v.trim();
								await this.save();
							}),
					),
			},
			{
				name: "File name prefix",
				desc: "New drawings are named with this prefix followed by the date and time.",
				render: (st) =>
					st.addText((t) =>
						t.setValue(s.newFilePrefix).onChange(async (v) => {
							s.newFilePrefix = v.trim() || "Drawing";
							await this.save();
						}),
					),
			},
			{
				name: "Grid size",
				desc: "Spacing of the background grid and of snapping, in pixels at 100% zoom.",
				render: (st) =>
					st.addSlider((sl) => {
						sl.setLimits(5, 50, 5)
							.setValue(s.gridSize)
							.onChange(async (v) => {
								s.gridSize = v;
								await this.save();
							});
						showSliderValue(sl);
					}),
			},
			{
				name: "Snap to grid",
				render: (st) =>
					st.addToggle((t) =>
						t.setValue(s.snapToGrid).onChange(async (v) => {
							s.snapToGrid = v;
							await this.save();
						}),
					),
			},
			{
				name: "Show grid",
				render: (st) =>
					st.addToggle((t) =>
						t.setValue(s.showGrid).onChange(async (v) => {
							s.showGrid = v;
							await this.save();
						}),
					),
			},
			{
				name: "Load web fonts from Google Fonts",
				desc: "Off: Block Draw never contacts Google for fonts, and uses the fonts installed on your device. On: Inter, Roboto, Open Sans, Montserrat and Lato are downloaded so they show everywhere, and exported SVG files load them too (PNG images always use installed fonts).",
				render: (st) =>
					st.addToggle((t) =>
						t.setValue(s.webFonts).onChange(async (v) => {
							s.webFonts = v;
							await this.save();
						}),
					),
			},
		];
	}

	private exportRows(): Row[] {
		const s = this.s;
		return [
			{
				name: "Export folder",
				desc: "Where JSON, Excel, SVG and PNG exports are saved. Leave empty to save next to the drawing.",
				render: (st) =>
					st.addText((t) =>
						t
							.setPlaceholder("Exports")
							.setValue(s.exportFolder)
							.onChange(async (v) => {
								s.exportFolder = v.trim();
								await this.save();
							}),
					),
			},
			{
				name: "JSON format",
				desc: "Structured: frames with their blocks and connections, links resolved. Raw: the drawing file itself.",
				render: (st) =>
					st.addDropdown((d) =>
						d
							.addOption("structured", "Structured")
							.addOption("raw", "Raw drawing")
							.setValue(s.jsonFormat)
							.onChange(async (v) => {
								s.jsonFormat = v as typeof s.jsonFormat;
								await this.save();
							}),
					),
			},
		];
	}

	private sheetsRows(): Row[] {
		const s = this.s;
		const appsScript = () => s.sheets.method === "apps-script";
		const oauth = () => s.sheets.method === "oauth";
		const toggle = (
			name: string,
			desc: string,
			key: "includeIndex" | "includeDataSheets" | "includeUnframed" | "updateExisting" | "openAfterExport",
		): Row => ({
			name,
			desc,
			render: (st) =>
				st.addToggle((t) =>
					t.setValue(s.sheets[key]).onChange(async (v) => {
						s.sheets[key] = v;
						await this.save();
					}),
				),
		});
		return [
			{
				name: "How it works",
				desc: "Every frame becomes a tab of one workbook: blocks are drawn with cells, connections with cell borders, and blocks that link to a frame link to that frame's tab. An index tab and tables of all blocks and connections are added too.",
			},
			{
				name: "Connection method",
				desc: "The Apps Script bridge needs no Google Cloud project and also works on mobile. Signing in with a Google account calls the Google Sheets API directly (desktop only).",
				render: (st) =>
					st.addDropdown((d) =>
						d
							.addOption("apps-script", "Apps Script web app")
							.addOption("oauth", "Google account")
							.setValue(s.sheets.method)
							.onChange(async (v) => {
								s.sheets.method = v as SheetsMethod;
								await this.save();
								this.refresh();
							}),
					),
			},
			...this.appsScriptRows(appsScript),
			...this.oauthRows(oauth),
			{
				name: "Cell size",
				desc: "Canvas pixels represented by one spreadsheet cell. Larger values make smaller sheets.",
				render: (st) =>
					st.addSlider((sl) => {
						sl.setLimits(10, 60, 5)
							.setValue(s.sheets.cellSize)
							.onChange(async (v) => {
								s.sheets.cellSize = v;
								await this.save();
							});
						showSliderValue(sl);
					}),
			},
			{
				name: "Cell width in the sheet",
				desc: "Width and height of each grid cell in the spreadsheet, in pixels.",
				render: (st) =>
					st.addSlider((sl) => {
						sl.setLimits(10, 40, 2)
							.setValue(s.sheets.cellPixels)
							.onChange(async (v) => {
								s.sheets.cellPixels = v;
								await this.save();
							});
						showSliderValue(sl);
					}),
			},
			toggle("Index tab", "A first tab listing every frame with a link to its tab.", "includeIndex"),
			toggle("Block and connection tables", "Tabs listing every block and connection as filterable rows.", "includeDataSheets"),
			toggle("Blocks outside frames", "Put blocks that are not inside a frame on a separate tab named canvas.", "includeUnframed"),
			toggle(
				"Update the same spreadsheet",
				"Exporting a drawing again replaces the tabs it created before instead of making a new spreadsheet. Tabs you added yourself are kept.",
				"updateExisting",
			),
			toggle("Open after export", "Open the spreadsheet in your browser when the export finishes.", "openAfterExport"),
		];
	}

	private appsScriptRows(visible: () => boolean): Row[] {
		const s = this.s;
		let secretInput: { setValue(v: string): unknown } | null = null;
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
			{
				name: "Apps Script secret",
				visible,
				desc: "Shared with the bridge code so only this plugin can use your web app.",
				render: (st) =>
					st
						.addText((t) => {
							secretInput = t;
							t.inputEl.type = "password";
							t.setValue(s.sheets.appsScriptSecret).onChange(async (v) => {
								s.sheets.appsScriptSecret = v.trim();
								await this.save();
							});
						})
						.addButton((b) =>
							b.setButtonText("Generate").onClick(async () => {
								s.sheets.appsScriptSecret = randomSecret();
								secretInput?.setValue(s.sheets.appsScriptSecret);
								await this.save();
								new Notice("A new secret was generated. Copy the bridge code again so it includes it.");
							}),
						),
			},
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
			{
				name: "Web app address",
				visible,
				desc: "The deployment URL, ending in /exec.",
				render: (st) =>
					st
						.addText((t) =>
							t
								.setPlaceholder("https://script.google.com/macros/s/…/exec")
								.setValue(s.sheets.appsScriptUrl)
								.onChange(async (v) => {
									s.sheets.appsScriptUrl = v.trim();
									await this.save();
								}),
						)
						.addButton((b) =>
							b.setButtonText("Test").onClick(async () => {
								if (!s.sheets.appsScriptUrl) {
									new Notice("Enter the web app address first.");
									return;
								}
								try {
									const res = await new AppsScriptTransport(s.sheets.appsScriptUrl, s.sheets.appsScriptSecret, obsidianHttp).ping();
									new Notice(`Connected to the Block Draw bridge${res.user ? ` as ${res.user}` : ""}.`);
								} catch (e) {
									new Notice(`Connection failed: ${(e as Error).message}`, 10000);
								}
							}),
						),
			},
		];
	}

	private oauthRows(visible: () => boolean): Row[] {
		const s = this.s;
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
			{
				name: "OAuth client ID",
				visible,
				render: (st) =>
					st.addText((t) =>
						t.setValue(s.sheets.oauthClientId).onChange(async (v) => {
							s.sheets.oauthClientId = v.trim();
							await this.save();
						}),
					),
			},
			{
				name: "OAuth client secret",
				visible,
				render: (st) =>
					st.addText((t) => {
						t.inputEl.type = "password";
						t.setValue(s.sheets.oauthClientSecret).onChange(async (v) => {
							s.sheets.oauthClientSecret = v.trim();
							await this.save();
						});
					}),
			},
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
