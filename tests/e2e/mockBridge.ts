/**
 * Local stand-in for a deployed Apps Script web app, for end-to-end tests in Obsidian.
 * Runs the real apps-script/Code.gs in a sandbox against the fake Sheets service and mimics
 * Google's behaviour: POST /exec answers 302 to a one-time URL that serves the output via GET.
 * Pass a key and certificate to serve https, the only scheme the plugin's network gateway allows.
 */
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { join } from "node:path";
import vm from "node:vm";
import { FakeSheetsService } from "../fakes/fakeSheets";

export interface MockBridge {
	url: string;
	svc: FakeSheetsService;
	log: string[];
	close(): Promise<void>;
}

export function startMockBridge(root: string, secret: string, tls?: { key: string; cert: string }): Promise<MockBridge> {
	const svc = new FakeSheetsService();
	const log: string[] = [];
	const code = readFileSync(join(root, "apps-script", "Code.gs"), "utf8").replace(
		"'change-me-to-a-long-random-string'",
		JSON.stringify(secret),
	);
	const context: Record<string, unknown> = {
		ContentService: {
			MimeType: { JSON: "application/json" },
			createTextOutput: (text: string) => ({ text, setMimeType() { return this; } }),
		},
		Session: { getEffectiveUser: () => ({ getEmail: () => "e2e@example.com" }) },
		Sheets: {
			Spreadsheets: {
				create: (body: { properties?: { title?: string } }) => svc.toJson(svc.create(body)),
				get: (id: string) => svc.toJson(svc.get(id)),
				batchUpdate: (body: { requests: Record<string, unknown>[] }, id: string) => {
					svc.batchUpdate(id, body);
					return {};
				},
			},
		},
	};
	vm.createContext(context);
	vm.runInContext(code, context);
	const doPost = context.doPost as (e: unknown) => { text: string };
	const outputs = new Map<string, string>();
	let seq = 0;

	const handler: http.RequestListener = (req, res) => {
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		if (req.method === "POST" && url.pathname.endsWith("/exec")) {
			let body = "";
			req.on("data", (c) => (body += c));
			req.on("end", () => {
				const out = doPost({ postData: { contents: body, type: req.headers["content-type"] } }).text;
				const key = `k${++seq}`;
				outputs.set(key, out);
				log.push(`POST ${(JSON.parse(body) as { action?: string }).action}`);
				res.writeHead(302, { Location: `/macros/echo?user_content_key=${key}` });
				res.end();
			});
			return;
		}
		if (req.method === "GET" && url.pathname === "/macros/echo") {
			const key = url.searchParams.get("user_content_key") ?? "";
			const out = outputs.get(key);
			log.push(`GET echo ${out ? "ok" : "missing"}`);
			outputs.delete(key);
			res.writeHead(out ? 200 : 404, { "Content-Type": "application/json; charset=utf-8" });
			res.end(out ?? '{"ok":false,"error":"expired"}');
			return;
		}
		log.push(`${req.method} ${url.pathname} (unexpected)`);
		res.writeHead(405);
		res.end();
	};
	const server = tls ? https.createServer(tls, handler) : http.createServer(handler);
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;
			resolve({
				url: `${tls ? "https" : "http"}://127.0.0.1:${port}/macros/s/e2e-deployment/exec`,
				svc,
				log,
				close: () => new Promise((r) => server.close(() => r())),
			});
		});
	});
}
