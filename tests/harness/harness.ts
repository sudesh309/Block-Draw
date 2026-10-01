/**
 * Browser harness: mounts the editor without Obsidian so it can be driven by Playwright.
 * Exposes the editor and a log of host calls on `window.bd`.
 */
import { Editor } from "../../src/editor/Editor";
import type { EditorHost, LinkPickOptions, MenuItemSpec } from "../../src/editor/host";
import { parseDrawing, serializeDrawing } from "../../src/model/file";
import { exportStructuredJson } from "../../src/export/json";
import { sceneToSvg } from "../../src/render/scene";
import { LIGHT_THEME } from "../../src/render/colors";

interface HarnessState {
	editor: Editor;
	notices: string[];
	opened: { link: string; newLeaf: boolean }[];
	menus: string[][];
	changes: number;
	nextPick: string | null | undefined;
	pickCalls: LinkPickOptions[];
	clickMenu(title: string): boolean;
	serialize(): string;
	load(text: string): void;
	structuredJson(): unknown;
	svg(frameId?: string): string;
}

declare global {
	interface Window {
		bd: HarnessState;
	}
}

let menuEl: HTMLDivElement | null = null;
let currentMenu: MenuItemSpec[] = [];

function closeMenu() {
	menuEl?.remove();
	menuEl = null;
	currentMenu = [];
}

const state = {
	notices: [] as string[],
	opened: [] as { link: string; newLeaf: boolean }[],
	menus: [] as string[][],
	changes: 0,
	nextPick: undefined as string | null | undefined,
	pickCalls: [] as LinkPickOptions[],
};

const host: EditorHost = {
	isMac: false,
	showMenu(items, pos) {
		closeMenu();
		currentMenu = items;
		state.menus.push(items.map((i) => i.title));
		menuEl = document.createElement("div");
		menuEl.className = "harness-menu";
		menuEl.style.left = `${pos.x}px`;
		menuEl.style.top = `${pos.y}px`;
		for (const item of items) {
			if (item.separator) menuEl.appendChild(document.createElement("hr"));
			const row = document.createElement("div");
			row.className = "harness-menu-item";
			row.textContent = (item.checked ? "✓ " : "") + item.title;
			row.addEventListener("click", () => {
				closeMenu();
				item.onClick();
			});
			menuEl.appendChild(row);
		}
		document.body.appendChild(menuEl);
	},
	notice(message) {
		state.notices.push(message);
	},
	openLink(link, newLeaf) {
		state.opened.push({ link, newLeaf });
	},
	async pickLink(options) {
		state.pickCalls.push(options);
		return state.nextPick;
	},
	describeLink(link) {
		return link.replace(/^\[\[|\]\]$/g, "");
	},
	exportMenu() {
		return [
			{ title: "Export JSON", icon: "json", onClick: () => state.notices.push("export-json") },
			{ title: "Export to Google Sheets", icon: "sheet", onClick: () => state.notices.push("export-gsheet") },
		];
	},
};

document.addEventListener("pointerdown", (e) => {
	if (menuEl && !menuEl.contains(e.target as Node)) closeMenu();
});

const app = document.getElementById("app") as HTMLElement;
const editor = new Editor(app, host, { gridSize: 20, snapToGrid: true, showGrid: true });
editor.onChange = () => {
	state.changes++;
};
editor.focus();

window.bd = Object.assign(state, {
	editor,
	clickMenu(title: string) {
		const item = currentMenu.find((i) => i.title === title);
		if (!item) return false;
		closeMenu();
		item.onClick();
		return true;
	},
	serialize() {
		return serializeDrawing({ type: "block-draw", version: 1, elements: [...editor.getElements()] });
	},
	load(text: string) {
		editor.load(parseDrawing(text).elements);
	},
	structuredJson() {
		return exportStructuredJson({ type: "block-draw", version: 1, elements: [...editor.getElements()] }, { name: "Harness" });
	},
	svg(frameId?: string) {
		return sceneToSvg(editor.getElements(), { theme: LIGHT_THEME, frameId }).svg;
	},
});
