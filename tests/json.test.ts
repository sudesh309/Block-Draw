import { describe, expect, it } from "vitest";
import { exportStructuredJson } from "../src/export/json";
import { sampleDrawing } from "./fixtures/sample";

describe("structured JSON export", () => {
	it("carries each block's and connector's comment through", () => {
		const out = exportStructuredJson(sampleDrawing(), { name: "Checkout" });
		const f1 = out.frames.find((f) => f.title === "Checkout flow");
		const cart = f1?.blocks.find((b) => b.title === "Cart");
		expect(cart).toMatchObject({ comment: "Confirm totals before moving on", commentOpen: false });
		const yes = f1?.connections.find((c) => c.label === "yes");
		expect(yes).toMatchObject({ comment: "Requires 3-D Secure", commentOpen: true });
		// blocks without a comment still get the field, just empty.
		const check = f1?.blocks.find((b) => b.title === "Logged in?");
		expect(check).toMatchObject({ comment: "", commentOpen: false });
	});
});
