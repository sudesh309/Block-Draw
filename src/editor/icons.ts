import { svgEl } from "./dom";

/**
 * Small line icons (24×24, stroke based) bundled with the editor so it renders the same in
 * every Obsidian version and in the test harness.
 */
const ICONS: Record<string, string> = {
	select: "M5 4 L11.5 20 L13.6 13.6 L20 11.5 Z",
	pan: "M12 3v18 M3 12h18 M12 3l-3 3 M12 3l3 3 M12 21l-3-3 M12 21l3-3 M3 12l3-3 M3 12l3 3 M21 12l-3-3 M21 12l-3 3",
	block: "M6 6h12a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3z",
	ellipse: "M12 6c4.97 0 9 2.69 9 6s-4.03 6-9 6-9-2.69-9-6 4.03-6 9-6z",
	diamond: "M12 3l9 9-9 9-9-9z",
	connector: "M5 19L19 5 M11 5h8v8",
	frame: "M21 7H3 M21 17H3 M7 3v18 M17 3v18",
	undo: "M9 14L4 9l5-5 M4 9h11a5 5 0 0 1 0 10h-3",
	redo: "M15 14l5-5-5-5 M20 9H9a5 5 0 0 0 0 10h3",
	export: "M12 3v12 M7 10l5 5 5-5 M5 21h14",
	frames: "M4 6h16 M4 12h16 M4 18h10",
	"zoom-in": "M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14z M21 21l-5-5 M11 8v6 M8 11h6",
	"zoom-out": "M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14z M21 21l-5-5 M8 11h6",
	fit: "M3 8V3h5 M21 8V3h-5 M3 16v5h5 M21 16v5h-5",
	back: "M19 12H5 M11 18l-6-6 6-6",
	grid: "M4 4h16v16H4z M4 10h16 M4 15h16 M10 4v16 M15 4v16",
	snap: "M6 4v7a6 6 0 0 0 12 0V4 M6 4h4v7 M14 4h4 M14 4v7",
	help: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4v.8 M12 17h.01",
	trash: "M4 7h16 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3",
	link: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7 M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
	unlink: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7 M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7 M3 3l18 18",
	"follow-link": "M14 4h6v6 M20 4l-9 9 M18 14v6H4V6h6",
	duplicate: "M8 8h12v12H8z M4 16V4h12",
	front: "M12 3l9 5-9 5-9-5z M3 13l9 5 9-5",
	back_layer: "M12 21l9-5-9-5-9 5z M3 11l9-5 9 5",
	more: "M5 12h.01 M12 12h.01 M19 12h.01",
	close: "M6 6l12 12 M18 6L6 18",
	plus: "M12 5v14 M5 12h14",
	up: "M12 19V5 M6 11l6-6 6 6",
	down: "M12 5v14 M6 13l6 6 6-6",
	edit: "M4 20h4L19 9l-4-4L4 16z",
	"align-left": "M4 3v18 M7 7h11v4H7z M7 14h7v4H7z",
	"align-center": "M12 3v18 M6 7h12v4H6z M8 14h8v4H8z",
	"align-right": "M20 3v18 M6 7h11v4H6z M10 14h7v4h-7z",
	"align-top": "M3 4h18 M7 7h4v11H7z M14 7h4v7h-4z",
	"align-middle": "M3 12h18 M7 6h4v12H7z M14 8h4v8h-4z",
	"align-bottom": "M3 20h18 M7 6h4v11H7z M14 10h4v7h-4z",
	"distribute-h": "M4 3v18 M20 3v18 M10 8h4v8h-4z",
	"distribute-v": "M3 4h18 M3 20h18 M8 10h8v4H8z",
	"text-left": "M4 6h16 M4 12h10 M4 18h14",
	"text-center": "M4 6h16 M7 12h10 M5 18h14",
	"text-right": "M4 6h16 M10 12h10 M6 18h14",
	"valign-top": "M4 4h16v16H4z M8 8h8 M8 11h5",
	"valign-middle": "M4 4h16v16H4z M8 10.5h8 M8 13.5h5",
	"valign-bottom": "M4 4h16v16H4z M8 13h8 M8 16h5",
	sheet: "M4 4h16v16H4z M4 9h16 M4 14h16 M10 9v11",
	json: "M8 4c-2 0-3 1-3 3v2c0 1.5-1 2-2 2 1 0 2 .5 2 2v2c0 2 1 3 3 3 M16 4c2 0 3 1 3 3v2c0 1.5 1 2 2 2-1 0-2 .5-2 2v2c0 2-1 3-3 3",
	image: "M4 4h16v16H4z M4 16l5-5 4 4 3-3 4 4 M15 8.5h.01",
	present: "M3 4h18v12H3z M10 7.5v5l4.5-2.5z M8 20h8 M12 16v4",
	next: "M5 12h14 M13 6l6 6-6 6",
	stage: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M12 3v18 M12 7a5 5 0 0 1 0 10",
	trace: "M6 3v6 M6 15v6 M18 9a3 3 0 1 0 0-.01 M6 12a3 3 0 1 0 0-.01 M9 12h3a6 6 0 0 0 6-3",
	cube: "M12 3l8 4.5v9L12 21l-8-4.5v-9z M12 12l8-4.5 M12 12v9 M12 12L4 7.5",
	eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z M12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5z",
	"eye-off": "M3 3l18 18 M10.6 6.1A9.6 9.6 0 0 1 12 6c6.5 0 10 6 10 6a17.5 17.5 0 0 1-3.2 4 M6.7 7.7A17.2 17.2 0 0 0 2 12s3.5 7 10 7a9.4 9.4 0 0 0 4.3-1 M9.9 9.9a3 3 0 0 0 4.2 4.2",
	eraser: "M7 21l-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21 M22 21H7 M5 11l9 9",
	sliders: "M21 4h-7 M10 4H3 M21 12h-9 M8 12H3 M21 20h-5 M12 20H3 M14 2v4 M8 10v4 M16 18v4",
	palette: "M12 3a9 9 0 1 0 0 18c1.1 0 1.5-.8 1.5-1.5 0-.9-.7-1.2-.7-2.1 0-.8.7-1.4 1.5-1.4H17a4 4 0 0 0 4-4c0-5-4-9-9-9z M7.5 11h.01 M10 7h.01 M14.5 7h.01 M17 11h.01",
};

export type IconName = string;

export function createIcon(name: IconName, size = 18): SVGSVGElement {
	const svg = svgEl("svg", {
		viewBox: "0 0 24 24",
		width: size,
		height: size,
		fill: "none",
		stroke: "currentColor",
		"stroke-width": 2,
		"stroke-linecap": "round",
		"stroke-linejoin": "round",
		class: "bd-icon",
		"aria-hidden": "true",
	});
	svgEl("path", { d: ICONS[name] ?? ICONS.more }, svg);
	return svg;
}

export function setIconEl(target: HTMLElement, name: IconName, size?: number): void {
	while (target.firstChild) target.removeChild(target.firstChild);
	target.appendChild(createIcon(name, size));
}
