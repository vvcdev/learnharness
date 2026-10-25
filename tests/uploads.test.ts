import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { claimUploads, stageUploads } from "../src/server/uploads.ts";
import { saveLessonSources } from "../src/server/session-sources.ts";

describe("upload staging", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-uploads-"));
	after(() => fs.rmSync(root, { recursive: true, force: true }));

	it("copies into the app uploads folder before the session claims it", () => {
		const staged = stageUploads(
			[{ name: "from-downloads.md", bytes: new TextEncoder().encode("keep me") }],
			root,
		);
		assert.equal(staged.ok, true);
		if (!staged.ok) return;
		const stagedPath = path.join(root, "uploads", staged.batch.id, staged.batch.files[0]!.stored);
		assert.equal(fs.readFileSync(stagedPath, "utf8"), "keep me");

		const claimed = claimUploads(
			[{ batchId: staged.batch.id, stored: staged.batch.files[0]!.stored }],
			root,
		);
		assert.equal(claimed.ok, true);
		if (!claimed.ok) return;
		assert.equal(fs.existsSync(path.join(root, "uploads", staged.batch.id)), false);

		const saved = saveLessonSources("chat_keep", claimed.files, root);
		assert.equal(saved.ok, true);
		if (!saved.ok) return;
		assert.equal(fs.readFileSync(saved.paths[0]!, "utf8"), "keep me");
	});
});
