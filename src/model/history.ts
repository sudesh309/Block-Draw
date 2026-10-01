import type { DrawElement } from "./types";

export interface HistoryEntry {
	elements: readonly DrawElement[];
	selection: string[];
}

/**
 * Snapshot-based undo/redo. Elements are immutable, so a snapshot is just the array
 * reference and unchanged elements are shared between entries.
 */
export class History {
	private undoStack: HistoryEntry[] = [];
	private redoStack: HistoryEntry[] = [];

	constructor(private readonly limit = 200) {}

	/** Records the state *before* a change. */
	push(entry: HistoryEntry): void {
		this.undoStack.push(entry);
		if (this.undoStack.length > this.limit) this.undoStack.shift();
		this.redoStack = [];
	}

	undo(current: HistoryEntry): HistoryEntry | null {
		const entry = this.undoStack.pop();
		if (!entry) return null;
		this.redoStack.push(current);
		return entry;
	}

	redo(current: HistoryEntry): HistoryEntry | null {
		const entry = this.redoStack.pop();
		if (!entry) return null;
		this.undoStack.push(current);
		return entry;
	}

	get canUndo(): boolean {
		return this.undoStack.length > 0;
	}

	get canRedo(): boolean {
		return this.redoStack.length > 0;
	}

	clear(): void {
		this.undoStack = [];
		this.redoStack = [];
	}
}
