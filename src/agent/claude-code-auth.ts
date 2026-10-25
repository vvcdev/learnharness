/**
 * The Claude Code login already on this machine (macOS keychain item
 * "Claude Code-credentials"). LearnHarness uses that login for its own
 * teacher. It never reads or writes an Anthropic API key.
 */
import { spawnSync } from "node:child_process";
import os from "node:os";

export const CLAUDE_CODE_PROVIDER = "claude-code";

const SERVICE = "Claude Code-credentials";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const REFRESH_SKEW_MS = 5 * 60 * 1000;

export interface ClaudeOauthBlob {
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
	refreshTokenExpiresAt?: number;
	scopes?: string[];
	subscriptionType?: string;
	rateLimitTier?: string;
}

export interface ClaudeCodeStatus {
	loggedIn: boolean;
	subscription: string | null;
}

interface KeychainFile {
	claudeAiOauth?: ClaudeOauthBlob;
}

let memory: { file: KeychainFile; blob: ClaudeOauthBlob } | null = null;
let refreshing: Promise<string> | null = null;

export function parseClaudeCodeKeychain(raw: string): { file: KeychainFile; blob: ClaudeOauthBlob } | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object") return null;
	const file = parsed as KeychainFile;
	const blob = file.claudeAiOauth;
	if (!blob || typeof blob.accessToken !== "string" || typeof blob.refreshToken !== "string" || typeof blob.expiresAt !== "number") return null;
	if (!blob.accessToken.startsWith("sk-ant-oat")) return null;
	return { file, blob };
}

export function keychainAccountFromDump(dump: string, fallback: string): string {
	const match = dump.match(/"acct"<blob>="([^"]+)"/);
	return match?.[1] || fallback;
}

export function applyRefreshResponse(current: ClaudeOauthBlob, body: { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown }, now: number): ClaudeOauthBlob {
	if (typeof body.access_token !== "string" || !body.access_token.startsWith("sk-ant-oat")) {
		throw new Error("Claude Code login could not be refreshed. Run claude auth login.");
	}
	if (typeof body.expires_in !== "number" || !Number.isFinite(body.expires_in) || body.expires_in <= 0) {
		throw new Error("Claude Code login could not be refreshed. Run claude auth login.");
	}
	return {
		...current,
		accessToken: body.access_token,
		refreshToken: typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : current.refreshToken,
		expiresAt: now + body.expires_in * 1000,
	};
}

function testing(): boolean {
	return process.env.NODE_ENV === "test";
}

function readKeychain(): { file: KeychainFile; blob: ClaudeOauthBlob } | null {
	if (testing() || process.platform !== "darwin") return null;
	const dumped = spawnSync("security", ["find-generic-password", "-s", SERVICE, "-w"], { encoding: "utf8" });
	if (dumped.status !== 0) return null;
	return parseClaudeCodeKeychain(dumped.stdout.trim());
}

function load(): { file: KeychainFile; blob: ClaudeOauthBlob } | null {
	if (memory && memory.blob.expiresAt - Date.now() > REFRESH_SKEW_MS) return memory;
	const fresh = readKeychain();
	memory = fresh;
	return fresh;
}

export function claudeCodeStatus(): ClaudeCodeStatus {
	const loaded = load();
	if (!loaded) return { loggedIn: false, subscription: null };
	return { loggedIn: true, subscription: loaded.blob.subscriptionType ?? null };
}

export function claudeCodeConnected(): boolean {
	return claudeCodeStatus().loggedIn;
}

function writeKeychain(file: KeychainFile, blob: ClaudeOauthBlob): void {
	const dump = spawnSync("security", ["find-generic-password", "-s", SERVICE], { encoding: "utf8" });
	const account = keychainAccountFromDump(`${dump.stdout}\n${dump.stderr}`, os.userInfo().username);
	const payload = JSON.stringify({ ...file, claudeAiOauth: blob });
	const written = spawnSync("security", ["add-generic-password", "-U", "-s", SERVICE, "-a", account, "-w", payload], { encoding: "utf8" });
	if (written.status !== 0) {
		console.error("[claude-code] could not store the refreshed login back in the keychain");
	}
}

async function refresh(file: KeychainFile, blob: ClaudeOauthBlob): Promise<string> {
	const response = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json", Accept: "application/json" },
		body: JSON.stringify({ grant_type: "refresh_token", client_id: CLIENT_ID, refresh_token: blob.refreshToken }),
	});
	const text = await response.text();
	if (!response.ok) throw new Error("Claude Code login could not be refreshed. Run claude auth login.");
	let body: { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
	try {
		body = JSON.parse(text) as typeof body;
	} catch {
		throw new Error("Claude Code login could not be refreshed. Run claude auth login.");
	}
	const next = applyRefreshResponse(blob, body, Date.now());
	memory = { file, blob: next };
	writeKeychain(file, next);
	return next.accessToken;
}

/** A live access token. Refreshes the keychain login when it is near expiry. */
export async function claudeCodeAccessToken(): Promise<string> {
	const loaded = load();
	if (!loaded) throw new Error("Claude Code is not signed in. Run claude auth login.");
	if (loaded.blob.expiresAt - Date.now() > REFRESH_SKEW_MS) return loaded.blob.accessToken;
	refreshing ??= refresh(loaded.file, loaded.blob).finally(() => {
		refreshing = null;
	});
	return refreshing;
}
