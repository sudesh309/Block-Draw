// Layer check: every import in src/ points down the stack (docs/DESIGN.md, "Layers").
//
// Each folder in src/ has a rank. A file may import from its own folder or from a folder with a
// lower rank: never upward, and never sideways (editor/ and export/ share a rank and stay apart).
// Only obsidian/ and main.ts may import the "obsidian" package. Prints every violation and exits 1
// when there is one. No dependencies.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

/** Lower is more basic. "(root)" is main.ts, the composition root. */
const RANKS = { model: 0, geometry: 1, render: 2, kernel: 3, editor: 4, export: 4, obsidian: 5, "(root)": 6 };
const MAY_IMPORT_OBSIDIAN = new Set(["obsidian", "(root)"]);

function* sourceFiles(dir) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) yield* sourceFiles(path);
		else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) yield path;
	}
}

const rel = (path) => relative(ROOT, path).split(sep).join("/");

/** The folder under src/ a path belongs to; files outside src/ (such as apps-script/Code.gs) are assets. */
function layerOf(path) {
	const parts = relative(SRC, path).split(sep);
	if (parts[0] === "..") return "(asset)";
	return parts.length === 1 ? "(root)" : parts[0];
}

/** Drops comments so an import written in a doc comment does not count. */
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const IMPORT_FORMS = [
	/\b(?:import|export)\s[^;]*?\bfrom\s*["']([^"']+)["']/g,
	/\bimport\s*["']([^"']+)["']/g,
	/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
];

function importsOf(code) {
	const found = new Set();
	for (const form of IMPORT_FORMS) for (const m of code.matchAll(form)) found.add(m[1]);
	return [...found];
}

const problems = [];
let files = 0;
for (const file of sourceFiles(SRC)) {
	files++;
	const from = layerOf(file);
	if (!(from in RANKS)) {
		problems.push(`${rel(file)}: the folder ${from}/ has no rank in scripts/check-layers.mjs`);
		continue;
	}
	const code = stripComments(readFileSync(file, "utf8"));
	for (const spec of importsOf(code)) {
		if (spec === "obsidian") {
			if (!MAY_IMPORT_OBSIDIAN.has(from)) problems.push(`${rel(file)}: only obsidian/ and main.ts may import "obsidian"`);
			continue;
		}
		if (!spec.startsWith(".")) continue; // a package such as fflate
		const to = layerOf(resolve(dirname(file), spec));
		if (to === from || to === "(asset)") continue;
		if (!(to in RANKS)) {
			problems.push(`${rel(file)}: imports ${spec}, a folder with no rank`);
		} else if (RANKS[to] >= RANKS[from]) {
			const why = RANKS[to] === RANKS[from] ? "a sibling" : "a higher layer";
			problems.push(`${rel(file)}: imports ${spec}; ${from}/ (rank ${RANKS[from]}) may not import ${to}/ (rank ${RANKS[to]}), ${why}`);
		}
	}
}

if (problems.length) {
	console.error(`Layer check failed (${problems.length}):\n  ${problems.join("\n  ")}`);
	process.exit(1);
}
console.log(`Layer check: ${files} files, every import points down the stack.`);
