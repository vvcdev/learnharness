/**
 * Inline visuals (2026-10-27): the ```visual fence renders in a sandboxed,
 * themed frame; plain html/svg fences stay code; every agent carries the
 * house-style fragment.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildInlineVisualSrcDoc, DEFAULT_VISUAL_THEME, inlineVisualKind } from "../components/inline-visual.ts";
import { composeInstructions } from "../src/agent/teacher-agent.ts";

describe("inlineVisualKind", () => {
	it("renders only the visual fence, svg or html by its body", () => {
		assert.equal(inlineVisualKind("visual", "<svg viewBox='0 0 1 1'></svg>"), "svg");
		assert.equal(inlineVisualKind("visual", "  <svg>\n</svg>"), "svg");
		assert.equal(inlineVisualKind("visual", "<div>hi</div>"), "html");
		assert.equal(inlineVisualKind("VISUAL", "<p>x</p>"), "html");
	});
	it("leaves code fences and non-markup bodies alone", () => {
		assert.equal(inlineVisualKind("html", "<div>hi</div>"), null);
		assert.equal(inlineVisualKind("svg", "<svg></svg>"), null);
		assert.equal(inlineVisualKind("visual", "just words"), null);
		assert.equal(inlineVisualKind("", "<div/>"), null);
	});
});

describe("buildInlineVisualSrcDoc", () => {
	it("wraps a fragment with CSP, theme variables, and the size bridge", () => {
		const doc = buildInlineVisualSrcDoc("<p id=a>hi</p>", "html");
		assert.match(doc, /^<!doctype html>/);
		assert.match(doc, /Content-Security-Policy[^>]*default-src 'none'/);
		assert.match(doc, /connect-src 'none'/);
		assert.match(doc, new RegExp(`--accent:${DEFAULT_VISUAL_THEME.accent}`));
		assert.match(doc, /<p id=a>hi<\/p>/);
		assert.match(doc, /demo-resize/, "bridge injected");
		assert.ok(doc.indexOf("Content-Security-Policy") < doc.indexOf("<p id=a>"), "CSP precedes the content");
	});
	it("injects into a complete document's head instead of double-wrapping", () => {
		const doc = buildInlineVisualSrcDoc("<!doctype html><html><head><title>t</title></head><body>x</body></html>", "html");
		assert.equal(doc.match(/<html/g)?.length, 1);
		assert.ok(doc.indexOf("Content-Security-Policy") < doc.indexOf("<title>"));
	});
	it("scales a bare svg to the column and uses a custom theme", () => {
		const doc = buildInlineVisualSrcDoc("<svg viewBox='0 0 10 10'></svg>", "svg", { ...DEFAULT_VISUAL_THEME, accent: "#123456" });
		assert.match(doc, /svg\{display:block;max-width:100%/);
		assert.match(doc, /--accent:#123456/);
	});
});

describe("the house-style fragment", () => {
	it("composes into every agent", () => {
		for (const kind of ["teacher", "prober", "practice", "chat"] as const) {
			const text = composeInstructions(kind);
			assert.match(text, /Visuals — draw it right in the reply/, kind);
			assert.match(text, /```visual/, kind);
		}
	});
});
