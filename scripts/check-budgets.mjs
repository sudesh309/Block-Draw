// Budget check: numbers in budgets.json that only move on purpose (CONTRIBUTING.md, "Budgets").
//
// - fileLines: a listed file may not grow past its number, and the number may not sit more than
//   `slack` lines above the file's size (lower it when the file shrinks, so the ratchet holds).
//   Every other file in src/ stays at or under maxNewFileLines.
// - runtimeDependencies: the most entries package.json may have under "dependencies".
// - bundleBytes, checked with --bundle after a production build: the most bytes main.js may have.
//
// Prints every problem and exits 1 when there is one. No dependencies.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const budgets = JSON.parse(readFileSync(join(ROOT, "budgets.json"), "utf8"));
const problems = [];

function* sourceFiles(dir) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) yield* sourceFiles(path);
		else if (entry.name.endsWith(".ts")) yield path;
	}
}

/** Same count as `wc -l`. */
const lineCount = (path) => (readFileSync(path, "utf8").match(/\n/g) ?? []).length;

if (process.argv.includes("--bundle")) {
	const bundle = join(ROOT, "main.js");
	if (!existsSync(bundle)) problems.push("main.js does not exist; run the production build first");
	else {
		const size = statSync(bundle).size;
		if (size > budgets.bundleBytes) problems.push(`main.js is ${size} bytes; the budget is ${budgets.bundleBytes}`);
		else console.log(`Bundle budget: main.js is ${size} of ${budgets.bundleBytes} bytes.`);
	}
} else {
	const listed = new Map(Object.entries(budgets.fileLines));
	let files = 0;
	for (const file of sourceFiles(join(ROOT, "src"))) {
		files++;
		const name = relative(ROOT, file).split(sep).join("/");
		const lines = lineCount(file);
		const budget = listed.get(name);
		listed.delete(name);
		if (budget === undefined) {
			if (lines > budgets.maxNewFileLines) problems.push(`${name} has ${lines} lines; new files stay at or under ${budgets.maxNewFileLines}`);
		} else if (lines > budget) {
			problems.push(`${name} has ${lines} lines; its budget is ${budget}`);
		} else if (budget - lines > budgets.slack) {
			problems.push(`${name} shrank to ${lines} lines; lower its budget in budgets.json (now ${budget})`);
		}
	}
	for (const name of listed.keys()) problems.push(`${name} is in budgets.json but does not exist; remove it`);

	const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
	const deps = Object.keys(pkg.dependencies ?? {});
	if (deps.length > budgets.runtimeDependencies) {
		problems.push(`${deps.length} runtime dependencies (${deps.join(", ")}); the budget is ${budgets.runtimeDependencies}`);
	}
	if (!problems.length) console.log(`Budgets: ${files} files within their line budgets, ${deps.length} runtime dependency.`);
}

if (problems.length) {
	console.error(`Budget check failed (${problems.length}):\n  ${problems.join("\n  ")}`);
	process.exit(1);
}
