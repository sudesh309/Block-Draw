import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { beforeAll, describe, expect, it } from "vitest";
import { exportWorkbookToGoogleSheets } from "../src/export/gsheets/exporter";
import {
	assignSheetIds,
	buildSheetsRequests,
	cellData,
	chunkRequests,
	stableSheetId,
} from "../src/export/gsheets/requests";
import {
	AppsScriptTransport,
	RestSheetsTransport,
	SheetsError,
	type HttpRequest,
	type SheetsTransport,
} from "../src/export/gsheets/transport";
import { buildWorkbook } from "../src/export/workbook/layout";
import { useEstimatedTextMeasure } from "../src/render/text";
import { FakeSheetsService } from "./fakes/fakeSheets";
import { validate } from "./fakes/sheetsSchema";
import { sampleDrawing } from "./fixtures/sample";

beforeAll(() => useEstimatedTextMeasure());

const workbook = () =>
	buildWorkbook(sampleDrawing(), {
		title: "Checkout",
		now: new Date("2026-10-01T00:00:00Z"),
		resolveNoteUrl: (t) => `obsidian://open?vault=V&file=${encodeURIComponent(t)}`,
	});

/** Transport that calls the fake service directly. */
function directTransport(svc: FakeSheetsService): SheetsTransport {
	return {
		name: "direct",
		create: async (title) => toInfo(svc, svc.create({ properties: { title } }).spreadsheetId),
		get: async (id) => {
			if (!svc.spreadsheets.has(id)) throw new SheetsError("not found", 404, true);
			return toInfo(svc, id);
		},
		batchUpdate: async (id, requests) => svc.batchUpdate(id, { requests }),
	};
}

function toInfo(svc: FakeSheetsService, id: string) {
	const json = svc.toJson(svc.get(id));
	return { spreadsheetId: json.spreadsheetId, spreadsheetUrl: json.spreadsheetUrl, sheets: json.sheets.map((s) => s.properties) };
}

const titlesOf = (svc: FakeSheetsService, id: string) =>
	[...(svc.spreadsheets.get(id)?.sheets ?? [])].sort((a, b) => a.index - b.index).map((s) => s.title);

describe("Sheets request builder", () => {
	it("produces only schema-valid requests", () => {
		const model = workbook();
		const ids = assignSheetIds(model);
		const requests = buildSheetsRequests(model, ids);
		expect(requests.length).toBeGreaterThan(50);
		const kinds = new Set(requests.map((r) => Object.keys(r)[0]));
		expect([...kinds].sort()).toEqual(
			["addSheet", "mergeCells", "setBasicFilter", "updateBorders", "updateCells", "updateDimensionProperties"].sort(),
		);
		for (const [i, r] of requests.entries()) {
			const errors = validate(r, "Request");
			expect(errors, `request ${i} (${Object.keys(r)[0]})`).toEqual([]);
		}
	});

	it("links cells to other tabs with #gid", () => {
		const ids = new Map([["frame:f2", 123]]);
		const data = cellData(
			{ value: "Pay\nmore", link: { type: "sheet", sheetKey: "frame:f2" }, runs: [{ start: 0, bold: true }, { start: 4, color: "#ff0000" }] },
			ids,
		);
		expect(data.textFormatRuns).toEqual([
			{ startIndex: 0, format: { bold: true, link: { uri: "#gid=123" } } },
			{ startIndex: 4, format: { foregroundColorStyle: { rgbColor: { red: 1, green: 0, blue: 0 } }, link: { uri: "#gid=123" } } },
		]);
		const plain = cellData({ value: "x", link: { type: "url", url: "https://a.b" } }, ids);
		expect(plain.textFormatRuns).toEqual([{ startIndex: 0, format: { link: { uri: "https://a.b" } } }]);
		expect(cellData({ value: 3 }, ids)).toEqual({ userEnteredValue: { numberValue: 3 } });
		expect(cellData(undefined, ids)).toEqual({});
	});

	it("never lets a formula-looking string become a formula", () => {
		expect(cellData({ value: "=IMPORTXML(1)" }, new Map())).toEqual({ userEnteredValue: { stringValue: "=IMPORTXML(1)" } });
	});

	it("assigns stable, unique sheet ids", () => {
		const used = new Set<number>();
		const a = stableSheetId("frame:abc", used);
		const b = stableSheetId("frame:abc", used);
		expect(a).not.toBe(b);
		expect(stableSheetId("frame:abc", new Set())).toBe(a);
		expect(a).toBeGreaterThan(0);
		expect(a).toBeLessThan(2 ** 31);
	});

	it("chunks requests in order", () => {
		const reqs = Array.from({ length: 10 }, (_, i) => ({ deleteSheet: { sheetId: i } }));
		const batches = chunkRequests(reqs, 1e9, 3);
		expect(batches.map((b) => b.length)).toEqual([3, 3, 3, 1]);
		expect(batches.flat()).toEqual(reqs);
	});
});

