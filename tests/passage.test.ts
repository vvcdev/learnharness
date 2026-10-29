import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanSelection, explainPassageMessage, MAX_PASSAGE_CHARS } from "../src/core/passage.ts";

describe("highlighted passages", () => {
	it("cleans whitespace and drops empty selections", () => {
		assert.equal(cleanSelection("  a   b \n\n  c  "), "a b\nc");
		assert.equal(cleanSelection(" \n\t "), null);
	});
	it("caps a very long selection", () => {
		const out = cleanSelection("x".repeat(MAX_PASSAGE_CHARS + 500))!;
		assert.ok(out.length <= MAX_PASSAGE_CHARS + 1 && out.endsWith("…"));
	});
	it("quotes the passage with its file and page", () => {
		assert.equal(
			explainPassageMessage({ name: "notes.pdf", page: 3, text: "force = mass x acceleration\nsecond line" }),
			'Explain this passage from "notes.pdf" (p. 3):\n\n> force = mass x acceleration\n> second line',
		);
		assert.equal(explainPassageMessage({ name: "a.docx", text: "hi" }), 'Explain this passage from "a.docx":\n\n> hi');
	});
});
