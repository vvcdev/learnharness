/**
 * THE PRACTICE TOOLS (practice sessions, owner design 2026-10-04): the
 * practice agent's ENTIRE toolset — `problem` (pose: terminates the turn;
 * the commitment rides the call's arguments, hidden from the learner UI)
 * and `conclude` (end the problem: normal result, the turn continues so
 * the same reply can reveal + pose the next). The gating law (owner
 * ruling): an agent cannot pose while a problem is active and cannot
 * conclude with nothing active — activeProblemOf is the single fold both
 * gates read.
 *
 * Mechanics-only descriptions (the doctrine ruling, 2026-10-04): the tool
 * descriptions carry WHAT to pass and WHAT happens — the theory, the
 * commit-before-pose law, the hint ladder all live in the system prompt
 * (prompts/practice/10-doctrine.md).
 */

import { Type, type Static } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { resolveTargetId } from "../../core/chains.ts";
import { readTool } from "./read.ts";
import { desmosTool } from "./desmos.ts";
import { lsTool } from "./ls.ts";
import { findTool } from "./find.ts";
import { grepTool } from "./grep.ts";
import { jobTools, type JobToolContext } from "./jobs.ts";
import { proberGraphTools, type GraphToolContext } from "./graph.ts";
import { activeProblemOf } from "../../core/native-messages.ts";
import type { LhMessage } from "../../core/native-messages.ts";
import { concludeResult, invalidInputResult, problemResult, questionResult } from "../tool-execute.ts";
import {
	mcqBatchInputObject,
	mcqItemObject,
	parseOptionsIfString,
	optionLengthProblems,
	quizInputProblems,
	type McqItemInput,
} from "../../core/question-core.ts";
import { DEFAULT_PRACTICE_SETTINGS, type PracticeSettings } from "../../core/contracts/chat.ts";
import { quizExampleBody } from "../tools.ts";
import { healEncodedArguments, healToolRecord } from "./heal.ts";


/** The record-reading context the gates need (the plan-tools idiom). */
export interface PracticeToolContext {
	chatId: string;
	chatStore: { getChat(id: string): { messages: LhMessage[]; kind?: string } | null };
	/** The WHOLE-graph node list, read fresh per pose (owner round 9 — the
	 *  mastery-trace contract): targets validate against every proposition,
	 *  not just the session's picks, so pickless sessions and future
	 *  graph-tools poses stay valid. Absent (tests) = no validation. */
	graphNodes?: () => ReadonlyArray<Pick<import("../../core/contracts/graph.ts").GraphNode, "id" | "name">>;
	/** THE RARELY-NEEDED SET (owner round 10, 2026-10-05): the map readers
	 *  behind the SAME settings gate as the prober's (graphToolsEnabled at
	 *  the composition root); the research + pdf jobs (both keyless).
	 *  Each absent context (tests) = absent from the registry. */
	graph?: GraphToolContext;
	jobs?: JobToolContext;
	/** The session's chosen format (owner 2026-10-26), read per turn —
	 *  it decides which posing tools exist. Absent = open-ended. */
	practice?: PracticeSettings;
}

/** TURN-SCOPED GATE STATE (the BKT incident, 2026-10-05): the gates used
 *  to read the STORED record — but the record freezes at the turn's
 *  write-ahead (persistTurn lands only at turn END), so a mid-turn
 *  conclude → pose pair could never see each other: every conclude
 *  succeeded against the stale record and every following pose died on
 *  "a problem is already active" until the model gave up ("the problem
 *  slot is stuck"). The gate seeds ONCE from the record at construction
 *  (one practiceTools per turn — chat-handler builds the agent per
 *  request, so there is no cross-turn leakage), and the executes flip
 *  this closure — the intra-turn truth the record cannot hold yet. */
export interface PracticeGate {
	problemActive: boolean;
}

/** Seed the turn's gate from the record (result-aware activeProblemOf —
 *  only a cleanly-posed problem counts). */
export function createPracticeGate(ctx: PracticeToolContext): PracticeGate {
	const record = ctx.chatStore.getChat(ctx.chatId);
	return { problemActive: record ? activeProblemOf(record.messages) !== null : false };
}

// ─── problem: the pose ───────────────────────────────────────────────────────