describe("Google Sheets export flow", () => {
	it("creates a spreadsheet with one tab per frame plus index and data tabs", async () => {
		const svc = new FakeSheetsService();
		const res = await exportWorkbookToGoogleSheets(workbook(), directTransport(svc));
		expect(res.created).toBe(true);
		expect(titlesOf(svc, res.spreadsheetId)).toEqual(["Index", "Checkout flow", "Payment details", "Canvas", "Blocks", "Connections"]);
		const ss = svc.spreadsheets.get(res.spreadsheetId);
		expect(ss?.title).toBe("Checkout");
		expect(res.url).toBe(`https://docs.google.com/spreadsheets/d/${res.spreadsheetId}/edit#gid=${res.sheetIds[0]}`);
		const frame = ss?.sheets.find((s) => s.title === "Checkout flow");
		expect(frame?.hideGridlines).toBe(true);
		expect(frame?.merges.length).toBeGreaterThan(5);
		expect(frame?.borders).toBeGreaterThan(3);
		// the "Payment" block links to the Payment details tab
		const linkCell = [...(frame?.cells.values() ?? [])].find(
			(c) => (c.userEnteredValue as { stringValue?: string } | undefined)?.stringValue === "→ Payment details",
		);
		const gid = ss?.sheets.find((s) => s.title === "Payment details")?.sheetId;
		expect(JSON.stringify(linkCell?.textFormatRuns)).toContain(`"uri":"#gid=${gid}"`);
	});

	it("re-exports in place, keeping sheets the user added", async () => {
		const svc = new FakeSheetsService();
		const t = directTransport(svc);
		const first = await exportWorkbookToGoogleSheets(workbook(), t);
		// the user adds their own tabs to the exported spreadsheet
		svc.batchUpdate(first.spreadsheetId, {
			requests: [
				{ addSheet: { properties: { sheetId: 42, title: "My notes" } } },
				{ addSheet: { properties: { sheetId: 43, title: "Index (mine)" } } },
			],
		});
		const second = await exportWorkbookToGoogleSheets(workbook(), t, {
			target: { spreadsheetId: first.spreadsheetId, sheetIds: first.sheetIds },
		});
		expect(second.created).toBe(false);
		expect(second.spreadsheetId).toBe(first.spreadsheetId);
		expect(titlesOf(svc, first.spreadsheetId)).toEqual([
			"Index",
			"Checkout flow",
			"Payment details",
			"Canvas",
			"Blocks",
			"Connections",
			"My notes",
			"Index (mine)",
		]);
		expect(second.sheetIds).toEqual(first.sheetIds);
	});

	it("renames our tabs when a kept user tab already uses the title", async () => {
		const svc = new FakeSheetsService();
		const t = directTransport(svc);
		const first = await exportWorkbookToGoogleSheets(workbook(), t);
		svc.batchUpdate(first.spreadsheetId, { requests: [{ addSheet: { properties: { sheetId: 7, title: "Summary" } } }] });
		// a frame is renamed to the title of the user's own tab
		const drawing = sampleDrawing();
		(drawing.elements[0] as { title: string }).title = "summary";
		const model = buildWorkbook(drawing, { title: "Checkout" });
		await exportWorkbookToGoogleSheets(model, t, { target: { spreadsheetId: first.spreadsheetId, sheetIds: first.sheetIds } });
		const titles = titlesOf(svc, first.spreadsheetId);
		expect(titles).toContain("Summary");
		expect(titles).toContain("summary (2)");
	});

	it("creates a new spreadsheet when the old one is gone", async () => {
		const svc = new FakeSheetsService();
		const res = await exportWorkbookToGoogleSheets(workbook(), directTransport(svc), {
			target: { spreadsheetId: "deleted", sheetIds: [1, 2] },
		});
		expect(res.created).toBe(true);
		expect(res.spreadsheetId).not.toBe("deleted");
	});
});

