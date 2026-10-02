import {
	DEFAULT_BLOCK_STYLE,
	DEFAULT_CONNECTOR_STYLE,
	DEFAULT_FRAME_STYLE,
	type BlockElement,
	type ConnectorElement,
	type FrameElement,
} from "../src/model/types";

export function block(id: string, x: number, y: number, extra: Partial<BlockElement> = {}): BlockElement {
	return {
		id,
		type: "block",
		x,
		y,
		width: 160,
		height: 80,
		title: id.toUpperCase(),
		description: "",
		descriptionOpen: true,
		shape: "rounded",
		frameId: null,
		link: null,
		tag: "",
		comment: "",
		commentOpen: false,
		style: { ...DEFAULT_BLOCK_STYLE },
		...extra,
	};
}

export function frame(id: string, x: number, y: number, width: number, height: number, extra: Partial<FrameElement> = {}): FrameElement {
	return {
		id,
		type: "frame",
		x,
		y,
		width,
		height,
		title: `Frame ${id}`,
		description: "",
		style: { ...DEFAULT_FRAME_STYLE },
		...extra,
	};
}

export function connector(id: string, from: string, to: string, extra: Partial<ConnectorElement> = {}): ConnectorElement {
	return {
		id,
		type: "connector",
		from: { id: from, side: "auto" },
		to: { id: to, side: "auto" },
		label: "",
		routing: "elbow",
		comment: "",
		commentOpen: false,
		style: { ...DEFAULT_CONNECTOR_STYLE },
		...extra,
	};
}
