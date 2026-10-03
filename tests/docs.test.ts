import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exporterRows } from "../src/obsidian/exporters";
import { SETTINGS } from "../src/obsidian/settings";
import { updatingGolden } from "./golden";

const root = join(__dirname, "..");

/** Every declared host, with when it is contacted, in the order the tables list them. */
function hostTable(): Map<string, string[]> {
	const hosts = new Map<string, string[]>();
	const add = (need: string, when: string) => {
		const host = need.replace(/^net:/, "");
		const list = hosts.get(host) ?? [];
		if (!list.includes(when)) list.push(when);
		hosts.set(host, list);
	};
	for (const def of SETTINGS) for (const need of def.needs ?? []) add(need, `while **${def.name}** is on`);
	for (const [, ex] of exporterRows()) for (const need of ex.needs ?? []) add(need, `when you use **${ex.command.name}**`);
	return hosts;
}

describe("docs that list what Block Draw connects to", () => {
	it("keep the host table in docs/DESIGN.md in step with the tables", () => {
		const path = join(root, "docs", "DESIGN.md");
		const doc = readFileSync(path, "utf8");
		const start = doc.indexOf("<!-- network:start");
		const end = doc.indexOf("<!-- network:end -->");
		expect(start).toBeGreaterThan(-1);
		expect(end).toBeGreaterThan(start);
		const head = doc.indexOf("-->", start) + 3;
		const rows = [...hostTable()].map(([host, when]) => `| \`${host}\` | ${when.join(", or ")} |`);
		const generated = `\n| Host | Contacted |\n| --- | --- |\n${rows.join("\n")}\n`;
		if (updatingGolden) writeFileSync(path, doc.slice(0, head) + generated + doc.slice(end));
		else expect(doc.slice(head, end)).toBe(generated);
	});

	it("name every declared host in SECURITY.md", () => {
		const security = readFileSync(join(root, "SECURITY.md"), "utf8");
		for (const host of hostTable().keys()) expect(security, host).toContain(`\`${host}\``);
	});
});
