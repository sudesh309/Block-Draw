import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from "obsidian";
import type { HttpClient } from "../export/gsheets/transport";
import type { Capability } from "../kernel/settings";

/*
 * The plugin's only door to the network; scripts/check-layers.mjs fails the build if anything else
 * calls requestUrl. A request must use https and go to a host on the allow-list, which main.ts
 * builds from what the SETTINGS and EXPORTERS rows declare in `needs` (a setting's hosts only while
 * it is on), plus hosts the person confirmed (an Apps Script address on their own domain).
 */

let declared = new Set<string>();
const confirmed = new Set<string>();

/** Replaces the declared hosts, e.g. ["net:fonts.googleapis.com"]. */
export function setAllowedHosts(needs: Iterable<Capability>): void {
	declared = new Set([...needs].filter((n) => n.startsWith("net:")).map((n) => n.slice(4).toLowerCase()));
}

/** Lets one more host through for the rest of the session, after the person said yes. */
export function allowConfirmedHost(host: string): void {
	confirmed.add(host.toLowerCase());
}

export const isAllowedHost = (host: string): boolean => declared.has(host.toLowerCase()) || confirmed.has(host.toLowerCase());

/** Throws unless `url` is https and its host is allowed. */
export function checkRequestUrl(url: string): void {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`Not a valid web address: ${url}`);
	}
	if (parsed.protocol !== "https:") throw new Error(`Only https addresses are used, not ${parsed.protocol}//${parsed.host}.`);
	if (!isAllowedHost(parsed.hostname)) throw new Error(`Connecting to ${parsed.hostname} is not allowed.`);
}

export async function request(params: RequestUrlParam): Promise<RequestUrlResponse> {
	checkRequestUrl(params.url);
	return requestUrl(params);
}

/** request() as the plain HTTP client the Google Sheets transports use (no CORS, works on mobile). */
export const obsidianHttp: HttpClient = async (req) => {
	const res = await request({
		url: req.url,
		method: req.method,
		headers: req.headers,
		contentType: req.contentType,
		body: req.body,
		throw: false,
	});
	let text = "";
	try {
		text = res.text;
	} catch {
		text = "";
	}
	return { status: res.status, text };
};
