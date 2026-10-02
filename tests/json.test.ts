import { describe, expect, it } from "vitest";
import { exportJsonText, exportStructuredJson } from "../src/export/json";
import { serializeDrawing } from "../src/model/file";
import { sampleDrawing } from "./fixtures/sample";

/** Every property name that appears anywhere in a JSON value. */
function keysOf(value: unknown, into = new Set<string>()): Set<string> {
	if (Array.isArray(value)) value.forEach((v) => keysOf(v, into));
	else if (value && typeof value === "object") {
		for (const [k, v] of Object.entries(value)) {
			into.add(k);
			keysOf(v, into);
		}
	}
	return into;
}

describe("structured JSON export", () => {
	it("carries each block's and connector's comment through", () => {
		const out = exportStructuredJson(sampleDrawing());
		const f1 = out.frames.find((f) => f.title === "Checkout flow");
		const cart = f1?.blocks.find((b) => b.title === "Cart");
		expect(cart).toMatchObject({ comment: "Confirm totals before moving on" });
		const yes = f1?.connections.find((c) => c.label === "yes");
		expect(yes).toMatchObject({ comment: "Requires 3-D Secure" });
		// blocks without a comment still get the field, just empty.
		const check = f1?.blocks.find((b) => b.title === "Logged in?");
		expect(check).toMatchObject({ comment: "" });
	});

	it("includes each block's tag, and an empty one when there is none", () => {
		const out = exportStructuredJson(sampleDrawing());
		const blocks = [...out.frames.flatMap((f) => f.blocks), ...out.unframed.blocks];
		expect(blocks.find((b) => b.title === "Payment")?.tag).toBe("Service · Java");
		expect(blocks.find((b) => b.title === "Orders DB")?.tag).toBe("PostgreSQL");
		expect(blocks.find((b) => b.title === "Cart")?.tag).toBe("");
	});

	it("describes the diagram, not how it looks or where it sits on the canvas", () => {
		const out = exportStructuredJson(sampleDrawing());
		const keys = keysOf(out);
		for (const gone of [
			"style",
			"fill",
			"stroke",
			"strokeWidth",
			"textColor",
			"fontFamily",
			"threeD",
			"bounds",
			"canvasBounds",
			"x",
			"y",
			"width",
			"height",
			"routing",
			"side",
			"descriptionOpen",
			"commentOpen",
			"name",
			"exportedAt",
		]) {
			expect(keys.has(gone), `"${gone}" is not exported`).toBe(false);
		}
		const text = JSON.stringify(out);
		expect(text).not.toMatch(/#[0-9a-f]{6}/i);
		expect(out).toMatchObject({ format: "block-draw/export", version: 2, stats: { frames: 2, blocks: 8, connections: 7 } });
	});

	it("keeps ids only where they tie things together", () => {
		const out = exportStructuredJson(sampleDrawing());
		const f1 = out.frames[0];
		const ids = new Set(f1.connections.map((c) => c.id));
		const check = f1.blocks.find((b) => b.title === "Logged in?");
		expect(check?.outgoing.length).toBeGreaterThan(0);
		for (const id of [...(check?.outgoing ?? []), ...(check?.incoming ?? [])]) expect(ids.has(id) || out.crossFrameConnections.some((c) => c.id === id)).toBe(true);
		expect(f1.connections[0].from).toEqual({ blockId: "cart", blockTitle: "Cart", frameId: "f1", frameTitle: "Checkout flow" });
		expect(f1.blocks.find((b) => b.title === "Payment")?.link).toEqual({ type: "frame", frameId: "f2", frameTitle: "Payment details" });
	});

	it("writes the same content as text, while the raw format stays the drawing file", () => {
		const d = sampleDrawing();
		expect(JSON.parse(exportJsonText(d, "structured"))).toEqual(JSON.parse(JSON.stringify(exportStructuredJson(d))));
		expect(exportJsonText(d, "raw")).toBe(serializeDrawing(d));
		expect(exportJsonText(d, "raw")).toContain('"fill"');
	});
});
