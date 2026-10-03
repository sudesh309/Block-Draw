/**
 * The command mechanism. A host lists its commands (its COMMANDS table): id, label, keys and what
 * each one runs. These functions match key presses against the table and format keys for the help
 * panel, tooltips and docs. Nothing here knows any particular command.
 */

/** The parts of a KeyboardEvent the matcher reads. */
export interface KeyPress {
	key: string;
	code: string;
	ctrlKey: boolean;
	metaKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
}

export interface CommandDef<C> {
	id: string;
	/** What it does, as the help panel and the docs say it. */
	label: string;
	/** Heading it is listed under in the help panel and the docs. */
	group: string;
	/**
	 * Keys, such as "Mod+D" (Ctrl on Windows and Linux, Cmd on macOS), "Mod+Shift+Z",
	 * "Alt+ArrowLeft", "Shift+Digit1" (by key position, any keyboard layout), "?" or "Plus".
	 * Shift is ignored unless it is written, so a symbol typed with Shift still matches.
	 */
	keys: readonly string[];
	/** Changes the drawing: in a read-only drawing it does nothing and the key is not taken. */
	edits?: boolean;
	/** Runs the command. Returning false means it did not apply, and the key keeps its default meaning. */
	run(ctx: C, press: KeyPress): boolean | void;
}

interface Chord {
	mod: boolean;
	alt: boolean;
	shift: boolean;
	key?: string;
	code?: string;
}

/** Key names that cannot be written as themselves in a spec. */
const NAMED_KEYS: Record<string, string> = { Plus: "+", Minus: "-", Space: " ", Esc: "Escape" };

export function parseChord(spec: string): Chord {
	const parts = spec.split("+");
	const last = parts.pop() ?? "";
	if (!last) throw new Error(`Empty key in "${spec}"`);
	const chord: Chord = { mod: false, alt: false, shift: false };
	for (const p of parts) {
		if (p === "Mod") chord.mod = true;
		else if (p === "Alt") chord.alt = true;
		else if (p === "Shift") chord.shift = true;
		else throw new Error(`Unknown modifier "${p}" in "${spec}"`);
	}
	if (/^(Digit[0-9]|Key[A-Z])$/.test(last)) chord.code = last;
	else {
		const key = NAMED_KEYS[last] ?? last;
		chord.key = key.length === 1 ? key.toLowerCase() : key;
	}
	return chord;
}

function chordMatches(chord: Chord, press: KeyPress): boolean {
	if ((press.ctrlKey || press.metaKey) !== chord.mod || press.altKey !== chord.alt) return false;
	if (chord.shift && !press.shiftKey) return false;
	if (chord.code) return press.code === chord.code;
	const key = press.key.length === 1 ? press.key.toLowerCase() : press.key;
	return key === chord.key;
}

export interface Keymap<C> {
	/** The first command, in table order, with a key that matches the press. */
	find(press: KeyPress): CommandDef<C> | null;
}

/** Parses every key of a table once. Throws on a key it cannot read, so a typo fails the tests. */
export function compileKeymap<C>(commands: readonly CommandDef<C>[]): Keymap<C> {
	const chords = commands.flatMap((command) => command.keys.map((spec) => ({ command, chord: parseChord(spec) })));
	return {
		find: (press) => chords.find((c) => chordMatches(c.chord, press))?.command ?? null,
	};
}

const KEY_LABELS: Record<string, string> = {
	Mod: "Ctrl/Cmd",
	ArrowLeft: "←",
	ArrowRight: "→",
	ArrowUp: "↑",
	ArrowDown: "↓",
	Plus: "+",
	Minus: "−",
	Escape: "Esc",
	PageUp: "Page Up",
	PageDown: "Page Down",
};

/** How a key spec reads for people: "Mod+Shift+Z" → "Ctrl/Cmd+Shift+Z", "Shift+Digit1" → "Shift+1". */
export function formatChord(spec: string): string {
	return spec
		.split("+")
		.map((p) => KEY_LABELS[p] ?? /^(?:Digit|Key)(.)$/.exec(p)?.[1] ?? (p.length === 1 ? p.toUpperCase() : p))
		.join("+");
}

/** All of a command's keys, as the help panel and the docs list them. */
export const formatKeys = (command: CommandDef<unknown>): string => command.keys.map(formatChord).join(" or ");
