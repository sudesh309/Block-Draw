import { Platform, requestUrl, type App } from "obsidian";
import type { SecretStore } from "../kernel/settings";
import { deviceSecrets } from "./secrets";

/** The parts of Node's `http` module used for the sign-in redirect (desktop only). */
interface LocalServer {
	listen(port: number, host: string, cb: () => void): void;
	address(): { port: number } | string | null;
	close(): void;
	on(event: "error", cb: (e: Error) => void): void;
}
interface IncomingRequest {
	url?: string;
}
interface ServerResponse {
	writeHead(status: number, headers?: Record<string, string>): void;
	end(body?: string): void;
}
interface NodeHttp {
	createServer(handler: (req: IncomingRequest, res: ServerResponse) => void): LocalServer;
}

/**
 * Google OAuth for the "Google account" export method (desktop only).
 * Uses the installed-app flow: a temporary server on 127.0.0.1 receives the redirect, PKCE
 * protects the code exchange. Tokens are stored per device (Obsidian secret storage when
 * available, otherwise this vault's local storage), never in the synced plugin settings.
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
/** Only files created by this app are accessible. */
export const GOOGLE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const STORE_KEY = "block-draw-google-oauth";
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

interface StoredTokens {
	refreshToken: string;
	accessToken?: string;
	expiresAt?: number;
	clientId: string;
}

function base64Url(bytes: Uint8Array): string {
	let s = "";
	bytes.forEach((b) => (s += String.fromCharCode(b)));
	return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(bytes = 48): string {
	const buf = new Uint8Array(bytes);
	crypto.getRandomValues(buf);
	return base64Url(buf);
}

async function sha256(text: string): Promise<Uint8Array> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return new Uint8Array(digest);
}

function form(body: Record<string, string>): string {
	return Object.entries(body)
		.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
		.join("&");
}

export class GoogleAuth {
	/** Tokens live on this device (secret storage, or this vault's local storage), never in the synced settings. */
	private readonly secrets: SecretStore;

	constructor(
		app: App,
		private readonly getClient: () => { clientId: string; clientSecret: string },
	) {
		this.secrets = deviceSecrets(app);
	}

	/* ------------------------------------------------------------ storage */

	private read(): StoredTokens | null {
		const raw = this.secrets.get(STORE_KEY);
		if (!raw) return null;
		try {
			const data = JSON.parse(raw) as StoredTokens;
			return data && typeof data.refreshToken === "string" ? data : null;
		} catch {
			return null;
		}
	}

	private write(tokens: StoredTokens | null): void {
		if (!this.secrets.set(STORE_KEY, tokens ? JSON.stringify(tokens) : "")) {
			throw new Error("Could not save the Google sign-in on this device.");
		}
	}

	isSignedIn(): boolean {
		const t = this.read();
		return !!t && t.clientId === this.getClient().clientId;
	}

	/* ------------------------------------------------------------ sign in */

	async signIn(): Promise<void> {
		if (!Platform.isDesktopApp) throw new Error("Signing in with Google is only available in the desktop app. Use the Apps Script method on mobile.");
		const { clientId, clientSecret } = this.getClient();
		if (!clientId) throw new Error("Enter your OAuth client ID in the Block Draw settings first.");

		const verifier = randomString(48);
		const challenge = base64Url(await sha256(verifier));
		const state = randomString(16);
		const { code, redirectUri } = await this.waitForCode(clientId, challenge, state);

		const res = await requestUrl({
			url: TOKEN_URL,
			method: "POST",
			contentType: "application/x-www-form-urlencoded",
			body: form({
				code,
				client_id: clientId,
				client_secret: clientSecret,
				redirect_uri: redirectUri,
				grant_type: "authorization_code",
				code_verifier: verifier,
			}),
			throw: false,
		});
		const data = res.json as { refresh_token?: string; access_token?: string; expires_in?: number; error_description?: string; error?: string };
		if (res.status >= 400 || !data.access_token) {
			throw new Error(`Google sign-in failed: ${data.error_description || data.error || `HTTP ${res.status}`}`);
		}
		if (!data.refresh_token) throw new Error("Google did not return a refresh token. Remove Block Draw's access in your Google account and sign in again.");
		this.write({
			clientId,
			refreshToken: data.refresh_token,
			accessToken: data.access_token,
			expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
		});
	}

