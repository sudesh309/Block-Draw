import { COLOR_DEFAULT, COLOR_TRANSPARENT } from "../../model/types";
import { toHex6 } from "../../render/colors";
import { activeElementOf, el, svgEl } from "../dom";
import { createIcon, type IconName } from "../icons";

export function iconButton(
	parent: HTMLElement,
	icon: IconName,
	label: string,
	onClick: (e: MouseEvent) => void,
	cls = "",
): HTMLButtonElement {
	const btn = el("button", `bd-btn clickable-icon ${cls}`.trim(), parent);
	btn.type = "button";
	btn.setAttribute("aria-label", label);
	btn.title = label;
	btn.appendChild(createIcon(icon));
	btn.addEventListener("click", (e) => {
		e.preventDefault();
		onClick(e);
	});
	// Keep keyboard focus on the canvas so shortcuts keep working.
	btn.addEventListener("pointerdown", (e) => e.preventDefault());
	return btn;
}

export function section(parent: HTMLElement, label: string): HTMLDivElement {
	const wrap = el("div", "bd-section", parent);
	el("div", "bd-section-label", wrap, label);
	return el("div", "bd-section-body", wrap);
}

export interface SegmentOption<T> {
	value: T;
	label: string;
	/** Either an icon name or a function drawing a mini SVG preview. */
	icon?: IconName;
	draw?: (svg: SVGSVGElement) => void;
	text?: string;
}

/** Row of toggle buttons; returns a function that re-syncs the active state. */
export function segmented<T>(
	parent: HTMLElement,
	options: SegmentOption<T>[],
	get: () => T,
	set: (value: T) => void,
): () => void {
	const row = el("div", "bd-segmented", parent);
	const buttons: [T, HTMLButtonElement][] = [];
	for (const opt of options) {
		const btn = el("button", "bd-seg-btn", row);
		btn.type = "button";
		btn.title = opt.label;
		btn.setAttribute("aria-label", opt.label);
		if (opt.draw) {
			const svg = svgEl("svg", { viewBox: "0 0 24 24", width: 20, height: 20, class: "bd-mini" });
			opt.draw(svg);
			btn.appendChild(svg);
		} else if (opt.icon) {
			btn.appendChild(createIcon(opt.icon, 16));
		} else {
			btn.textContent = opt.text ?? opt.label;
		}
		btn.addEventListener("pointerdown", (e) => e.preventDefault());
		btn.addEventListener("click", () => {
			set(opt.value);
			sync();
		});
		buttons.push([opt.value, btn]);
	}
	const sync = () => {
		const current = get();
		for (const [value, btn] of buttons) btn.classList.toggle("is-active", value === current);
	};
	sync();
	return sync;
}

/** Color swatches plus a custom color picker. */
export function swatches(
	parent: HTMLElement,
	colors: string[],
	get: () => string,
	set: (color: string) => void,
	opts: { defaultLabel?: string } = {},
): () => void {
	const row = el("div", "bd-swatches", parent);
	const buttons: [string, HTMLButtonElement][] = [];
	for (const color of colors) {
		const btn = el("button", "bd-swatch", row);
		btn.type = "button";
		if (color === COLOR_TRANSPARENT) {
			btn.classList.add("is-transparent");
			btn.title = "None";
		} else if (color === COLOR_DEFAULT) {
			btn.classList.add("is-default");
			btn.title = opts.defaultLabel ?? "Default (follows theme)";
		} else {
			btn.style.setProperty("--bd-swatch", color);
			btn.title = color;
		}
		btn.setAttribute("aria-label", btn.title);
		btn.addEventListener("pointerdown", (e) => e.preventDefault());
		btn.addEventListener("click", () => {
			set(color);
			sync();
		});
		buttons.push([color, btn]);
	}
	const custom = el("input", "bd-color-input", row);
	custom.type = "color";
	custom.title = "Custom color";
	custom.setAttribute("aria-label", "Custom color");
	custom.addEventListener("change", () => {
		set(custom.value);
		sync();
	});
	const sync = () => {
		const current = get();
		let matched = false;
		for (const [color, btn] of buttons) {
			const on = color.toLowerCase() === (current ?? "").toLowerCase();
			btn.classList.toggle("is-active", on);
			matched = matched || on;
		}
		custom.classList.toggle("is-active", !matched);
		const hex = toHex6(current);
		if (hex && activeElementOf(custom) !== custom) custom.value = hex;
	};
	sync();
	return sync;
}

/** Text input bound to a value; changes are previewed live and committed on blur. */
export function textField(
	parent: HTMLElement,
	opts: {
		multiline?: boolean;
		placeholder?: string;
		get: () => string;
		onFocus: () => void;
		onInput: (value: string) => void;
		onCommit: () => void;
	},
): () => void {
	const input = opts.multiline ? el("textarea", "bd-input bd-textarea", parent) : el("input", "bd-input", parent);
	if (input instanceof HTMLInputElement) input.type = "text";
	if (opts.placeholder) input.placeholder = opts.placeholder;
	input.value = opts.get();
	input.addEventListener("focus", () => opts.onFocus());
	input.addEventListener("input", () => opts.onInput(input.value));
	input.addEventListener("blur", () => opts.onCommit());
	input.addEventListener("keydown", (e) => {
		const ke = e as KeyboardEvent;
		ke.stopPropagation();
		if (ke.key === "Escape" || (ke.key === "Enter" && (!opts.multiline || ke.ctrlKey || ke.metaKey))) {
			ke.preventDefault();
			input.blur();
		}
	});
	return () => {
		if (activeElementOf(input) !== input) {
			const v = opts.get();
			if (input.value !== v) input.value = v;
		}
	};
}
