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

interface RawSpreadsheet {
	spreadsheetId?: string;
	spreadsheetUrl?: string;
	sheets?: { properties?: { sheetId?: number; title?: string } }[];
}

export function toSpreadsheetInfo(raw: RawSpreadsheet): SpreadsheetInfo {
	if (!raw || typeof raw.spreadsheetId !== "string") throw new SheetsError("Unexpected response from Google Sheets.");
	return {
		spreadsheetId: raw.spreadsheetId,
		spreadsheetUrl: raw.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${raw.spreadsheetId}/edit`,
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
					: `The Apps Script URL did not return JSON (HTTP ${res.status}). Check the web app URL in settings.`,
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