export const problemInputObject = Type.Object({
	statement: Type.String({
		description:
			"REQUIRED — the problem as the learner sees it (markdown + LaTeX). Must be self-contained and " +
			"solvable from the session's material. NEVER announces the target proposition.",
	}),
	mode: Type.Union([Type.Literal("recall"), Type.Literal("discrimination"), Type.Literal("composition")], {
		description: "REQUIRED — the demand mode: recall, discrimination, or composition (bare words, no quotes).",
	}),
	target: Type.Optional(
		Type.Array(Type.String(), {
			minItems: 1,
			description:
				"The proposition id(s) this problem exercises, from the session context's [id] list — include when " +
				"the material is in the map; OMIT entirely when it is not (a topic session poses untagged problems). " +
				"Names are normalized to ids at the seam; an unknown proposition is rejected.",
		}),
	),
	modelSolution: Type.String({
		description: "REQUIRED — the full solution, moves in order, committed BEFORE the learner sees the problem. This IS the reveal — conclude shows it verbatim; never re-author it.",
	}),
});

export type ProblemInput = Static<typeof problemInputObject>;

export function problemTool(
	gate: PracticeGate,
	graphNodes?: PracticeToolContext["graphNodes"],
): AgentTool<typeof problemInputObject> {
	return {
		name: "problem",
		label: "problem",
		description:
			"Pose one practice problem. Ends the turn — the learner works in the thinking field; their thinking " +
			"traces and answer commits arrive back as labeled messages. The modelSolution rides this call's " +
			"arguments and stays hidden from the learner until you conclude (conclude shows it verbatim — the " +
			"reveal needs no new field). Only one problem may be active — conclude it before posing the next.",
		parameters: problemInputObject,
		executionMode: "sequential",
		prepareArguments: (args: unknown) => {
			const healed = healEncodedArguments(args, problemInputObject);
			// TARGET NORMALIZATION (owner round 9): names silently become ids —
			// the RECORD carries canonical ids (the mastery trace groups on
			// them); unresolvable strings pass through for execute to reject.
			// UNTAGGED PROBLEMS (owner round 12): an explicit empty list is
			// the model saying "no targets" — healed AWAY, so the record's
			// canonical form is tagged-or-absent, never [].
			if (!graphNodes) {
				const bare = (healed as { target?: unknown }).target;
				return Array.isArray(bare) && bare.length === 0
					? ({ ...(healed as Record<string, unknown>), target: undefined } as never)
					: (healed as never);
			}
			const target = (healed as { target?: unknown }).target;
			if (!Array.isArray(target) || target.length === 0) {
				return { ...(healed as Record<string, unknown>), target: undefined } as never;
			}
			const list = graphNodes();
			const normalized = target.map((t) =>
				typeof t === "string" ? (resolveTargetId(t, list) ?? t) : t,
			);
			if (normalized.every((t, i) => t === target[i])) return healed as never;
			return { ...(healed as Record<string, unknown>), target: normalized } as never;
		},
		execute: async (_toolCallId, input) => {
			if (gate.problemActive) {
				return invalidInputResult("problem", [
					"a problem is already active — call conclude on it before posing the next one",
				]);
			}
			// TARGET VALIDATION (owner round 9, round 12): against the WHOLE
			// graph, and ONLY when targets are present — absent means an
			// untagged problem (topic sessions, owner round 12), which poses
			// freely. A one-line rejection — the proposition list already
			// sits in the agent's context (the [id] marker); no re-listing.
			// The message teaches the exit: omitting always works.
			if (graphNodes && input.target && input.target.length > 0) {
				const list = graphNodes();
				const unknown = input.target.filter((t) => resolveTargetId(t, list) === null);
				if (unknown.length > 0) {
					return invalidInputResult("problem", [
						`target ${JSON.stringify(unknown)} is not a known proposition — targets must be proposition ids from the session context; if the material is not in the map, omit target entirely`,
					]);
				}
			}
			gate.problemActive = true;
			return problemResult();
		},
	};
}

// ─── conclude: the end of a problem ──────────────────────────────────────────

export const concludeInputObject = Type.Object({
	outcome: Type.Union(
		[
			Type.Literal("solved"),
			Type.Literal("solvedWithHints"),
			Type.Literal("movedOn"),
			Type.Literal("surrendered"),
			Type.Literal("dismissed"),
		],
		{ description: "REQUIRED — the outcome: solved, solvedWithHints, movedOn, or surrendered — bare words, no quotes (dismissed is synthesized, never yours)." },
	),
	verdict: Type.String({
		description: "REQUIRED — the plain-language verdict: what was credited, where it broke. On a wrong answer: localize the break, do NOT give the correction.",
	}),
	rung: Type.Union(
		[Type.Literal("R0"), Type.Literal("R1"), Type.Literal("R2"), Type.Literal("R3"), Type.Literal("R4"), Type.Literal("R5"), Type.Null()],
		{ description: "REQUIRED — the hint-ladder rung the problem needed: R0 through R5, or null = no hint was given (bare, no quotes)." },
	),
	missClass: Type.Union(
		[
			Type.Literal("cue"),
			Type.Literal("discrimination"),
			Type.Literal("execution"),
			Type.Literal("careless"),
			Type.Literal("structural"),
			Type.Null(),
		],
		{ description: "REQUIRED — the miss classification: cue, discrimination, execution, careless, or structural — or null = no miss (bare, no quotes)." },
	),
	retest: Type.Boolean({ description: "REQUIRED — true marks the problem for a fresh-surface retest before the session ends." }),
});

