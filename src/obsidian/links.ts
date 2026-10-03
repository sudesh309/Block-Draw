import { Notice, type App } from "obsidian";
import { confirmAction } from "./confirm";

export type LinkAction = "open" | "ask" | "refuse";

const schemeOf = (url: string) => /^([a-z][a-z0-9+.-]*):/i.exec(url.trim())?.[1].toLowerCase() ?? null;

/**
 * What Block Draw does with an external link from a drawing: web and mail links open, obsidian://
 * links open after asking, anything else is refused. A drawing can come from someone else, and
 * links such as file:// can start other programs.
 */
export function linkAction(url: string): LinkAction {
	const scheme = schemeOf(url);
	if (scheme === "http" || scheme === "https" || scheme === "mailto") return "open";
	if (scheme === "obsidian") return "ask";
	return "refuse";
}

/** Opens an external link according to linkAction(). */
export async function openExternal(app: App, url: string): Promise<void> {
	const target = url.trim();
	const action = linkAction(target);
	if (action === "refuse") {
		new Notice(`Links that start with “${schemeOf(target) ?? target}:” are not opened, because they can start other programs. Web, mail and Obsidian links work.`);
		return;
	}
	if (action === "ask") {
		const yes = await confirmAction(app, {
			title: "Open this Obsidian link?",
			message: "It comes from the drawing, which may have been made by someone else. Obsidian links can open notes and run actions.",
			detail: target,
			confirm: "Open",
		});
		if (!yes) return;
	}
	window.open(target);
}
