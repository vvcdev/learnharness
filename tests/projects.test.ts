import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { appendProjectContext, projectNameError } from "../src/core/projects.ts";
import {
	applyProjectToSession,
	createProject,
	deleteProject,
	getActiveProject,
	listProjects,
	setActiveProject,
	updateProjectMeta,
} from "../src/server/projects.ts";

describe("project packs", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-projects-"));
	after(() => fs.rmSync(root, { recursive: true, force: true }));

	it("requires a name", () => {
		assert.match(projectNameError("  ") ?? "", /Name/);
	});

	it("folds instructions and file paths into the opening prompt", () => {
		const text = appendProjectContext("learn integrals", "Use my notation.", ["/tmp/a.md"]);
		assert.match(text, /^learn integrals/);
		assert.match(text, /Project instructions:\nUse my notation\./);
		assert.match(text, /\/tmp\/a\.md/);
	});

	it("creates a pack, activates it, and copies files into a session", () => {
		const created = createProject(
			{
				name: "Calc",
				instructions: "Stay in AP Calc BC scope.",
				files: [{ name: "notes.md", bytes: new TextEncoder().encode("# chain rule") }],
			},
			root,
		);
		assert.equal(created.ok, true);
		if (!created.ok) return;
		assert.equal(listProjects(root).activeId, created.project.id);
		assert.equal(getActiveProject(root)?.name, "Calc");

		const applied = applyProjectToSession("chat_test1", created.project.id, root);
		assert.equal(applied.ok, true);
		if (!applied.ok) return;
		assert.equal(applied.instructions, "Stay in AP Calc BC scope.");
		assert.equal(fs.readFileSync(applied.paths[0]!, "utf8"), "# chain rule");

		assert.equal(updateProjectMeta(created.project.id, { name: "Calc BC" }, root).ok, true);
		assert.equal(setActiveProject(null, root).ok, true);
		assert.equal(listProjects(root).activeId, null);
		assert.equal(deleteProject(created.project.id, root).ok, true);
		assert.equal(getActiveProject(root), null);
	});
});