export type ConcludeInput = Static<typeof concludeInputObject>;

export function concludeTool(gate: PracticeGate): AgentTool<typeof concludeInputObject> {
	return {
		name: "conclude",
		label: "conclude",
		description:
			"Conclude the active problem: records the outcome + verdict, reveals the committed solution, and frees " +
			"the learner's composer. After the result, say your closing words about the learner's work if useful, then " +
			"END YOUR TURN — no further tool calls. The next problem is NEVER posed here: it waits for the learner's " +
			"explicit go-ahead (a *Next problem* message, or their own words asking for the next one). Between problems, " +
			"answer their questions about the concluded one. Nothing may conclude unless a problem is active.",
		parameters: concludeInputObject,
		prepareArguments: (args: unknown) => healEncodedArguments(args, concludeInputObject) as never,
		executionMode: "sequential",
		execute: async (_toolCallId, _input) => {
			if (!gate.problemActive) {
				return invalidInputResult("conclude", ["no active problem to conclude — pose one first"]);
			}
			gate.problemActive = false;
			return concludeResult();
		},
	};
}

// ─── mcq / mcq_batch: multiple-choice practice (owner 2026-10-26) ────────────

/** Normalize one MCQ item's targets (names → ids, empty → absent) and its
 *  string-encoded options — the problem tool's seam, per item. */
function prepareMcqItem(item: unknown, graphNodes?: PracticeToolContext["graphNodes"]): unknown {
	if (!item || typeof item !== "object" || Array.isArray(item)) return item;
	const o = { ...(item as Record<string, unknown>) };
	if (typeof o.options === "string") o.options = parseOptionsIfString(o.options);
	const target = o.target;
	if (!Array.isArray(target) || target.length === 0) {
		delete o.target;
		return o;
	}
	if (graphNodes) {
		const list = graphNodes();
		o.target = target.map((t) => (typeof t === "string" ? (resolveTargetId(t, list) ?? t) : t));
	}
	return o;
}

/** Every authoring problem of one item: the quiz contract + targets. */
function mcqItemProblems(item: McqItemInput, graphNodes?: PracticeToolContext["graphNodes"], label = ""): string[] {
	const problems = [...quizInputProblems(item), ...optionLengthProblems(item)].map((p) => `${label}${p}`);
	if (graphNodes && item.target && item.target.length > 0) {
		const list = graphNodes();
		const unknown = item.target.filter((t) => resolveTargetId(t, list) === null);
		if (unknown.length > 0) {
			problems.push(
				`${label}target ${JSON.stringify(unknown)} is not a known proposition — targets must be proposition ids from the session context; if the material is not in the map, omit target entirely`,
			);
		}
	}
	return problems;
}

const MCQ_MECHANICS =
	"The learner sees the options plus an automatic 'I don't know' choice and an optional thinking field (text, voice, " +
	"images). Grading is instant and client-side against your correctAnswer; the explanation is the reveal. The answer " +
	"is saved WITHOUT a turn: you read it together with the learner's next input (a *Next problem* message, or their " +
	"own words). Never add your own 'I don't know' option.";

export function mcqTool(gate: PracticeGate, graphNodes?: PracticeToolContext["graphNodes"]): AgentTool<typeof mcqItemObject> {
	return {
		name: "mcq",
		label: "mcq",
		description:
			"Pose ONE practice multiple-choice question. Ends the turn. " +
			MCQ_MECHANICS +
			" Rejected while an open-ended problem is active — conclude it first.\nExample arguments — copy the escaping exactly: " +
			"inside JSON strings a LaTeX backslash is \\\\ and a newline is \\n.\n```json\n" +
			JSON.stringify({ mode: "recall", ...quizExampleBody }, null, 2) +
			"\n```",
		parameters: mcqItemObject,
		executionMode: "sequential",
		prepareArguments: (args: unknown) => healEncodedArguments(prepareMcqItem(args, graphNodes), mcqItemObject) as never,
		execute: async (_toolCallId, input) => {
			if (gate.problemActive) {
				return invalidInputResult("mcq", ["an open-ended problem is active — call conclude on it before posing an MCQ"]);
			}
			const problems = mcqItemProblems(input, graphNodes);
			if (problems.length > 0) return invalidInputResult("mcq", problems);
			return questionResult();
		},
	};
}

