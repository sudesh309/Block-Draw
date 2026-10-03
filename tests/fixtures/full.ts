import { BLOCK_SHAPES, DEFAULT_BLOCK_STYLE, DEFAULT_CONNECTOR_STYLE, type DrawElement, type DrawingFile } from "../../src/model/types";
import { block, connector, frame } from "../helpers";

/**
 * A drawing that uses every field of the file format with a non-default value somewhere: all
 * eight shapes, every style option, every link kind, comments, tags, hidden descriptions, all
 * routings, anchor sides and arrowheads, plus export info and a key from a "future" version.
 * The golden files written from it lock the format and the renderer.
 */
export function fullDrawing(): DrawingFile {
	const shapes: DrawElement[] = BLOCK_SHAPES.map((shape, i) =>
		block(`s-${shape}`, 40 + (i % 4) * 220, 480 + Math.floor(i / 4) * 160, { title: shape, shape, frameId: "f2" }),
	);
	const elements: DrawElement[] = [
		frame("f1", 0, 0, 900, 400, { title: "Request path", description: "From the browser to the database" }),
		frame("f2", 0, 440, 900, 360, { title: "Shapes", description: "", style: { fill: "#f8f9fa", stroke: "#1971c2" } }),
		block("web", 40, 60, {
			title: "Web app",
			tag: "React",
			description: "Single page app",
			frameId: "f1",
			link: "[[Notes/Web app|Web]]",
			style: { ...DEFAULT_BLOCK_STYLE, fill: "#ffec99", textAlign: "left", textVAlign: "top", fontFamily: "georgia" },
		}),
		block("api", 340, 60, {
			title: "API",
			tag: "Service · Go",
			description: "Kept for the export, not drawn",
			descriptionOpen: false,
			frameId: "f1",
			link: "frame:f2",
			comment: "Rate limited per user",
			commentOpen: true,
			style: { ...DEFAULT_BLOCK_STYLE, threeD: true, strokeWidth: 4, strokeStyle: "dashed", textColor: "#1f3a5f", fontSize: 20 },
		}),
		block("db", 640, 60, {
			title: "Orders",
			shape: "cylinder",
			frameId: "f1",
			link: "https://example.com/orders",
			comment: "Closed comment",
			style: { ...DEFAULT_BLOCK_STYLE, fill: "transparent", stroke: "#e03131", strokeStyle: "dotted", textAlign: "right", textVAlign: "bottom", fontFamily: "montserrat" },
		}),
		block("mail", 340, 260, {
			title: "Support",
			shape: "text",
			frameId: "f1",
			link: "mailto:support@example.com",
			style: { ...DEFAULT_BLOCK_STYLE, textColor: "default", fontSize: 12, strokeWidth: 1 },
		}),
		...shapes,
		block("loose", 1000, 60, { title: "Unframed", description: "Not in any frame" }),
		connector("c-elbow", "web", "api", { label: "calls", style: { ...DEFAULT_CONNECTOR_STYLE, flow: true } }),
		connector("c-straight", "api", "db", {
			routing: "straight",
			from: { id: "api", side: "right" },
			to: { id: "db", side: "left" },
			style: { ...DEFAULT_CONNECTOR_STYLE, startArrow: "dot", endArrow: "triangle", strokeWidth: 3, threeD: true },
		}),
		connector("c-curved", "api", "mail", {
			routing: "curved",
			label: "escalate",
			from: { id: "api", side: "bottom" },
			to: { id: "mail", side: "top" },
			comment: "Only during office hours",
			commentOpen: true,
			style: { ...DEFAULT_CONNECTOR_STYLE, strokeStyle: "dashed", stroke: "#2f9e44", startArrow: "arrow", endArrow: "arrow", flow: true },
		}),
		connector("c-dotted", "s-diamond", "s-hexagon", { style: { ...DEFAULT_CONNECTOR_STYLE, strokeStyle: "dotted", endArrow: "none" } }),
		connector("c-cross", "web", "loose", { comment: "Hidden note" }),
	];
	return {
		type: "block-draw",
		version: 1,
		exports: {
			googleSheet: {
				spreadsheetId: "1AbCdEf",
				url: "https://docs.google.com/spreadsheets/d/1AbCdEf/edit",
				exportedAt: "2026-10-01T12:00:00.000Z",
				sheetIds: [101, 102],
			},
		},
		futureKey: { keptBy: "older releases" },
		elements,
	};
}
