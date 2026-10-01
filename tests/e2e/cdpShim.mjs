// Older Obsidian releases (e.g. 1.5) ship an Electron that rejects Browser.setDownloadBehavior
// for the default browser context ("Browser context management is not supported"), which makes
// Playwright's connectOverCDP fail. This pass-through DevTools proxy answers that one call itself
// and forwards everything else unchanged.
import { WebSocket, WebSocketServer } from "ws";

/** Starts the proxy for the browser endpoint on `port` and returns a ws:// URL to connect to. */
export async function startCdpShim(port) {
	const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
	const server = new WebSocketServer({ host: "127.0.0.1", port: 0, perMessageDeflate: false });
	await new Promise((resolve) => server.once("listening", resolve));
	server.on("connection", (client) => {
		const upstream = new WebSocket(webSocketDebuggerUrl, { perMessageDeflate: false });
		const pending = [];
		upstream.on("open", () => {
			for (const m of pending.splice(0)) upstream.send(m);
		});
		client.on("message", (data) => {
			const text = data.toString();
			const msg = JSON.parse(text);
			if (msg.method === "Browser.setDownloadBehavior") {
				client.send(JSON.stringify({ id: msg.id, sessionId: msg.sessionId, result: {} }));
			} else if (upstream.readyState === WebSocket.OPEN) {
				upstream.send(text);
			} else {
				pending.push(text);
			}
		});
		upstream.on("message", (data) => client.send(data.toString()));
		client.on("close", () => upstream.close());
		upstream.on("close", () => client.close());
	});
	return `ws://127.0.0.1:${server.address().port}`;
}
