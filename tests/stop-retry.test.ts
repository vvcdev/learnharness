/**
 * Stop → Edit / Regenerate (owner 2026-10-26): a stopped reply is found
 * at the record's end, a retry cuts it away (Regenerate keeps the input,
 * Edit replaces it), and silent MCQ answers are never "stopped".
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { stoppedTurnOf } from "../src/core/retry.ts";
import { ChatInputError, parseChatInput, retryAppends } from "../src/core/input-events.ts";
import {
	danglingQuestionOf,
	newAnswerResult,
	newNextMessage,
	newThinkingMessage,
	newUserMessage,
	type LhMessage,
} from "../src/core/native-messages.ts";

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

function reply(stopReason: "aborted" | "stop" | "toolUse", content: AssistantMessage["content"] = [{ type: "text", text: "partial" }]): LhMessage {
	return { id: `a_${Math.random()}`, role: "assistant", content, api: "faux", provider: "t", model: "m", usage, stopReason, timestamp: 2 } as LhMessage;
}

describe("stoppedTurnOf", () => {
	it("finds a typed message whose reply was stopped", () => {
		const record = [newUserMessage("first"), reply("stop"), newUserMessage("explain more"), reply("aborted")];
		const s = stoppedTurnOf(record)!;
		assert.equal(s.inputIndex, 2);
		assert.equal(s.editable, "text");
		assert.equal(s.text, "explain more");
	});
	it("a finished reply is not stopped", () => {
		assert.equal(stoppedTurnOf([newUserMessage("hi"), reply("stop")]), null);
	});
	it("an input with no reply at all counts (stopped before the first token)", () => {
		assert.equal(stoppedTurnOf([reply("stop"), newUserMessage("hi")])!.editable, "text");
	});
	it("a practice thinking submission is editable on its problem", () => {
		const s = stoppedTurnOf([newThinkingMessage("call_p", "x = 2"), reply("aborted")])!;
		assert.equal(s.editable, "thinking");
		assert.equal(s.problemCallId, "call_p");
	});
	it("Next is regenerate-only", () => {
		assert.equal(stoppedTurnOf([newNextMessage(), reply("aborted")])!.editable, null);
	});
	it("a silent MCQ answer is a pause, never stopped", () => {
		const call = reply("toolUse", [{ type: "toolCall", id: "c1", name: "mcq", arguments: {} }]);
		const answer = newAnswerResult("c1", "mcq", { kind: "quiz", answers: [], dontKnow: true });
		assert.equal(stoppedTurnOf([call, answer]), null);
	});
	it("a question cut off by Stop is not pending", () => {
		const cut = reply("aborted", [{ type: "toolCall", id: "q", name: "mcq_batch", arguments: {} }]);
		assert.equal(danglingQuestionOf([newUserMessage("go"), cut]), null);
	});
});

describe("retryAppends", () => {
	const record = [newUserMessage("first"), reply("stop"), newUserMessage("oops"), reply("aborted")];
	it("regenerate keeps the input and drops the stopped reply", () => {
		const { base, appends } = retryAppends({ messages: record }, { type: "regenerate" });
		assert.equal(base.length, 3);
		assert.deepEqual(appends, []);
	});
	it("edit replaces the input", () => {
		const { base, appends } = retryAppends({ messages: record }, { type: "edit", text: "fixed" });
		assert.equal(base.length, 2);
		assert.equal((appends[0] as { content: string }).content, "fixed");
	});
	it("edit of a thinking submission re-targets the same problem", () => {
		const { appends } = retryAppends({ messages: [newThinkingMessage("call_p", "a"), reply("aborted")] }, { type: "edit", text: "b" });
		assert.equal((appends[0] as { details: { problemCallId: string } }).details.problemCallId, "call_p");
	});
	it("refuses with nothing stopped, or an uneditable input", () => {
		assert.throws(() => retryAppends({ messages: [newUserMessage("a"), reply("stop")] }, { type: "regenerate" }), ChatInputError);
		assert.throws(() => retryAppends({ messages: [newNextMessage(), reply("aborted")] }, { type: "edit", text: "x" }), ChatInputError);
	});
	it("parses both inputs", () => {
		assert.deepEqual(parseChatInput({ type: "regenerate" }), { type: "regenerate" });
		assert.deepEqual(parseChatInput({ type: "edit", text: "x" }), { type: "edit", text: "x" });
	});
});