	/** Opens the consent page and waits for Google to redirect back to a local server. */
	private waitForCode(clientId: string, challenge: string, state: string): Promise<{ code: string; redirectUri: string }> {
		// Node's http module is only available in the desktop app; load it lazily.
		const http = (window as unknown as { require: (m: string) => NodeHttp }).require("http");
		return new Promise((resolve, reject) => {
			let redirectUri = "";
			let settled = false;
			const server = http.createServer((req, res) => {
				const url = new URL(req.url ?? "/", "http://127.0.0.1");
				if (url.pathname !== "/") {
					res.writeHead(404);
					res.end();
					return;
				}
				const error = url.searchParams.get("error");
				const code = url.searchParams.get("code");
				const ok = !error && !!code && url.searchParams.get("state") === state;
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
				res.end(
					`<!doctype html><meta charset="utf-8"><title>Block Draw</title><body style="font-family:system-ui,sans-serif;padding:40px">` +
						(ok
							? "<h2>Block Draw is connected to Google.</h2><p>You can close this tab and return to Obsidian.</p>"
							: "<h2>Sign-in was not completed.</h2><p>Return to Obsidian and try again.</p>") +
						"</body>",
				);
				finish(ok ? null : new Error(error ? `Google sign-in failed: ${error}` : "Google sign-in failed."), code ?? "");
			});
			const timer = window.setTimeout(() => finish(new Error("Google sign-in timed out."), ""), SIGN_IN_TIMEOUT_MS);
			const finish = (err: Error | null, code: string) => {
				if (settled) return;
				settled = true;
				window.clearTimeout(timer);
				server.close();
				if (err) reject(err);
				else resolve({ code, redirectUri });
			};
			server.on("error", (e) => finish(e, ""));
			server.listen(0, "127.0.0.1", () => {
				const address = server.address();
				const port = typeof address === "object" && address ? address.port : 0;
				redirectUri = `http://127.0.0.1:${port}`;
				const params = new URLSearchParams({
					client_id: clientId,
					redirect_uri: redirectUri,
					response_type: "code",
					scope: GOOGLE_SCOPE,
					code_challenge: challenge,
					code_challenge_method: "S256",
					access_type: "offline",
					prompt: "consent",
					state,
				});
				window.open(`${AUTH_URL}?${params.toString()}`);
			});
		});
	}

	async signOut(): Promise<void> {
		const tokens = this.read();
		this.write(null);
		if (tokens?.refreshToken) {
			await requestUrl({
				url: `${REVOKE_URL}?token=${encodeURIComponent(tokens.refreshToken)}`,
				method: "POST",
				contentType: "application/x-www-form-urlencoded",
				throw: false,
			}).catch(() => undefined);
		}
	}

	/** A valid access token, refreshed when it is about to expire. */
	async accessToken(): Promise<string> {
		const tokens = this.read();
		const { clientId, clientSecret } = this.getClient();
		if (!tokens || tokens.clientId !== clientId) throw new Error("Sign in to Google in the Block Draw settings first.");
		if (tokens.accessToken && tokens.expiresAt && tokens.expiresAt - 60_000 > Date.now()) return tokens.accessToken;
		const res = await requestUrl({
			url: TOKEN_URL,
			method: "POST",
			contentType: "application/x-www-form-urlencoded",
			body: form({
				client_id: clientId,
				client_secret: clientSecret,
				refresh_token: tokens.refreshToken,
				grant_type: "refresh_token",
			}),
			throw: false,
		});
		const data = res.json as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
		if (res.status >= 400 || !data.access_token) {
			if (data.error === "invalid_grant") this.write(null);
			throw new Error(
				data.error === "invalid_grant"
					? "Your Google sign-in expired. Sign in again in the Block Draw settings."
					: `Could not refresh the Google token: ${data.error_description || data.error || `HTTP ${res.status}`}`,
			);
		}
		this.write({ ...tokens, accessToken: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 });
		return data.access_token;
	}
}
