/**
 * The short "why" on an answered card (owner, 2026-10-27): shown from the
 * recorded analysis for a miss, a quiet pending line while it is written,
 * nothing for a right answer or outside a chat.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AnsweredCard } from "../components/answered-card.tsx";
import { MistakesContext } from "../components/mistakes-context.ts";
import type { MistakeRecord } from "../src/core/mistakes.ts";
import type { QuestionAnswerData } from "../src/core/question-core.ts";

const answer: QuestionAnswerData = {
	kind: "quiz",
	questionText: "Friction on the block?",
	options: [{ index: 1, label: "69 N" }, { index: 2, label: "50 N" }],
	correctIndices: [2],
	answers: [{ label: "69 N", value: "a", index: 1 }],
	dontKnow: false,
	correct: false,
	explanation: "Static friction balances the pull.",
	answeredAt: "2026-10-27T10:00:00.000Z",
};

const record = (over: Partial<MistakeRecord>): MistakeRecord => ({
	id: "c1:q1", chatId: "c1", kind: "missed", origin: "quiz", question: "q", yourAnswer: "69 N", correctAnswer: "50 N",
	answeredAt: "x", createdAt: "x", sessionTitle: "Friction", sessionKind: "teach", sources: [], status: "ready",
	analysis: { errorType: "setup-error", topic: "static friction", whatYouDid: "You used mu N.", correct: "It is 50 N.", rule: "mu N is the ceiling." },
	...over,
});

const html = (map: Map<string, MistakeRecord>, mistakeId?: string) =>
	renderToStaticMarkup(
		<MistakesContext.Provider value={map}>
			<AnsweredCard answer={answer} mistakeId={mistakeId} />
		</MistakesContext.Provider>,
	);

describe("AnsweredCard mistake analysis", () => {
	it("shows the error type, what happened, what is right, and the rule", () => {
		const out = html(new Map([["c1:q1", record({})]]), "c1:q1");
		assert.match(out, /data-testid="mistake-why"/);
		assert.match(out, /Setup error/);
		assert.match(out, /You used mu N\./);
		assert.match(out, /It is 50 N\./);
		assert.match(out, /Next time: /);
		assert.match(out, /mu N is the ceiling\./);
	});
	it("shows a quiet line while the analysis is being written", () => {
		const out = html(new Map([["c1:q1", record({ status: "pending", analysis: undefined })]]), "c1:q1");
		assert.match(out, /Working out why/);
		assert.doesNotMatch(out, /mistake-why"/);
	});
	it("shows nothing for an unrecorded answer, a failed analysis, or no context", () => {
		assert.doesNotMatch(html(new Map(), "c1:q1"), /mistake-why/);
		assert.doesNotMatch(html(new Map([["c1:q1", record({ status: "failed", analysis: undefined })]]), "c1:q1"), /mistake-why|Working out why/);
		assert.doesNotMatch(renderToStaticMarkup(<AnsweredCard answer={answer} />), /mistake-why/);
	});
});
