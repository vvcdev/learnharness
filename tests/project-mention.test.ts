/**
 * @-mentioned project files (owner 2026-10-26): the caret's "@query",
 * and copying ONLY the picked project files into a session, each with its
 * page/section limit.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { mentionQuery } from "../components/project-mention.tsx";
import { applyProjectFilesToSession, createProject } from "../src/server/projects.ts";
import { readPdfPageLimit } from "../src/agent/tools/source-limits.ts";

const PDF = path.join(import.meta.dirname, "fixtures", "sample-3page.pdf");

describe("mentionQuery", () => {
	it("finds the @token right before the caret", () => {
		assert.deepEqual(mentionQuery("quiz me on @fru", 15), { query: "fru", start: 11 });
		assert.deepEqual(mentionQuery("@", 1), { query: "", start: 0 });
		assert.equal(mentionQuery("mail me@home", 12), null, "an @ inside a word is not a mention");
		assert.equal(mentionQuery("@done then text", 15), null);
	});
});

describe("applyProjectFilesToSession", () => {
	it("copies only the picked files, cut or page-limited, with the instructions", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-proj-"));
		try {
			const created = createProject(
				{
					name: "Physics",
					instructions: "Exam style.",
					files: [
						{ name: "book.pdf", bytes: new Uint8Array(fs.readFileSync(PDF)) },
						{ name: "notes.md", bytes: new TextEncoder().encode("# A\none\n# B\ntwo\n") },
						{ name: "other.txt", bytes: new TextEncoder().encode("unused") },
					],
				},
				root,
			);
			assert.ok(created.ok);
			const files = created.project.files;
			const pdf = files.find((f) => f.name === "book.pdf")!;
			const md = files.find((f) => f.name === "notes.md")!;
			const out = await applyProjectFilesToSession(
				"chat_test",
				created.project.id,
				[
					{ stored: pdf.stored, scope: { kind: "pages", spec: "2" } },
					{ stored: md.stored, scope: { kind: "sections", sections: [1], titles: ["B"] } },
				],
				root,
			);
			assert.ok(out.ok);
			assert.equal(out.instructions, "Exam style.");
			assert.equal(out.paths.length, 2);
			const sessionFiles = fs.readdirSync(path.dirname(out.paths[0]!)).filter((n) => !n.startsWith("."));
			assert.deepEqual(sessionFiles.sort(), ["book.pdf", "notes (sections).md"], "other.txt stays out");
			assert.deepEqual([...readPdfPageLimit(out.paths[0]!)!], [2]);
			const cut = fs.readFileSync(out.paths[1]!, "utf-8");
			assert.match(cut, /two/);
			assert.doesNotMatch(cut, /one/);
			assert.match(out.notes[0]!, /LIMITED TO page 2/);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