describe("Apps Script bridge (Code.gs in a sandbox)", () => {
	const code = readFileSync(join(__dirname, "..", "apps-script", "Code.gs"), "utf8");

	function bridge(svc: FakeSheetsService, opts: { secret?: string; withService?: boolean } = {}) {
		const context: Record<string, unknown> = {
			ContentService: {
				MimeType: { JSON: "application/json" },
				createTextOutput: (text: string) => ({ text, setMimeType() { return this; } }),
			},
			Session: { getEffectiveUser: () => ({ getEmail: () => "me@example.com" }) },
			JSON,
			String,
		};
		if (opts.withService !== false) {
			context.Sheets = {
				Spreadsheets: {
					create: (body: { properties?: { title?: string } }) => svc.toJson(svc.create(body)),
					get: (id: string, args: { fields?: string }) => {
						if (!args?.fields) throw new Error("fields expected");
						return svc.toJson(svc.get(id));
					},
					batchUpdate: (body: { requests: Record<string, unknown>[] }, id: string) => {
						svc.batchUpdate(id, body);
						return { replies: [] };
					},
				},
			};
		}
		vm.createContext(context);
		const source = opts.secret === undefined ? code.replace("'change-me-to-a-long-random-string';", "'s3cret';") : code;
		vm.runInContext(source, context);
		const doPost = context.doPost as (e: unknown) => { text: string };
		const http = async (req: HttpRequest) => {
			expect(req.method).toBe("POST");
			return { status: 200, text: doPost({ postData: { contents: req.body } }).text };
		};
		return { http, doGet: context.doGet as () => { text: string } };
	}

	it("runs a full export through the bridge", async () => {
		const svc = new FakeSheetsService();
		const { http } = bridge(svc);
		const transport = new AppsScriptTransport("https://script.google.com/macros/s/x/exec", "s3cret", http);
		expect(await transport.ping()).toEqual({ version: 1, user: "me@example.com" });
		const res = await exportWorkbookToGoogleSheets(workbook(), transport);
		expect(titlesOf(svc, res.spreadsheetId)).toHaveLength(6);
		const again = await exportWorkbookToGoogleSheets(workbook(), transport, {
			target: { spreadsheetId: res.spreadsheetId, sheetIds: res.sheetIds },
		});
		expect(again.spreadsheetId).toBe(res.spreadsheetId);
	});

	it("reports configuration problems clearly", async () => {
		const svc = new FakeSheetsService();
		const wrong = new AppsScriptTransport("u", "nope", bridge(svc).http);
		await expect(wrong.ping()).rejects.toThrow(/secret does not match/);
		const unset = new AppsScriptTransport("u", "x", bridge(svc, { secret: "unchanged" }).http);
		await expect(unset.ping()).rejects.toThrow(/Set SECRET/);
		const noService = new AppsScriptTransport("u", "s3cret", bridge(svc, { withService: false }).http);
		await expect(noService.ping()).rejects.toThrow(/advanced service/);
		const ok = new AppsScriptTransport("u", "s3cret", bridge(svc).http);
		await expect(ok.get("missing")).rejects.toMatchObject({ notFound: true });
		expect((JSON.parse(bridge(svc).doGet().text) as { ok: boolean }).ok).toBe(true);
	});

	it("explains non-JSON responses", async () => {
		const html = new AppsScriptTransport("u", "s", async () => ({ status: 200, text: "<html>Sign in</html>" }));
		await expect(html.ping()).rejects.toThrow(/did not return JSON/);
		const denied = new AppsScriptTransport("u", "s", async () => ({ status: 403, text: "Forbidden" }));
		await expect(denied.ping()).rejects.toThrow(/Who has access: Anyone/);
	});
});

describe("Sheets REST transport", () => {
	function restHttp(svc: FakeSheetsService, seen: HttpRequest[]) {
		return async (req: HttpRequest) => {
			seen.push(req);
			try {
				const url = new URL(req.url);
				const m = /^\/v4\/spreadsheets(?:\/([^/:]+))?(:batchUpdate)?$/.exec(url.pathname);
				if (!m) return { status: 404, text: "{}" };
				if (req.method === "POST" && !m[1]) return { status: 200, text: JSON.stringify(svc.toJson(svc.create(JSON.parse(req.body as string) as Parameters<FakeSheetsService["create"]>[0]))) };
				if (req.method === "GET" && m[1]) {
					expect(url.searchParams.get("fields")).toContain("sheets.properties");
					return { status: 200, text: JSON.stringify(svc.toJson(svc.get(decodeURIComponent(m[1])))) };
				}
				if (req.method === "POST" && m[2]) {
					svc.batchUpdate(decodeURIComponent(m[1]), JSON.parse(req.body as string) as Parameters<FakeSheetsService["batchUpdate"]>[1]);
					return { status: 200, text: "{}" };
				}
				return { status: 400, text: "{}" };
			} catch (e) {
				const notFound = /not found/i.test(String(e));
				return { status: notFound ? 404 : 400, text: JSON.stringify({ error: { message: String((e as Error).message) } }) };
			}
		};
	}

	it("exports with a bearer token", async () => {
		const svc = new FakeSheetsService();
		const seen: HttpRequest[] = [];
		const transport = new RestSheetsTransport(async () => "tok", restHttp(svc, seen));
		const res = await exportWorkbookToGoogleSheets(workbook(), transport);
		expect(titlesOf(svc, res.spreadsheetId)).toHaveLength(6);
		expect(seen.every((r) => r.headers?.Authorization === "Bearer tok")).toBe(true);
		await expect(transport.get("nope")).rejects.toMatchObject({ notFound: true, status: 404 });
	});
});
