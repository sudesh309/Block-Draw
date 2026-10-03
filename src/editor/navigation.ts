import { frameLink, parseLink } from "../model/links";
import { isBlock, isFrame, type FrameElement } from "../model/types";
import { frameTitleMetrics } from "../render/elements";
import type { Editor } from "./Editor";

/** Moving between frames, and following and editing block links. */

/** Pans/zooms to a frame. Pushes the current view so "Back" can return to it. */
export function navigateToFrame(ed: Editor, frameId: string, opts: { remember?: boolean; select?: boolean; animate?: boolean } = {}): boolean {
	const frame = ed.byId.get(frameId);
	if (!isFrame(frame)) {
		ed.host.notice("That frame no longer exists.");
		return false;
	}
	if (opts.remember !== false) {
		ed.navStack.push({ ...ed.vp });
		if (ed.navStack.length > 50) ed.navStack.shift();
	}
	const t = frameTitleMetrics(frame, 1);
	ed.zoomToBounds({ x: frame.x, y: t.y - t.size, width: frame.width, height: frame.height + (frame.y - t.y + t.size) }, {
		animate: opts.animate,
		padding: 40,
		maxZoom: 1,
	});
	if (opts.select) ed.selection = new Set([frame.id]);
	ed.requestRender();
	return true;
}

/** Finds a frame by id or (case-insensitive) title. */
export function findFrame(ed: Editor, ref: string): FrameElement | null {
	const direct = ed.byId.get(ref);
	if (isFrame(direct)) return direct;
	const needle = ref.trim().toLowerCase();
	return ed.frames().find((f) => f.title.trim().toLowerCase() === needle) ?? null;
}

export function navigateBack(ed: Editor): void {
	const vp = ed.navStack.pop();
	if (vp) ed.view.animateTo(vp);
	ed.requestRender();
}

/** Steps to the next/previous frame in frame order. */
export function stepFrame(ed: Editor, delta: 1 | -1): void {
	const frames = ed.frames();
	if (!frames.length) return;
	const size = ed.viewSize();
	const centerWorld = ed.screenToWorld({ x: size.width / 2, y: size.height / 2 });
	let idx = frames.findIndex((f) => ed.selection.has(f.id));
	if (idx < 0) {
		idx = frames.findIndex((f) => centerWorld.x >= f.x && centerWorld.x <= f.x + f.width && centerWorld.y >= f.y && centerWorld.y <= f.y + f.height);
	}
	const next = idx < 0 ? (delta > 0 ? 0 : frames.length - 1) : (idx + delta + frames.length) % frames.length;
	ed.navigateToFrame(frames[next].id, { remember: false, select: true });
}

/** Follows a block's link: frames are navigated in place, other links go to the host. */
export function followLink(ed: Editor, blockId: string, newLeaf = false): void {
	const block = ed.byId.get(blockId);
	if (!isBlock(block) || !block.link) return;
	const parsed = parseLink(block.link);
	if (!parsed) return;
	if (parsed.kind === "frame") ed.navigateToFrame(parsed.frameId);
	else ed.host.openLink(block.link, newLeaf);
}

/** Opens the link picker for a block. */
export async function editLink(ed: Editor, blockId: string): Promise<void> {
	const block = ed.byId.get(blockId);
	if (!isBlock(block)) return;
	const result = await ed.host.pickLink({
		current: block.link,
		frames: ed.frames(),
		ownFrameId: block.frameId,
	});
	if (result === undefined || ed.destroyed) return;
	const fresh = ed.byId.get(blockId);
	if (!isBlock(fresh)) return;
	ed.updateElement(blockId, { link: result });
}

export function linkToFrame(ed: Editor, blockId: string, frameId: string | null): void {
	ed.updateElement(blockId, { link: frameId ? frameLink(frameId) : null });
}

export function describeLink(ed: Editor, link: string | null): string {
	const parsed = parseLink(link);
	if (!parsed) return "";
	if (parsed.kind === "frame") {
		const f = ed.byId.get(parsed.frameId);
		return isFrame(f) ? `Frame: ${f.title}` : "Frame: (missing)";
	}
	if (parsed.kind === "url") return parsed.url;
	return ed.host.describeLink?.(link as string) ?? parsed.display;
}
