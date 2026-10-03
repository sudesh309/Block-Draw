import { describe, expect, it } from "vitest";
import { toSpreadsheetInfo } from "../src/export/gsheets/transport";
import { allowConfirmedHost, checkRequestUrl, isAllowedHost, request, setAllowedHosts } from "../src/obsidian/net";

describe("the network gateway", () => {
	it("lets through only https requests to declared hosts", () => {
		setAllowedHosts(["net:fonts.googleapis.com", "net:sheets.googleapis.com"]);
		expect(() => checkRequestUrl("https://fonts.googleapis.com/css2?family=Inter")).not.toThrow();
		expect(() => checkRequestUrl("https://SHEETS.googleapis.com/v4/spreadsheets")).not.toThrow();
		expect(() => checkRequestUrl("http://fonts.googleapis.com/css2")).toThrow(/https/);
		expect(() => checkRequestUrl("https://example.com/")).toThrow(/example\.com is not allowed/);
		expect(() => checkRequestUrl("https://fonts.googleapis.com.example.com/")).toThrow(/not allowed/);
		expect(() => checkRequestUrl("not a url")).toThrow(/valid web address/);
	});

	it("forgets hosts that are no longer declared, but keeps ones the person confirmed", () => {
		setAllowedHosts(["net:fonts.googleapis.com"]);
		allowConfirmedHost("Script.Example.org");
		setAllowedHosts([]);
		expect(isAllowedHost("fonts.googleapis.com")).toBe(false);
		expect(isAllowedHost("script.example.org")).toBe(true);
	});

	it("refuses before anything is sent", async () => {
		setAllowedHosts([]);
		await expect(request({ url: "https://fonts.googleapis.com/css2" })).rejects.toThrow(/not allowed/);
	});
});

describe("Google Sheets replies", () => {
	it("only keep a spreadsheet address on docs.google.com, since it is opened in the browser", () => {
		expect(toSpreadsheetInfo({ spreadsheetId: "abc", spreadsheetUrl: "https://docs.google.com/spreadsheets/d/abc/edit" }).spreadsheetUrl).toBe(
			"https://docs.google.com/spreadsheets/d/abc/edit",
		);
		for (const url of ["file:///etc/passwd", "javascript://x%0Aalert(1)", "https://evil.example/abc", "https://docs.google.com.evil.example/"]) {
			expect(toSpreadsheetInfo({ spreadsheetId: "abc", spreadsheetUrl: url }).spreadsheetUrl, url).toBe("https://docs.google.com/spreadsheets/d/abc/edit");
		}
	});
});
