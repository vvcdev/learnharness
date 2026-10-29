/**
 * What the document viewer's routes read (owner 2026-10-29): a chat's saved
 * sources listed by kind, traversal refused, text and page limits honoured.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { documentText, listSessionDocuments, sessionDocumentPath } from "../src/server/document-view.ts";
import { saveLessonSources } from "../src/server/session-sources.ts";
import { writePdfPageLimit } from "../src/agent/tools/source-limits.ts";

const FIXTURE_PDF = fs.readFileSync(path.join(import.meta.dirname, "fixtures", "sample-3page.pdf"));

async function withRoot(fn: (root: string) => void | Promise<void>): Promise<void> {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-docview-"));
	try { await fn(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

describe("document viewer sources", () => {
	it("lists saved sources by kind, skipping images and bookkeeping", () => withRoot((root) => {
		const saved = saveLessonSources("chat1", [
			{ name: "paper.pdf", bytes: FIXTURE_PDF },
			{ name: "notes.md", bytes: new TextEncoder().encode("# Notes\nforce") },
			{ name: "figure.png", bytes: new Uint8Array([1, 2, 3]) },
		], root);
		assert.ok(saved.ok);
		writePdfPageLimit(saved.paths[0]!, [2, 3]);
		const docs = listSessionDocuments("chat1", root);
		assert.deepEqual(docs.map((d) => [d.name, d.kind]), [["notes.md", "text"], ["paper.pdf", "pdf"]]);
		assert.deepEqual(docs.find((d) => d.name === "paper.pdf")!.pages, [2, 3]);
	}));

	it("an unknown chat has no documents", () => withRoot((root) => {
		assert.deepEqual(listSessionDocuments("nochat", root), []);
	}));

	it("only listed files resolve — no traversal, no bookkeeping", () => withRoot((root) => {
		saveLessonSources("chat1", [{ name: "notes.md", bytes: new TextEncoder().encode("x") }], root);
		assert.ok(sessionDocumentPath("chat1", "notes.md", root));
		assert.equal(sessionDocumentPath("chat1", "../notes.md", root), null);
		assert.equal(sessionDocumentPath("chat1", "/etc/passwd", root), null);
		assert.equal(sessionDocumentPath("chat1", ".scopes", root), null);
		assert.equal(sessionDocumentPath("chat1", "missing.md", root), null);
	}));

	it("reads text files as they are", () => withRoot(async (root) => {
		const saved = saveLessonSources("chat1", [{ name: "notes.md", bytes: new TextEncoder().encode("# Notes\nforce") }], root);
		assert.ok(saved.ok);
		assert.equal(await documentText(saved.paths[0]!), "# Notes\nforce");
	}));
});
