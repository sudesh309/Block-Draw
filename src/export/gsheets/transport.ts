import type { SheetsRequest } from "./requests";

export interface SheetInfo {
	sheetId: number;
	title: string;
}

export interface SpreadsheetInfo {
	spreadsheetId: string;
	spreadsheetUrl: string;
	sheets: SheetInfo[];
}

/** The three Sheets API operations the exporter needs. */
export interface SheetsTransport {
	readonly name: string;
	create(title: string): Promise<SpreadsheetInfo>;
	get(spreadsheetId: string): Promise<SpreadsheetInfo>;
	batchUpdate(spreadsheetId: string, requests: SheetsRequest[]): Promise<void>;
}

export interface HttpRequest {
	url: string;
	method: "GET" | "POST";
	headers?: Record<string, string>;
	contentType?: string;
	body?: string;
}

export interface HttpResponse {
	status: number;
	text: string;
}

/** Plain HTTP function (Obsidian's `requestUrl` in the plugin, a fake in tests). */
export type HttpClient = (req: HttpRequest) => Promise<HttpResponse>;

export class SheetsError extends Error {
	constructor(
		message: string,
		readonly status?: number,
		readonly notFound = false,
	) {
		super(message);
	}
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/**
 * The Apps Script bridge (see Code.gs) always replies with JSON, even on error — so a non-JSON
 * body means Google itself intercepted the request before the script ran, almost always because
 * the deployment isn't actually reachable anonymously. Recognize the common cases so the Notice
 * tells people what to fix instead of just the HTTP status.
 */
function explainNonJson(text: string, status: number): string {
	const head = text.slice(0, 4000);
	if (!head.trim()) {
		return (
			`The Apps Script web app returned an empty response (HTTP ${status}). Open the web app URL ` +
			"once in a browser while signed into the Google account you deployed it with — if that asks " +
			"you to sign in or review permissions, finish that, then deploy a new version."
		);
	}
	if (/accounts\.google\.com|ServiceLogin|Sign in - Google Accounts/i.test(head)) {
		return (
			`Google asked to sign in instead of running the script (HTTP ${status}). The deployment's ` +
			'"Who has access" isn\'t set to "Anyone": open the Apps Script project → Deploy → Manage ' +
			'deployments → edit the deployment → set "Who has access" to "Anyone" → deploy a new version.'
		);
	}
	if (/Script function not found|TypeError:|ReferenceError:|We.re sorry, a server error/i.test(head)) {
		return (
			`Google Apps Script returned an error page instead of the bridge's reply (HTTP ${status}). ` +
			"Check that Deploy → Manage deployments is running the latest code as a new version, and " +
			"that the web app address in settings ends in /exec, not /dev."
		);
	}
	const snippet = head
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 140);
	return `The Apps Script URL did not return JSON (HTTP ${status}). Check the web app URL in settings.${snippet ? ` Google sent back: "${snippet}${head.trim().length > 140 ? "…" : ""}"` : ""}`;
}

interface RawSpreadsheet {
	spreadsheetId?: string;
	spreadsheetUrl?: string;
	sheets?: { properties?: { sheetId?: number; title?: string } }[];
}

export function toSpreadsheetInfo(raw: RawSpreadsheet): SpreadsheetInfo {
	if (!raw || typeof raw.spreadsheetId !== "string") throw new SheetsError("Unexpected response from Google Sheets.");
	return {
		spreadsheetId: raw.spreadsheetId,
		// The address is opened in the browser after the export, so only a Google Sheets address is taken as is.
		spreadsheetUrl:
			typeof raw.spreadsheetUrl === "string" && raw.spreadsheetUrl.startsWith("https://docs.google.com/")
				? raw.spreadsheetUrl
				: `https://docs.google.com/spreadsheets/d/${encodeURIComponent(raw.spreadsheetId)}/edit`,
		sheets: (raw.sheets ?? []).map((s) => ({ sheetId: s.properties?.sheetId ?? 0, title: s.properties?.title ?? "" })),
	};
}

/* ------------------------------------------------------- Apps Script bridge */

