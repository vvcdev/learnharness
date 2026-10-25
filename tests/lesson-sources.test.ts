import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { appendLessonSources, lessonSourceError } from "../src/core/lesson-sources.ts";
import { removeSessionSources, saveLessonSources } from "../src/server/session-sources.ts";
import { applyRefreshResponse, keychainAccountFromDump, parseClaudeCodeKeychain } from "../src/agent/claude-code-auth.ts";
import { claudeCodeError, claudeCodeHistory } from "../src/agent/claude-code-stream.ts";
import { subscriptionLabel } from "../src/core/prices.ts";
import type { Model, TranscriptContext } from "@earendil-works/pi-ai";

describe("lesson sources", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-sources-"));
	after(() => fs.rmSync(root, { recursive: true, force: true }));

	it("keeps the learner's words and names the saved paths", () => {
		const text = appendLessonSources("explain this", ["/tmp/notes.md"]);
		assert.match(text, /^explain this/);
		assert.match(text, /\/tmp\/notes\.md/);
		assert.match(text, /pdf tool/);
	});

	it("rejects a kind the teacher cannot read", () => {
		assert.match(lessonSourceError("archive.zip", 10, 0) ?? "", /PDF|Word|text|code|data|image/);
	});

	it("accepts common text, code, data, and Office uploads", () => {
		assert.equal(lessonSourceError("notes.csv", 12, 0), null);
		assert.equal(lessonSourceError("main.py", 20, 0), null);
		assert.equal(lessonSourceError("brief.json", 8, 0), null);
		assert.equal(lessonSourceError("page.html", 40, 0), null);
		assert.equal(lessonSourceError("essay.docx", 100, 0), null);
		assert.equal(lessonSourceError("slides.pptx", 100, 0), null);
		assert.equal(lessonSourceError("grades.xlsx", 100, 0), null);
	});

	it("stores a file under the session and removes it with the session", () => {
		const saved = saveLessonSources("chat_abc", [{ name: "notes.md", bytes: new TextEncoder().encode("# hi") }], root);
		assert.equal(saved.ok, true);
		if (!saved.ok) return;
		assert.equal(fs.readFileSync(saved.paths[0]!, "utf8"), "# hi");
		removeSessionSources("chat_abc", root);
		assert.equal(fs.existsSync(path.dirname(saved.paths[0]!)), false);
	});
});

describe("claude code login", () => {
	it("reads the keychain shape and ignores anything else", () => {
		const raw = JSON.stringify({ claudeAiOauth: { accessToken: "sk-ant-oat01-example", refreshToken: "refresh", expiresAt: 10, subscriptionType: "pro" } });
		assert.equal(parseClaudeCodeKeychain(raw)?.blob.subscriptionType, "pro");
		assert.equal(parseClaudeCodeKeychain("{}"), null);
		assert.equal(keychainAccountFromDump('"acct"<blob>="vek"', "fallback"), "vek");
	});

	it("replaces the access token from a refresh response", () => {
		const next = applyRefreshResponse(
			{ accessToken: "sk-ant-oat01-old", refreshToken: "refresh", expiresAt: 1 },
			{ access_token: "sk-ant-oat01-new", expires_in: 60 },
			1_000,
		);
		assert.equal(next.accessToken, "sk-ant-oat01-new");
		assert.equal(next.expiresAt, 61_000);
		assert.equal(next.refreshToken, "refresh");
	});

	it("counts as a subscription and says when the login is missing", () => {
		assert.equal(subscriptionLabel("claude-code:claude-sonnet"), "Claude Code");
		assert.match(claudeCodeError("Claude Code is not signed in"), /claude auth login/);
		assert.match(claudeCodeError("Claude Code is not signed in. Run claude auth login in Terminal, then try again. No API-key fallback was used."), /No API-key fallback was used\.$/);
	});

	it("sends its own earlier turns as Anthropic turns", () => {
		const logical = { provider: "claude-code", api: "anthropic-messages", id: "claude", input: ["text"] } as Model<"anthropic-messages">;
		const rewritten = claudeCodeHistory({
			messages: [
				{ role: "assistant", provider: "claude-code", api: "anthropic-messages", model: "claude", content: [{ type: "text", text: "hi" }], stopReason: "stop", timestamp: 1, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } },
			],
		} as TranscriptContext, logical);
		assert.equal(rewritten.messages[0]?.role === "assistant" && rewritten.messages[0].provider, "anthropic");
	});
});
