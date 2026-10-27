/**
 * The Chat session type and Desmos graphs (owner 2026-10-26): the chat
 * agent's registry and prompt, and the desmos tool's validation + the
 * card's display parse.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chatTools } from "../src/agent/tools/chat.ts";
import { desmosTool } from "../src/agent/tools/desmos.ts";
import { composeInstructions } from "../src/agent/teacher-agent.ts";
import { listSourceSegments } from "../src/agent/prompt-segments.ts";
import { desmosInputProblems, parseDesmosInput } from "../src/core/desmos.ts";
import { practiceTools } from "../src/agent/tools/practice.ts";

const jobs = { chatId: "c1", jobStore: null as never, spawn: (() => {}) as never, searchAvailable: () => true };

describe("the chat agent", () => {
	it("answers with files, jobs, and graphs — no question, plan, or practice tools", () => {
		const names = Object.keys(chatTools({ jobs })).sort();
		assert.deepEqual(names, ["demo", "desmos", "find", "grep", "ls", "pdf", "read", "research", "visual"]);
	});
	it("adds the map readers only when the graph gate opened", () => {
		const names = Object.keys(chatTools({ jobs, graph: { chatStore: null as never, graphStore: null as never } }));
		assert.ok(names.includes("list_propositions"));
	});
	it("composes its own base plus the curated shared appendix", () => {
		const paths = listSourceSegments("chat").map((s) => s.path);
		assert.deepEqual(paths, [
			"chat/00-base.md",
			"chat/10-method.md",
			"chat/20-material-kinds.md",
			"shared/10-voice.md",
			"shared/15-accuracy.md",
			"shared/30-learner-files.md",
			"shared/40-formatting.md",
			"shared/45-desmos.md",
			"shared/46-inline-visuals.md",
		]);
		assert.match(composeInstructions("chat"), /running a \*\*chat\*\* session/);
	});
});

describe("desmos", () => {
	it("every agent carries it", () => {
		const practice = practiceTools({ chatId: "c", chatStore: { getChat: () => ({ messages: [] }) } });
		assert.ok(practice.desmos);
		assert.match(composeInstructions("teacher"), /the `desmos` tool/);
		assert.match(composeInstructions("practice"), /the `desmos` tool/);
	});
	it("validates expressions, colors, and bounds", () => {
		assert.deepEqual(desmosInputProblems({ expressions: [{ latex: "y=x^2" }] }), []);
		assert.equal(desmosInputProblems({ expressions: [{ latex: " " }] }).length, 1);
		assert.equal(desmosInputProblems({ expressions: [{ latex: "y=x", color: "red" }] }).length, 1);
		assert.equal(desmosInputProblems({ expressions: [{ latex: "y=x" }], bounds: { left: 5, right: 1, bottom: 0, top: 1 } }).length, 1);
	});
	it("a valid call continues the turn", async () => {
		const out = await desmosTool.execute("t", { expressions: [{ latex: "y=\\sin(x)" }] } as never);
		assert.notEqual(out.terminate, true);
		assert.match(JSON.stringify(out.content), /Desmos/);
	});
	it("the card's parse keeps what renders and drops what doesn't", () => {
		const g = parseDesmosInput({ title: "t", expressions: [{ latex: "y=x", color: "nope" }, { bad: 1 }], bounds: { left: 0 } })!;
		assert.deepEqual(g, { title: "t", expressions: [{ latex: "y=x" }] });
		assert.equal(parseDesmosInput({ expressions: [] }), null);
	});
});
