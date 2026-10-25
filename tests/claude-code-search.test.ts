import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseClaudeSearchOutput } from "../src/server/claude-code-search.ts";

describe("Claude Code search output", () => {
	it("reads structured_output results", () => {
		const hits = parseClaudeSearchOutput(JSON.stringify({
			is_error: false,
			structured_output: {
				results: [{ title: "Parakeet", url: "https://example.com/p", snippet: "A local model." }],
			},
		}));
		assert.deepEqual(hits, [{ title: "Parakeet", url: "https://example.com/p", snippet: "A local model." }]);
	});

	it("reads a JSON result string and drops rows without a url", () => {
		const hits = parseClaudeSearchOutput(JSON.stringify({
			result: JSON.stringify({
				results: [
					{ title: "Ok", url: "https://example.com/a", snippet: "one" },
					{ title: "Skip", snippet: "no url" },
				],
			}),
		}));
		assert.equal(hits.length, 1);
		assert.equal(hits[0]?.url, "https://example.com/a");
	});

	it("surfaces a Claude error instead of inventing hits", () => {
		assert.throws(
			() => parseClaudeSearchOutput(JSON.stringify({ is_error: true, result: "not signed in" })),
			/not signed in/,
		);
	});
});
