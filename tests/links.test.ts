import { describe, expect, it } from "vitest";
import { linkAction } from "../src/obsidian/links";

describe("which links a drawing may open", () => {
	it("opens web and mail links", () => {
		for (const url of ["https://example.com", "HTTP://example.com/x", "mailto:someone@example.com", "  https://example.com  "]) expect(linkAction(url), url).toBe("open");
	});

	it("asks before obsidian:// links", () => {
		expect(linkAction("obsidian://open?vault=V&file=Note")).toBe("ask");
	});

	it("refuses everything else", () => {
		for (const url of ["file:///etc/passwd", "javascript://x%0Aalert(1)", "vbscript:msgbox", "ftp://example.com", "ms-settings:", "smb://server/share", "data:text/html,x", "example.com", ""]) {
			expect(linkAction(url), url).toBe("refuse");
		}
	});
});