/**
 * Talks to the Block Draw Apps Script web app (see apps-script/Code.gs), which runs as the
 * user and forwards calls to the Sheets advanced service. Works on desktop and mobile and
 * needs no Google Cloud project.
 */
export class AppsScriptTransport implements SheetsTransport {
	readonly name = "Apps Script";

	constructor(
		private readonly url: string,
		private readonly secret: string,
		private readonly http: HttpClient,
	) {}

	private async call<T>(action: string, payload: Record<string, unknown>): Promise<T> {
		if (/\/dev\/?$/i.test(this.url.trim())) {
			throw new SheetsError(
				'The web app address ends in "/dev" — that is the editor\'s test link, which only works while ' +
					'you are signed into Apps Script in a browser. Use the deployed address instead: Deploy → ' +
					'Manage deployments (it ends in "/exec").',
			);
		}
		const res = await this.http({
			url: this.url,
			method: "POST",
			contentType: "text/plain;charset=utf-8",
			body: JSON.stringify({ secret: this.secret, action, ...payload }),
		});
		const data = parseJson(res.text) as { ok?: boolean; result?: T; error?: string; notFound?: boolean } | undefined;
		if (!data || typeof data !== "object") {
			throw new SheetsError(
				res.status === 401 || res.status === 403
					? "The Apps Script web app refused the request. Re-deploy it with “Who has access: Anyone”."
					: explainNonJson(res.text, res.status),
				res.status,
			);
		}
		if (!data.ok) throw new SheetsError(data.error || "The Apps Script bridge reported an error.", res.status, !!data.notFound);
		return data.result as T;
	}

	async ping(): Promise<{ user?: string; version?: number }> {
		return this.call("ping", {});
	}

	async create(title: string): Promise<SpreadsheetInfo> {
		return toSpreadsheetInfo(await this.call<RawSpreadsheet>("create", { title }));
	}

	async get(spreadsheetId: string): Promise<SpreadsheetInfo> {
		return toSpreadsheetInfo(await this.call<RawSpreadsheet>("get", { spreadsheetId }));
	}

	async batchUpdate(spreadsheetId: string, requests: SheetsRequest[]): Promise<void> {
		await this.call("batchUpdate", { spreadsheetId, requests });
	}
}

/* ------------------------------------------------------ Sheets REST + OAuth */

const API = "https://sheets.googleapis.com/v4/spreadsheets";

/** Calls the Sheets REST API directly with an OAuth access token. */
export class RestSheetsTransport implements SheetsTransport {
	readonly name = "Google account";

	constructor(
		private readonly accessToken: () => Promise<string>,
		private readonly http: HttpClient,
	) {}

	private async send(method: "GET" | "POST", url: string, body?: unknown): Promise<unknown> {
		const token = await this.accessToken();
		const res = await this.http({
			url,
			method,
			headers: { Authorization: `Bearer ${token}` },
			contentType: body === undefined ? undefined : "application/json",
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		const data = parseJson(res.text) as { error?: { message?: string; status?: string } } | undefined;
		if (res.status >= 400) {
			const message = data?.error?.message || `Google Sheets request failed (HTTP ${res.status}).`;
			throw new SheetsError(message, res.status, res.status === 404);
		}
		return data;
	}

	async create(title: string): Promise<SpreadsheetInfo> {
		return toSpreadsheetInfo((await this.send("POST", API, { properties: { title } })) as RawSpreadsheet);
	}

	async get(spreadsheetId: string): Promise<SpreadsheetInfo> {
		const fields = encodeURIComponent("spreadsheetId,spreadsheetUrl,sheets.properties(sheetId,title)");
		return toSpreadsheetInfo((await this.send("GET", `${API}/${encodeURIComponent(spreadsheetId)}?fields=${fields}`)) as RawSpreadsheet);
	}

	async batchUpdate(spreadsheetId: string, requests: SheetsRequest[]): Promise<void> {
		await this.send("POST", `${API}/${encodeURIComponent(spreadsheetId)}:batchUpdate`, { requests });
	}
}
