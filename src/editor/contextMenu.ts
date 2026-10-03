import type { Point } from "../geometry/geom";
import { DRAWING_THEMES } from "../model/themes";
import { isBlock, isConnector, isFrame, type Routing } from "../model/types";
import type { Editor } from "./Editor";
import type { MenuItemSpec } from "./host";

/** The right-click menu: what can be done with the selection, or with the canvas when nothing is selected. */
export function showContextMenu(ed: Editor, screen: { x: number; y: number }, world: Point): void {
	const items: MenuItemSpec[] = [];
	const sel = ed.selectedElements();
	const blocks = sel.filter(isBlock);
	const frames = sel.filter(isFrame);
	const connectors = sel.filter(isConnector);
	const ro = ed.options.readOnly;

	if (sel.length === 0) {
		if (!ro) {
			items.push({ title: "Add block here", icon: "block", onClick: () => ed.addBlockAt(world) });
			items.push({
				title: "Add frame here",
				icon: "frame",
				onClick: () => {
					const p = ed.snapPoint(world);
					ed.addFrame({ x: p.x, y: p.y, width: 480, height: 320 }, { edit: true });
				},
			});
			items.push({ title: "Paste", icon: "duplicate", onClick: () => void ed.clipboard.pasteFromSystem(world), separator: true });
			items.push({ title: "Select all", onClick: () => ed.selectAll() });
		}
		items.push({ title: "Zoom to fit", icon: "fit", onClick: () => ed.zoomToFit({ animate: true }), separator: true });
		items.push({ title: "Present", icon: "present", onClick: () => ed.presenter.start() });
		if (!ro) {
			DRAWING_THEMES.forEach((t, i) => {
				items.push({
					title: `Theme: ${t.name}`,
					icon: "palette",
					onClick: () => ed.applyTheme(t.id),
					...(i === 0 ? { separator: true } : {}),
				});
			});
			const allOn = ed.elements.length > 0 && ed.elements.filter((e) => isBlock(e) || isConnector(e)).every((e) => e.style.threeD);
			items.push({ title: "3D effect", icon: "cube", checked: allOn, onClick: () => ed.toggle3D() });
		}
		items.push({
			separator: true,
			title: "Show grid",
			icon: "grid",
			checked: ed.options.showGrid,
			onClick: () => ed.setOptions({ showGrid: !ed.options.showGrid }),
		});
		items.push({
			title: "Snap to grid",
			icon: "snap",
			checked: ed.options.snapToGrid,
			onClick: () => ed.setOptions({ snapToGrid: !ed.options.snapToGrid }),
		});
		ed.host.showMenu(items, screen);
		return;
	}

	if (blocks.length === 1 && sel.length === 1) {
		const b = blocks[0];
		if (b.link) items.push({ title: `Open link (${ed.describeLink(b.link)})`, icon: "follow-link", onClick: () => ed.followLink(b.id) });
		items.push({
			title: ed.traceRootId === b.id ? "Hide dependencies" : "Trace dependencies",
			icon: "trace",
			onClick: () => ed.toggleTrace(b.id),
		});
		if (!ro) {
			items.push({ title: "Edit text", icon: "edit", onClick: () => ed.textEditor.start(b.id) });
			items.push({ title: b.link ? "Change link…" : "Link to frame or note…", icon: "link", onClick: () => void ed.editLink(b.id) });
			if (b.link) items.push({ title: "Remove link", icon: "unlink", onClick: () => ed.updateElement(b.id, { link: null }) });
			if (b.description.trim()) {
				items.push({ title: b.descriptionOpen ? "Hide description" : "Show description", onClick: () => ed.toggleDescription(b.id) });
			}
			if (b.comment) {
				items.push({ title: b.commentOpen ? "Hide comment" : "Show comment", onClick: () => ed.toggleComment(b.id) });
				items.push({ title: "Remove comment", onClick: () => ed.updateElement(b.id, { comment: "", commentOpen: false }) });
			}
		}
	}
	if (frames.length === 1 && sel.length === 1) {
		const f = frames[0];
		items.push({ title: "Zoom to frame", icon: "fit", onClick: () => ed.navigateToFrame(f.id) });
		if (!ro) items.push({ title: "Rename frame", icon: "edit", onClick: () => ed.textEditor.start(f.id) });
	}
	if (connectors.length === 1 && sel.length === 1 && !ro) {
		const c = connectors[0];
		items.push({ title: c.label ? "Edit label" : "Add label", icon: "edit", onClick: () => ed.textEditor.start(c.id) });
		if (c.comment) {
			items.push({ title: c.commentOpen ? "Hide comment" : "Show comment", onClick: () => ed.toggleComment(c.id) });
			items.push({ title: "Remove comment", onClick: () => ed.updateElement(c.id, { comment: "", commentOpen: false }) });
		}
		items.push({ title: "Reverse direction", onClick: () => ed.reverseConnector(c.id) });
		for (const r of ["elbow", "straight", "curved"] as Routing[]) {
			items.push({
				title: `${r[0].toUpperCase()}${r.slice(1)} line`,
				checked: c.routing === r,
				onClick: () => ed.applyRouting(r),
				separator: r === "elbow",
			});
		}
	}
	if (!ro) {
		if (blocks.length || connectors.length) {
			const allOn = [...blocks, ...connectors].every((e) => e.style.threeD);
			items.push({ title: "3D effect", icon: "cube", checked: allOn, onClick: () => ed.toggle3D(), separator: true });
		}
		items.push({ title: "Duplicate", icon: "duplicate", onClick: () => ed.duplicateSelection(), separator: true });
		items.push({
			title: "Copy",
			onClick: () => {
				const text = ed.clipboard.copySelectionText();
				if (text) void navigator.clipboard?.writeText(text).catch(() => undefined);
			},
		});
		items.push({ title: "Bring to front", icon: "front", onClick: () => ed.reorderSelection("front"), separator: true });
		items.push({ title: "Send to back", icon: "back_layer", onClick: () => ed.reorderSelection("back") });
		items.push({ title: "Delete", icon: "trash", warning: true, onClick: () => ed.deleteSelection(), separator: true });
	}
	ed.host.showMenu(items, screen);
}
