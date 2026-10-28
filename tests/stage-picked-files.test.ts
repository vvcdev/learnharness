/**
 * Uploading picked files (the Projects page bug, 2026-10-28): the picker
 * hands over its files as a plain array (copied BEFORE the input is reset —
 * clearing a file input empties its live FileList in Chrome), so
 * stagePickedFiles must accept an array and actually send the files.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { stagePickedFiles } from "../components/source-attach.tsx";

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

describe("stagePickedFiles", () => {
	it("uploads files given as an array and returns the staged chips", async () => {
		let sent: string[] = [];
		globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
			sent = (init!.body as FormData).getAll("file").map((f) => (f as File).name);
			return Response.json({ id: "upl_1", files: sent.map((name) => ({ name, stored: name })) });
		}) as typeof fetch;
		const picked = await stagePickedFiles([], [new File(["a"], "notes.txt"), new File(["b"], "slides.md")], 0);
		assert.equal(picked.error, null);
		assert.deepEqual(sent, ["notes.txt", "slides.md"]);
		assert.deepEqual(picked.files.map((f) => [f.name, f.batchId, f.stored]), [["notes.txt", "upl_1", "notes.txt"], ["slides.md", "upl_1", "slides.md"]]);
	});
	it("sends nothing for an empty pick", async () => {
		globalThis.fetch = (async () => {
			throw new Error("must not upload");
		}) as typeof fetch;
		assert.deepEqual(await stagePickedFiles([], [], 0), { files: [], error: null });
	});
});
