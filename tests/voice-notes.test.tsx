/**
 * Unit tests — the voice box (voice-notes wave, owner 2026-10-25): spoken
 * thinking is NEVER shown as text. The pure seams (note accumulation,
 * duration, the submission's transcript), the box's render (count +
 * length, never the transcript), the spoken channels on answers and
 * practice thinking, and the "+ voice" tag on the learner's cards.
 */

import React from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	addVoiceNote,
	EMPTY_VOICE_NOTES,
	formatVoiceDuration,
	voiceText,
	VoiceNotesBox,
} from "../components/voice-notes.tsx";
import { ThinkingBlock } from "../components/thinking-block.tsx";
import { compactAnswerForModel, type QuestionAnswerData } from "../src/core/question-core.ts";
import { newThinkingMessage } from "../src/core/native-messages.ts";
import { parseChatInput } from "../src/core/input-events.ts";

describe("voice notes — the pure seams", () => {
	it("accumulates notes and time; an empty run counts time only", () => {
		let v = addVoiceNote(EMPTY_VOICE_NOTES, " first thought ", 12);
		v = addVoiceNote(v, "", 3);
		v = addVoiceNote(v, "second", 26);
		assert.deepEqual(v, { notes: ["first thought", "second"], seconds: 41 });
		assert.equal(voiceText(v), "first thought second");
		assert.equal(voiceText(EMPTY_VOICE_NOTES), undefined);
	});

	it("formats durations m:ss", () => {
		assert.equal(formatVoiceDuration(41), "0:41");
		assert.equal(formatVoiceDuration(125), "2:05");
		assert.equal(formatVoiceDuration(0), "0:00");
	});
});

describe("VoiceNotesBox — count + length, never the transcript", () => {
	it("empty: the mic and the invitation", () => {
		const html = renderToStaticMarkup(<VoiceNotesBox value={EMPTY_VOICE_NOTES} onClear={() => {}} />);
		assert.ok(html.includes("Think out loud"));
		assert.ok(html.includes('data-testid="voice-notes-mic"'));
		assert.ok(!html.includes('data-testid="voice-notes-clear"'));
	});

	it("with notes: the summary and the discard ×, no transcript text", () => {
		const v = { notes: ["the secret transcript", "more"], seconds: 41 };
		const html = renderToStaticMarkup(<VoiceNotesBox value={v} onClear={() => {}} />);
		assert.ok(html.includes("2 voice notes · 0:41"));
		assert.ok(html.includes('data-testid="voice-notes-clear"'));
		assert.ok(!html.includes("secret transcript"));
	});

	it("canRecord=false drops the mic button", () => {
		const html = renderToStaticMarkup(<VoiceNotesBox value={EMPTY_VOICE_NOTES} onClear={() => {}} canRecord={false} />);
		assert.ok(!html.includes('data-testid="voice-notes-mic"'));
	});
});

describe("the spoken channels reach the tutor, keyed apart", () => {
	const base: QuestionAnswerData = {
		kind: "quiz",
		questionText: "q",
		options: [],
		dontKnow: false,
		answers: [],
		answeredAt: "2026-10-25T00:00:00.000Z",
	} as QuestionAnswerData;

	it("compactAnswerForModel emits spokenThinking / spokenThinkingWhileReading", () => {
		const out = compactAnswerForModel({ ...base, thinking: "typed", spokenThinking: "said", spokenReadingThinking: "read aloud" });
		assert.equal(out.thinking, "typed");
		assert.equal(out.spokenThinking, "said");
		assert.equal(out.spokenThinkingWhileReading, "read aloud");
	});

	it("practice thinking: spoken is its own labeled section; details carry it", () => {
		const m = newThinkingMessage("call_p", "typed", "said aloud");
		assert.equal(m.content, "Your thinking:\ntyped\n\nSpoken thinking (transcribed):\nsaid aloud");
		assert.deepEqual(m.details, { problemCallId: "call_p", text: "typed", spoken: "said aloud" });
		const spokenOnly = newThinkingMessage("call_p", "", "only said");
		assert.equal(spokenOnly.content, "Spoken thinking (transcribed):\nonly said");
		assert.deepEqual(newThinkingMessage("call_p", "typed").details, { problemCallId: "call_p", text: "typed" });
	});

	it("a spoken-only practice submission parses; nothing at all still 400s", () => {
		assert.deepEqual(parseChatInput({ type: "thinking", problemCallId: "c", text: "", spoken: "hi" }), {
			type: "thinking",
			problemCallId: "c",
			text: "",
			spoken: "hi",
		});
		assert.throws(() => parseChatInput({ type: "thinking", problemCallId: "c", text: " ", spoken: " " }), /non-empty/);
	});
});

describe("ThinkingBlock — the '+ voice' tag", () => {
	it("typed + voice: the label carries the tag; the transcript never renders", () => {
		const html = renderToStaticMarkup(<ThinkingBlock text="typed bit" voice defaultOpen />);
		assert.ok(html.includes('data-testid="voice-tag"'));
		assert.ok(html.includes("typed bit"));
	});

	it("voice only: a plain tagged row, nothing to expand", () => {
		const html = renderToStaticMarkup(<ThinkingBlock text="" voice defaultOpen testId="t" />);
		assert.ok(html.includes('data-testid="voice-tag"'));
		assert.ok(!html.includes('data-testid="t-trigger"'));
	});
});
