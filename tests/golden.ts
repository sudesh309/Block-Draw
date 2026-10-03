import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect } from "vitest";

const DIR = join(__dirname, "golden");

/** True while golden files are being rewritten on purpose (`UPDATE_GOLDEN=1 npm test`). */
export const updatingGolden = process.env.UPDATE_GOLDEN === "1";

/**
 * Compares `actual` with the file `tests/golden/<name>`. A golden file is the reviewed, committed
 * output of a format or an export: a change to it shows up in the diff of the patch that caused it.
 * Run `UPDATE_GOLDEN=1 npm test` to rewrite the files after an intended change.
 */
export function expectGolden(name: string, actual: string): void {
	const path = join(DIR, name);
	if (updatingGolden) {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, actual);
		return;
	}
	if (!existsSync(path)) throw new Error(`Missing golden file tests/golden/${name}. Run UPDATE_GOLDEN=1 npm test to create it.`);
	expect(actual, `output differs from tests/golden/${name} (UPDATE_GOLDEN=1 npm test rewrites it)`).toBe(readFileSync(path, "utf8"));
}

/** Reads a golden file that a test uses as input. */
export function readGolden(name: string): string {
	return readFileSync(join(DIR, name), "utf8");
}
