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