export function mcqBatchTool(
	gate: PracticeGate,
	size: number,
	graphNodes?: PracticeToolContext["graphNodes"],
): AgentTool<typeof mcqBatchInputObject> {
	return {
		name: "mcq_batch",
		label: "mcq_batch",
		description:
			`Pose a BATCH of exactly ${size} practice multiple-choice questions in one call (the learner's chosen batch ` +
			"size). Ends the turn. The learner answers every question — moving back and forth freely — before ANY reveal; " +
			"then each is revealed one by one with its explanation, and the batch's result arrives as one answer listing " +
			"every question's grade in order. " +
			MCQ_MECHANICS +
			" Each question object has exactly the mcq tool's fields. Rejected while an open-ended problem is active.",
		parameters: mcqBatchInputObject,
		executionMode: "sequential",
		prepareArguments: (args: unknown) => {
			const healed = healEncodedArguments(args, mcqBatchInputObject) as { questions?: unknown };
			if (!healed || typeof healed !== "object" || !Array.isArray(healed.questions)) return healed as never;
			return { ...healed, questions: healed.questions.map((q) => prepareMcqItem(q, graphNodes)) } as never;
		},
		execute: async (_toolCallId, input) => {
			if (gate.problemActive) {
				return invalidInputResult("mcq_batch", ["an open-ended problem is active — call conclude on it before posing a batch"]);
			}
			const problems: string[] = [];
			if (input.questions.length !== size) {
				problems.push(`the batch has ${input.questions.length} questions — it must have exactly ${size} (the learner's chosen size)`);
			}
			input.questions.forEach((q, i) => problems.push(...mcqItemProblems(q, graphNodes, `question ${i + 1}: `)));
			if (problems.length > 0) return invalidInputResult("mcq_batch", problems);
			return questionResult();
		},
	};
}

/** The posing tools the session's format offers (owner 2026-10-26):
 *  open → problem; MCQ → mcq or mcq_batch by pacing; mix → problem + mcq
 *  (the agent picks per item). conclude always rides along — it frees an
 *  open problem left active across a format switch, and its gate rejects
 *  it when nothing is active. */
function posingTools(ctx: PracticeToolContext, gate: PracticeGate): Record<string, AgentTool<any>> {
	const practice = ctx.practice ?? DEFAULT_PRACTICE_SETTINGS;
	const conclude = concludeTool(gate);
	if (practice.format === "mcq") {
		return practice.pacing === "batch"
			? { mcq_batch: mcqBatchTool(gate, practice.batchSize, ctx.graphNodes), conclude }
			: { mcq: mcqTool(gate, ctx.graphNodes), conclude };
	}
	if (practice.format === "mix") {
		return { problem: problemTool(gate, ctx.graphNodes), mcq: mcqTool(gate, ctx.graphNodes), conclude };
	}
	return { problem: problemTool(gate, ctx.graphNodes), conclude };
}

/** The practice toolset (the practice agent's whole registry). */
export function practiceTools(ctx: PracticeToolContext): Record<string, AgentTool<any>> {
	// ONE gate per turn, shared by both tools — the intra-turn truth.
	const gate = createPracticeGate(ctx);
	// THE RARELY-NEEDED SET (owner round 10): read/ls/find/grep over the
	// learner's files (always — the same read-only set the teacher and
	// prober carry), the research + pdf jobs (available without search
	// keys; demo/visual stay teach-only), and
	// the prober's map readers when the settings gate opened. None are
	// toggle-filtered: problem/conclude are the session; these are
	// exceptions the doctrine says to reach for rarely.
	const jobs = ctx.jobs ? jobTools(ctx.jobs) : null;
	// healToolRecord (owner, 2026-10-09 — the whitehead generalization):
	// the standard argument heal over the WHOLE registry. problem/conclude
	// keep their own (target-normalizing) prepareArguments as the composed
	// inner pass; the double heal is idempotent by construction.
	return healToolRecord({
		...posingTools(ctx, gate),
		desmos: desmosTool,
		read: readTool,
		ls: lsTool,
		find: findTool,
		grep: grepTool,
		...(jobs?.research ? { research: jobs.research } : {}),
		...(jobs ? { pdf: jobs.pdf! } : {}),
		...(ctx.graph ? proberGraphTools(ctx.graph) : {}),
	});
}
