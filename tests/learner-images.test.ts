/**
 * Show-your-work images (owner 2026-10-26): refs ride the record, the wire
 * loads bytes (or a placeholder), practice images expire once a later
 * practice item is posed or concluded, and the store keeps bytes beside
 * the chat.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import {
	asAgentMessages,
	newAnswerResult,
	newThinkingMessage,
	newUserMessage,
	PRACTICE_CONCLUDE_TOOL,
	PRACTICE_PROBLEM_TOOL,
	toLlmMessages,
	type LhMessage,
} from "../src/core/native-messages.ts";
import { parseImageRefs, type ImageRef } from "../src/core/images.ts";
import { inputAppends, parseChatInput, parseUserSteerInput } from "../src/core/input-events.ts";
import { chatImageLoader, readChatImage, removeChatImages, saveChatImages } from "../src/server/chat-images.ts";
import { projectView } from "../src/core/index.ts";

const REF: ImageRef = { id: "img_abc_123def.png", mimeType: "image/png", name: "work.png" };
const LOAD = (ref: ImageRef) => ({ data: `bytes:${ref.id}`, mimeType: ref.mimeType });

const STAMPS = {
	api: "faux",
	provider: "test",
	model: "test-model",
	usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	stopReason: "toolUse",
} as const;

function call(name: string, id: string, n: number): LhMessage[] {
	const assistant: LhMessage & AssistantMessage = {
		id: `msg_a_${id}`,
		role: "assistant",
		content: [{ type: "toolCall", id, name, arguments: {} }],
		timestamp: n,
		...STAMPS,
	};
	const ack: LhMessage & ToolResultMessage = {
		id: `msg_r_${id}`,
		role: "toolResult",
		toolCallId: id,
		toolName: name,
		content: [{ type: "text", text: "ok" }],
		details: null,
		isError: false,
		timestamp: n + 1,
	};
	return [assistant, ack];
}

function imageBlocks(content: unknown): Array<{ type: string; data?: string; text?: string }> {
	return (content as Array<{ type: string; data?: string; text?: string }>);
}

describe("parseImageRefs", () => {
	it("keeps well-formed refs and drops the rest", () => {
		const refs = parseImageRefs([REF, { id: "../etc/passwd", mimeType: "image/png" }, { id: REF.id, mimeType: "text/html" }, 7]);
		assert.deepEqual(refs, [REF]);
	});
	it("caps at ten and reads empty as absent", () => {
		assert.equal(parseImageRefs(Array.from({ length: 14 }, () => REF))!.length, 10);
		assert.equal(parseImageRefs([]), undefined);
		assert.equal(parseImageRefs("nope"), undefined);
	});
});

describe("input events carry images", () => {
	it("an image alone is a valid text send, thinking, and steer", () => {
		assert.deepEqual(parseChatInput({ type: "text", text: "", images: [REF] }), { type: "text", text: "", images: [REF] });
		const thinking = parseChatInput({ type: "thinking", problemCallId: "call_p1", text: "", images: [REF] });
		assert.deepEqual(thinking, { type: "thinking", problemCallId: "call_p1", text: "", images: [REF] });
		assert.deepEqual(parseUserSteerInput({ type: "steer", id: "steer_1", text: "", images: [REF] }).images, [REF]);
	});
	it("still refuses a send with nothing in it", () => {
		assert.throws(() => parseChatInput({ type: "text", text: " ", images: [{ id: "bad" }] }));
	});
	it("answers keep only valid refs", () => {
		const input = parseChatInput({ type: "answer", toolCallId: "c", answer: { kind: "quiz", images: [REF, { id: "x" }] } });
		assert.deepEqual((input as { answer: { images?: unknown } }).answer.images, [REF]);
	});
	it("the text append records refs on the user message", () => {
		const [m] = inputAppends({ messages: [] }, { type: "text", text: "see", images: [REF] });
		assert.deepEqual((m as { images?: unknown }).images, [REF]);
	});
});

describe("toLlmMessages loads images at the wire", () => {
	it("a chat message carries its text then the images", () => {
		const [out] = toLlmMessages(asAgentMessages([newUserMessage("my work", undefined, [REF])]), { loadImage: LOAD });
		const blocks = imageBlocks(out!.content);
		assert.equal(blocks[0]!.text, "my work");
		assert.equal(blocks.at(-1)!.type, "image");
		assert.equal(blocks.at(-1)!.data, `bytes:${REF.id}`);
		assert.equal((out as { images?: unknown }).images, undefined, "the ref field never reaches the provider");
	});
	it("without a loader (or a missing file) the image is a placeholder", () => {
		const [out] = toLlmMessages(asAgentMessages([newUserMessage("x", undefined, [REF])]));
		assert.match(imageBlocks(out!.content).at(-1)!.text!, /not available/);
	});
	it("practice thinking images stay while the problem is live", () => {
		const record = [...call(PRACTICE_PROBLEM_TOOL, "call_p1", 1), newThinkingMessage("call_p1", "", undefined, [REF])];
		const out = toLlmMessages(asAgentMessages(record), { loadImage: LOAD });
		assert.equal(imageBlocks(out.at(-1)!.content).at(-1)!.type, "image");
	});
	it("and expire once the problem concludes", () => {
		const record = [
			...call(PRACTICE_PROBLEM_TOOL, "call_p1", 1),
			newThinkingMessage("call_p1", "here", undefined, [REF]),
			...call(PRACTICE_CONCLUDE_TOOL, "call_c1", 5),
		];
		const out = toLlmMessages(asAgentMessages(record), { loadImage: LOAD });
		const thinking = out.find((m) => m.role === "user")!;
		const blocks = imageBlocks(thinking.content);
		assert.ok(blocks.every((b) => b.type === "text"));
		assert.match(blocks.at(-1)!.text!, /removed after the problem concluded/);
	});
	it("teaching quiz answers keep their images", () => {
		const answer = newAnswerResult("call_q", "quiz", { kind: "quiz", answers: [], dontKnow: false, images: [REF] });
		const record = [...call("quiz", "call_q", 1).slice(0, 1), answer, ...call(PRACTICE_PROBLEM_TOOL, "call_p9", 9)];
		const out = toLlmMessages(asAgentMessages(record), { loadImage: LOAD });
		const result = out.find((m) => m.role === "toolResult")!;
		assert.equal(imageBlocks(result.content).at(-1)!.type, "image");
		assert.match(imageBlocks(result.content)[0]!.text!, /"imagesAttached":1/);
	});
});

describe("the view shows thumbnails", () => {
	it("a user message projects a data-images part", () => {
		const view = projectView(asAgentMessages([newUserMessage("x", undefined, [REF])]) as never);
		const parts = (view[0] as { parts: Array<{ type: string }> }).parts;
		assert.ok(parts.some((p) => p.type === "data-images"));
	});
});

describe("the chat image store", () => {
	it("saves, reads back, loads base64, and removes", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-img-"));
		try {
			const saved = saveChatImages("chat_x", [{ name: "a.png", mimeType: "image/png", bytes: new Uint8Array([1, 2, 3]) }], root);
			assert.ok(saved.ok);
			const ref = saved.images[0]!;
			assert.deepEqual([...readChatImage("chat_x", ref.id, root)!], [1, 2, 3]);
			assert.equal(chatImageLoader("chat_x", root)(ref)!.data, Buffer.from([1, 2, 3]).toString("base64"));
			assert.equal(readChatImage("../chat_x", ref.id, root), null);
			removeChatImages("chat_x", root);
			assert.equal(readChatImage("chat_x", ref.id, root), null);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
	it("refuses non-images and oversize batches before writing", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-img-"));
		try {
			const bad = saveChatImages("chat_x", [{ name: "a.svg", mimeType: "image/svg+xml", bytes: new Uint8Array([1]) }], root);
			assert.equal(bad.ok, false);
			const many = saveChatImages("chat_x", Array.from({ length: 11 }, () => ({ name: "a.png", mimeType: "image/png", bytes: new Uint8Array([1]) })), root);
			assert.equal(many.ok, false);
			assert.equal(fs.existsSync(path.join(root, "chat-images", "chat_x")), false);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
