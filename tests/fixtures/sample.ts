import type { DrawElement, DrawingFile } from "../../src/model/types";
import { block, connector, frame } from "../helpers";

/** A small two-frame checkout diagram used across export tests. */
export function sampleDrawing(): DrawingFile {
	const elements: DrawElement[] = [
		frame("f1", 0, 0, 760, 440, { title: "Checkout flow", description: "Happy path and sign-in branch" }),
		frame("f2", 860, 0, 560, 440, { title: "Payment details", style: { fill: "transparent", stroke: "#1971c2" } }),
		block("cart", 40, 60, { title: "Cart", frameId: "f1" }),
		block("check", 300, 60, { title: "Logged in?", shape: "diamond", frameId: "f1", style: { ...block("x", 0, 0).style, fill: "#ffec99" } }),
		block("login", 300, 260, { title: "Sign in", frameId: "f1", style: { ...block("x", 0, 0).style, fill: "#ffc9c9" } }),
		block("pay", 560, 60, {
			title: "Payment",
			description: "Card, wallet or invoice",
			frameId: "f1",
			link: "frame:f2",
		}),
		block("card", 900, 60, { title: "Card form", frameId: "f2", style: { ...block("x", 0, 0).style, fill: "#b2f2bb" } }),
		block("done", 900, 260, { title: "Confirmation", shape: "ellipse", frameId: "f2", link: "frame:f1" }),
		block("db", 1180, 260, { title: "Orders DB", shape: "cylinder", frameId: "f2", style: { ...block("x", 0, 0).style, fill: "#d0bfff" } }),
		block("spec", 40, 600, { title: "Spec", description: "Requirements note", link: "[[Specs/Checkout]]" }),
		connector("c1", "cart", "check"),
		connector("c2", "check", "pay", { label: "yes" }),
		connector("c3", "check", "login", { label: "no" }),
		connector("c4", "login", "pay"),
		connector("c5", "card", "done"),
		connector("c6", "done", "db", { routing: "curved", style: { ...connector("x", "a", "b").style, strokeStyle: "dashed" } }),
		connector("c7", "pay", "card", { label: "submit" }),
	];
	return { type: "block-draw", version: 1, elements };
}
