/** Stand-in for the `obsidian` package, which ships only type declarations: the runtime parts the unit tests touch. */
export async function requestUrl(): Promise<never> {
	throw new Error("requestUrl is not available in unit tests");
}

/** Base class some modules extend when they load (confirm dialogs); unit tests never open one. */
export class Modal {
	constructor(readonly app: unknown) {}
	open(): void {}
	close(): void {}
}

export class Notice {
	constructor(readonly message?: unknown) {}
	setMessage(message: unknown): this {
		void message;
		return this;
	}
	hide(): void {}
}

export const Platform = { isDesktopApp: true, isMobile: false, isMobileApp: false };

/** The unit tests stand in for Obsidian before 1.13 unless a test calls the newer API itself. */
export function requireApiVersion(version: string): boolean {
	void version;
	return false;
}

/** What a settings row's control was given. */
export interface FakeControl {
	kind: "text" | "toggle" | "slider" | "dropdown" | "button";
	value?: unknown;
	options?: string[];
	/** The input element's type, for text fields ("password" for secrets). */
	inputType?: string;
}

/** A settings container: it collects the rows added to it. */
export interface FakeContainer {
	settings: Setting[];
	empty(): void;
}

export function fakeContainer(): FakeContainer {
	const c: FakeContainer = {
		settings: [],
		empty: () => {
			c.settings.length = 0;
		},
	};
	return c;
}

/** A settings row that records its name and the controls added to it. */
export class Setting {
	name = "";
	desc: unknown = undefined;
	heading = false;
	readonly controls: FakeControl[] = [];
	readonly controlEl = {
		empty: () => {
			this.controls.length = 0;
		},
		/** Custom controls (the pen test box) are built from a div. */
		createDiv: () => ({ addEventListener: () => {}, setText: () => {}, toggleClass: () => {} }),
	};

	constructor(containerEl?: FakeContainer) {
		containerEl?.settings.push(this);
	}

	setName(name: string): this {
		this.name = name;
		return this;
	}

	setDesc(desc: unknown): this {
		this.desc = desc;
		return this;
	}

	setHeading(): this {
		this.heading = true;
		return this;
	}

	addText(cb: (c: never) => unknown): this {
		return this.add("text", cb);
	}

	addToggle(cb: (c: never) => unknown): this {
		return this.add("toggle", cb);
	}

	addSlider(cb: (c: never) => unknown): this {
		return this.add("slider", cb);
	}

	addDropdown(cb: (c: never) => unknown): this {
		return this.add("dropdown", cb);
	}

	addButton(cb: (c: never) => unknown): this {
		return this.add("button", cb);
	}

	/** Every component method returns the component, so chained calls work; setValue and addOption are recorded. */
	private add(kind: FakeControl["kind"], cb: (c: never) => unknown): this {
		const control: FakeControl = { kind };
		const inputEl = { type: "text" };
		const component: object = new Proxy(
			{},
			{
				get: (_target, prop) => {
					if (prop === "inputEl") return inputEl;
					return (...args: unknown[]) => {
						if (prop === "setValue") control.value = args[0];
						if (prop === "addOption") (control.options ??= []).push(String(args[0]));
						return component;
					};
				},
			},
		);
		cb(component as never);
		if (kind === "text") control.inputType = inputEl.type;
		this.controls.push(control);
		return this;
	}
}

export class PluginSettingTab {
	readonly containerEl: FakeContainer = fakeContainer();
	constructor(
		readonly app: unknown,
		readonly plugin: unknown,
	) {}
	refreshDomState(): void {}
}
