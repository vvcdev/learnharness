/**
 * Switching modes (2026-10-27): the pure opening/title builders, and the
 * POST /api/chats/:id/switch route — a NEW session in the target mode,
 * seeded with the old transcript as a source, the old one untouched.
 * Runs under an isolated LH_DATA_DIR (set before any config-loading import).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, describe, it } from "node:test";
import { isSwitchMode, switchOpening, switchTitle } from "../src/core/mode-switch.ts";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-mode-switch-"));
process.env.LH_DATA_DIR = TMP_DATA;

describe("mode-switch builders", () => {
	it("validates modes", () => {
		assert.equal(isSwitchMode("teach"), true);
		assert.equal(isSwitchMode("probe"), false);
		assert.equal(isSwitchMode(undefined), false);
	});
	it("writes an opening per direction, with and without a focus note", () => {
		assert.match(switchOpening("teach", "chat", "the chain rule"), /I hit a gap in the attached chat session/);
		assert.match(switchOpening("teach", "chat", "the chain rule"), /The gap: the chain rule/);
		assert.match(switchOpening("teach", "chat", ""), /Find the gap from the transcript/);
		assert.match(switchOpening("practice", "teach", "derivatives"), /practice on what the attached teaching session \(its transcript\) covered/);
		assert.match(switchOpening("practice", "teach", "derivatives"), /Focus on: derivatives/);
		assert.match(switchOpening("practice", "teach", ""), /least secure/);
		assert.match(switchOpening("chat", "practice", "  "), /Take it from where it left off/);
	});
	it("titles by the note, else mode + old title", () => {
		assert.equal(switchTitle("teach", "Limits", " chain rule "), "chain rule");
		assert.equal(switchTitle("practice", "Limits", ""), "Practice: Limits");
	});
});

type Post = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
let POST: Post;
let createChat: (title: string, kind?: "practice" | "chat") => { id: string };
let getChat: (id: string) => { kind?: string; title: string; messages: unknown[] } | undefined;
let saveMessages: (id: string, messages: unknown[]) => void;
let sessionSourcesDir: (id: string) => string;

before(async () => {
	POST = (await import("../app/api/chats/[id]/switch/route.ts")).POST;
	const server = await import("../src/server/chats.ts");
	createChat = server.createChat as typeof createChat;
	getChat = server.getChat as typeof getChat;
	saveMessages = (id, messages) => void import("../src/store/chats.ts").then(({ chatStore }) => chatStore.saveMessages(id, messages as never));
	sessionSourcesDir = (await import("../src/server/session-sources.ts")).sessionSourcesDir;
	const { chatStore } = await import("../src/store/chats.ts");
	saveMessages = (id, messages) => chatStore.saveMessages(id, messages as never);
});
after(() => fs.rmSync(TMP_DATA, { recursive: true, force: true }));

const post = (id: string, body: unknown) =>
	POST(new Request("http://x/api", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

describe("POST /api/chats/:id/switch", () => {
	it("404s unknown chats and 400s bad modes, same-mode, and empty sessions", async () => {
		assert.equal((await post("nope", { mode: "teach" })).status, 404);
		const chat = createChat("Empty", "chat");
		assert.equal((await post(chat.id, { mode: "banana" })).status, 400);
		assert.equal((await post(chat.id, { mode: "chat" })).status, 400, "already in that mode");
		assert.equal((await post(chat.id, { mode: "teach" })).status, 400, "nothing to carry over");
	});

	it("creates a session of the target kind seeded with the transcript, leaving the old one alone", async () => {
		const from = createChat("Chain rule chat", "chat");
		saveMessages(from.id, [
			{ role: "user", content: "why does d/dx sin(x^2) have a 2x?", timestamp: 1 },
			{ role: "assistant", content: [{ type: "text", text: "Because of the chain rule." }], timestamp: 2 },
		]);
		const res = await post(from.id, { mode: "teach", focus: "the chain rule" });
		assert.equal(res.status, 200);
		const body = (await res.json()) as { id: string; prompt: string };
		assert.notEqual(body.id, from.id);
		const created = getChat(body.id)!;
		assert.equal(created.kind, undefined, "teach sessions carry no kind");
		assert.equal(created.title, "the chain rule");
		assert.match(body.prompt, /The gap: the chain rule/);
		assert.match(body.prompt, /Sources for this lesson/);
		const dir = sessionSourcesDir(body.id);
		const files = fs.readdirSync(dir).filter((f) => !f.startsWith("."));
		assert.equal(files.length, 1);
		assert.match(fs.readFileSync(path.join(dir, files[0]!), "utf8"), /chain rule/i);
		assert.equal(getChat(from.id)!.messages.length, 2, "the old session is untouched");

		const practice = (await (await post(from.id, { mode: "practice" })).json()) as { id: string };
		assert.equal(getChat(practice.id)!.kind, "practice");
	});
});
