/**
 * The chat and practice prompts carry the teaching method / material-kind
 * doctrine (2026-10-26) — and the teach/probe prompts do NOT gain it
 * (that composition is deliberately untouched).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { composeInstructions } from "../src/agent/teacher-agent.ts";
import { allSegmentPaths } from "../src/agent/prompt-segments.ts";

describe("material-kind doctrine composition", () => {
	it("registers the new fragments as overridable segments", () => {
		const paths = allSegmentPaths();
		for (const p of ["chat/10-method.md", "chat/20-material-kinds.md", "practice/30-repair-and-material.md"]) {
			assert.ok(paths.includes(p), p);
		}
	});

	it("chat explains with the method and adapts to arbitrary associations", () => {
		const chat = composeInstructions("chat");
		assert.match(chat, /Start from what he holds as obviously true/);
		assert.match(chat, /Arbitrary associations/);
		assert.match(chat, /running a \*\*chat\*\* session/, "chat's base is intact");
	});

	it("practice repairs by naming the wrong model and poses associations as problems", () => {
		const practice = composeInstructions("practice");
		assert.match(practice, /Name the wrong model/);
		assert.match(practice, /Associations: vocabulary, names, facts, people/);
		assert.match(practice, /no problem is ever conversation/, "practice's base is intact");
	});

	it("teacher and prober never gain the new fragments", () => {
		for (const kind of ["teacher", "prober"] as const) {
			const text = composeInstructions(kind);
			assert.doesNotMatch(text, /Arbitrary associations/, kind);
			assert.doesNotMatch(text, /Repair craft, and material that has no derivation/, kind);
		}
	});
});
