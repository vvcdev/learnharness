import type { AgentTool } from "@earendil-works/pi-agent-core";
import { desmosInputObject, desmosInputProblems } from "../../core/desmos.ts";
import { invalidInputResult } from "../tool-execute.ts";

/**
 * The desmos tool (owner 2026-10-26): shows the learner an interactive
 * Desmos graph — every agent carries it. Mechanics only; when to graph
 * lives in prompts/shared/45-desmos.md. Not a job and not a question: the
 * card renders from the call's arguments and the turn continues.
 */
export const desmosTool: AgentTool<typeof desmosInputObject> = {
	name: "desmos",
	label: "desmos",
	description:
		"Show the learner an interactive Desmos graphing calculator in the conversation. Pass the expressions in " +
		"Desmos LaTeX (functions, equations, inequalities, points, parametric/polar curves, and sliders like a=2 that the " +
		"learner can drag) and optionally a viewport. The graph renders immediately from these arguments; your turn " +
		"continues. Inside JSON strings a LaTeX backslash is \\\\ (e.g. \"y=\\\\sin(x)\").",
	parameters: desmosInputObject,
	executionMode: "sequential",
	execute: async (_toolCallId, input) => {
		const problems = desmosInputProblems(input);
		if (problems.length > 0) return invalidInputResult("desmos", problems);
		return {
			content: [{ type: "text", text: "Graph shown to the learner as an interactive Desmos calculator." }],
			details: null,
		};
	},
};
