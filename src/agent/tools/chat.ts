/**
 * THE CHAT TOOLS (owner 2026-10-26): the plain Q&A agent's registry —
 * the learner's files (read/ls/find/grep + the pdf job), web research,
 * demos and visuals, Desmos graphs, and the map readers when the
 * settings gate opened. No question, plan, or practice tools: a chat
 * session answers, it doesn't assess.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { readTool } from "./read.ts";
import { lsTool } from "./ls.ts";
import { findTool } from "./find.ts";
import { grepTool } from "./grep.ts";
import { desmosTool } from "./desmos.ts";
import { jobTools, type JobToolContext } from "./jobs.ts";
import { proberGraphTools, type GraphToolContext } from "./graph.ts";
import { healToolRecord } from "./heal.ts";

export interface ChatToolContext {
	jobs: JobToolContext;
	/** The map readers — present only when the graph-tools gate opened. */
	graph?: GraphToolContext;
}

export function chatTools(ctx: ChatToolContext): Record<string, AgentTool<any>> {
	return healToolRecord({
		read: readTool,
		ls: lsTool,
		find: findTool,
		grep: grepTool,
		desmos: desmosTool,
		...jobTools(ctx.jobs),
		...(ctx.graph ? proberGraphTools(ctx.graph) : {}),
	});
}
