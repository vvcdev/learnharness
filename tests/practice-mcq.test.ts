/**
 * Practice formats (owner 2026-10-26): the registry follows the chosen
 * format, MCQs validate like quizzes (plus a fixed batch size), answers
 * land SILENTLY and pause the session until Next, and a batch's result
 * compacts to one graded line per question.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import { practiceTools } from "../src/agent/tools/practice.ts";
import {
	DEFAULT_PRACTICE_SETTINGS,
	parsePracticeSettings,
	type PracticeSettings,
} from "../src/core/contracts/chat.ts";
import { dismissAppends, parseDismissInput } from "../src/core/input-events.ts";
import {
	endsInDismissal,
	needsContinuation,
	newAnswerResult,
	PRACTICE_PROBLEM_TOOL,
	type LhMessage,
} from "../src/core/native-messages.ts";
import { compactAnswerForModel, optionLengthProblems, type QuestionAnswerData } from "../src/core/question-core.ts";

const STAMPS = {
	api: "faux",
	provider: "test",
	model: "test-model",
	usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	stopReason: "toolUse",
} as const;

function ctx(messages: LhMessage[], practice?: PracticeSettings) {
	return {
		chatId: "c1",
		chatStore: { getChat: () => ({ messages, kind: "practice" }) },
		...(practice ? { practice } : {}),
	};
}

const ITEM = {
	mode: "recall",
	question: "2 + 2?",
	options: [
		{ label: "4", value: "a" },
		{ label: "5", value: "b" },
	],
	explanation: "Add them.",
	correctAnswer: "a",
};

function posing(practice?: PracticeSettings): string[] {
	const keys = Object.keys(practiceTools(ctx([], practice)));
	return keys.filter((k) => ["problem", "conclude", "mcq", "mcq_batch"].includes(k)).sort();
}

function mcqCall(name: "mcq" | "mcq_batch", id: string): LhMessage {
	const call: LhMessage & AssistantMessage = {
		id: `msg_${id}`,
		role: "assistant",
		content: [{ type: "toolCall", id, name, arguments: name === "mcq" ? ITEM : { questions: [ITEM, ITEM] } }],
		timestamp: 1,
		...STAMPS,
	};
	return call;
}

function activeProblem(): LhMessage[] {
	const pose: LhMessage & AssistantMessage = {
		id: "msg_p",
		role: "assistant",
		content: [{ type: "toolCall", id: "call_p", name: PRACTICE_PROBLEM_TOOL, arguments: { statement: "x" } }],
		timestamp: 1,
		...STAMPS,
	};
	const ack: LhMessage & ToolResultMessage = {
		id: "msg_pr",
		role: "toolResult",
		toolCallId: "call_p",
		toolName: PRACTICE_PROBLEM_TOOL,
		content: [{ type: "text", text: "posed" }],
		details: null,
		isError: false,
		timestamp: 2,
	};
	return [pose, ack];
}

const quizAnswer = (correct: boolean): QuestionAnswerData => ({
	kind: "quiz",
	tool: "mcq",
	questionText: "2 + 2?",
	dontKnow: false,
	answers: [{ index: 1, label: correct ? "4" : "5", value: correct ? "a" : "b" }],
	correct,
	answeredAt: "2026-10-26T00:00:00.000Z",
});

describe("practice settings", () => {
	it("default to open-ended; mix forces single; bad sizes fall back", () => {
		assert.deepEqual(parsePracticeSettings(undefined), DEFAULT_PRACTICE_SETTINGS);
		assert.equal(parsePracticeSettings({ format: "mix", pacing: "batch" }).pacing, "single");
		assert.equal(parsePracticeSettings({ format: "mcq", pacing: "batch", batchSize: 7 }).batchSize, 7);
		assert.equal(parsePracticeSettings({ format: "mcq", pacing: "batch", batchSize: 51 }).batchSize, 10);
		assert.equal(parsePracticeSettings({ format: "mcq", pacing: "batch", batchSize: 1 }).batchSize, 10);
		assert.equal(parsePracticeSettings({ format: "mcq", confidence: false }).confidence, false);
		assert.equal(parsePracticeSettings({ format: "mcq" }).confidence, true);
		assert.deepEqual(parsePracticeSettings({ format: "mcq", pacing: "batch", batchSize: 20, confidence: true }), {
			format: "mcq",
			pacing: "batch",
			batchSize: 20,
			confidence: true,
		});
	});
});

describe("the registry follows the format", () => {
	it("open-ended is today's pair", () => assert.deepEqual(posing(), ["conclude", "problem"]));
	it("MCQ single offers mcq", () => assert.deepEqual(posing({ format: "mcq", pacing: "single", batchSize: 10, confidence: true }), ["conclude", "mcq"]));
	it("MCQ batch offers mcq_batch", () =>
		assert.deepEqual(posing({ format: "mcq", pacing: "batch", batchSize: 5, confidence: true }), ["conclude", "mcq_batch"]));
	it("mix offers both forms", () =>
		assert.deepEqual(posing({ format: "mix", pacing: "single", batchSize: 10, confidence: true }), ["conclude", "mcq", "problem"]));
});

describe("mcq / mcq_batch validation", () => {
	it("a sound MCQ poses (terminate) and a broken key is returned", async () => {
		const tools = practiceTools(ctx([], { format: "mcq", pacing: "single", batchSize: 10, confidence: true }));
		const ok = await tools.mcq!.execute("t1", ITEM as never);
		assert.equal(ok.terminate, true);
		const bad = await tools.mcq!.execute("t2", { ...ITEM, correctAnswer: "z" } as never);
		assert.match(JSON.stringify(bad.content), /does not match any option/);
	});
	it("an MCQ cannot pose over an active open problem", async () => {
		const tools = practiceTools(ctx(activeProblem(), { format: "mix", pacing: "single", batchSize: 10, confidence: true }));
		const out = await tools.mcq!.execute("t1", ITEM as never);
		assert.match(JSON.stringify(out.content), /conclude/);
	});
	it("a batch must be exactly the chosen size", async () => {
		const tools = practiceTools(ctx([], { format: "mcq", pacing: "batch", batchSize: 5, confidence: true }));
		const short = await tools.mcq_batch!.execute("t1", { questions: [ITEM, ITEM] } as never);
		assert.match(JSON.stringify(short.content), /exactly 5/);
		const full = await tools.mcq_batch!.execute("t2", { questions: Array.from({ length: 5 }, () => ITEM) } as never);
		assert.equal(full.terminate, true);
	});
	it("heals string-encoded options per batch question", () => {
		const tools = practiceTools(ctx([], { format: "mcq", pacing: "batch", batchSize: 5, confidence: true }));
		const healed = tools.mcq_batch!.prepareArguments!({
			questions: [{ ...ITEM, options: JSON.stringify(ITEM.options) }],
		}) as { questions: Array<{ options: unknown }> };
		assert.ok(Array.isArray(healed.questions[0]!.options));
	});
});

describe("silent answers", () => {
	it("a practice-answer appends the graded result for a pending MCQ", () => {
		const input = parseDismissInput({ type: "practice-answer", toolCallId: "call_m", answer: quizAnswer(true) });
		const appends = dismissAppends({ messages: [mcqCall("mcq", "call_m")] }, input);
		assert.equal(appends.length, 1);
		assert.equal((appends[0] as ToolResultMessage).toolName, "mcq");
	});
	it("refuses a practice-answer aimed at a teaching quiz", () => {
		const quiz: LhMessage & AssistantMessage = {
			id: "msg_q",
			role: "assistant",
			content: [{ type: "toolCall", id: "call_q", name: "quiz", arguments: ITEM }],
			timestamp: 1,
			...STAMPS,
		};
		const input = parseDismissInput({ type: "practice-answer", toolCallId: "call_q", answer: quizAnswer(true) });
		assert.throws(() => dismissAppends({ messages: [quiz] }, input), /non-MCQ/);
	});
	it("an answered MCQ pauses: no continuation owed, deliveries hold", () => {
		const record = [mcqCall("mcq", "call_m"), newAnswerResult("call_m", "mcq", quizAnswer(false))];
		assert.equal(needsContinuation(record), false);
		assert.equal(endsInDismissal(record), true);
	});
});

describe("the batch result for the model", () => {
	it("compacts to one record per question plus the score", () => {
		const batch: QuestionAnswerData = {
			kind: "quiz",
			tool: "mcq_batch",
			questionText: "Batch of 2",
			dontKnow: false,
			answers: [],
			batch: [quizAnswer(true), quizAnswer(false)],
			answeredAt: "2026-10-26T00:00:00.000Z",
		};
		const compact = compactAnswerForModel(batch) as { score: string; batch: Array<{ question: number; correct: boolean }> };
		assert.equal(compact.score, "1/2");
		assert.deepEqual(compact.batch.map((b) => [b.question, b.correct]), [[1, true], [2, false]]);
	});
});

describe("the length tell (owner 2026-10-26)", () => {
	const opts = (right: string, ...wrong: string[]) => ({
		options: [{ label: right, value: "a" }, ...wrong.map((w, i) => ({ label: w, value: `w${i}` }))],
		correctAnswer: "a",
	});
	it("rejects a correct option clearly longer than every distractor", () => {
		const problems = optionLengthProblems(
			opts("The derivative of the outer function evaluated at the inner, times the inner's derivative", "Sum of derivatives", "Product of derivatives"),
		);
		assert.equal(problems.length, 1);
		assert.match(problems[0]!, /by length/);
	});
	it("leaves evenly built options and short numeric ones alone", () => {
		assert.deepEqual(optionLengthProblems(opts("$2x$", "$x$", "$x^2$")), []);
		assert.deepEqual(
			optionLengthProblems(opts("Outer derivative at the inner, times inner derivative", "Inner derivative at the outer, times outer derivative")),
			[],
		);
	});
	it("the mcq tool sends a length-tell question back", async () => {
		const tools = practiceTools(ctx([], { format: "mcq", pacing: "single", batchSize: 10, confidence: true }));
		const out = await tools.mcq!.execute("t", {
			...ITEM,
			options: [
				{ label: "Four, because two plus two is defined as the successor of three", value: "a" },
				{ label: "Five", value: "b" },
			],
		} as never);
		assert.match(JSON.stringify(out.content), /by length/);
	});
});
