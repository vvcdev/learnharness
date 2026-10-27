/**
 * Session folders (owner, 2026-10-27): the pure rules (nesting, cycle and
 * depth guards, deleting re-parents, sanitizing), the sidebar row layout,
 * and the store + routes under an isolated LH_DATA_DIR.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, describe, it } from "node:test";
import {
	createFolder,
	deleteFolder,
	EMPTY_FOLDERS,
	layoutSessionRows,
	MAX_FOLDER_DEPTH,
	moveFolder,
	placeSessions,
	pruneSessions,
	renameFolder,
	sanitizeFolders,
	sessionsUnderFolder,
	type FoldersState,
} from "../src/core/folders.ts";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-folders-"));
process.env.LH_DATA_DIR = TMP_DATA;
after(() => fs.rmSync(TMP_DATA, { recursive: true, force: true }));

function ok(r: ReturnType<typeof createFolder>): FoldersState {
	assert.ok(r.ok, r.ok ? "" : r.error);
	return r.state;
}
const make = (s: FoldersState, id: string, parent: string | null = null) => ok(createFolder(s, id.toUpperCase(), parent, id, "2026-01-01T00:00:00.000Z"));

describe("folder rules", () => {
	it("creates, renames, nests, and rejects bad names / parents", () => {
		let s = make(EMPTY_FOLDERS, "a");
		s = make(s, "b", "a");
		assert.equal(s.folders.length, 2);
		assert.equal(createFolder(s, "   ", null, "x", "t").ok, false);
		const missing = createFolder(s, "X", "nope", "x", "t");
		assert.ok(!missing.ok && missing.status === 404);
		s = ok(renameFolder(s, "a", "  Calculus   notes "));
		assert.equal(s.folders[0]!.name, "Calculus notes");
		assert.equal(renameFolder(s, "zzz", "n").ok, false);
	});
	it("caps nesting depth", () => {
		let s = make(EMPTY_FOLDERS, "f1");
		for (let i = 2; i <= MAX_FOLDER_DEPTH; i++) s = make(s, `f${i}`, `f${i - 1}`);
		assert.equal(createFolder(s, "deep", `f${MAX_FOLDER_DEPTH}`, "deep", "t").ok, false);
	});
	it("moves folders but never into themselves or their descendants, nor past the depth cap", () => {
		let s = make(EMPTY_FOLDERS, "a");
		s = make(s, "b", "a");
		s = make(s, "c", "b");
		assert.equal(moveFolder(s, "a", "a").ok, false);
		assert.equal(moveFolder(s, "a", "c").ok, false, "into a descendant");
		s = ok(moveFolder(s, "c", null));
		assert.equal(s.folders.find((f) => f.id === "c")!.parentId, null);
		// a 3-high subtree can't land under a depth-5 parent
		let t = make(EMPTY_FOLDERS, "p1");
		for (let i = 2; i <= 5; i++) t = make(t, `p${i}`, `p${i - 1}`);
		t = make(t, "x");
		t = make(t, "y", "x");
		t = make(t, "z", "y");
		assert.equal(moveFolder(t, "x", "p5").ok, false);
		assert.equal(moveFolder(t, "x", "p3").ok, true);
	});
	it("deleting a folder moves its sessions and subfolders up — nothing inside is lost", () => {
		let s = make(EMPTY_FOLDERS, "a");
		s = make(s, "b", "a");
		s = make(s, "c", "b");
		s = ok(placeSessions(s, ["chat1", "chat2"], "b"));
		s = ok(placeSessions(s, ["chat3"], "a"));
		s = ok(deleteFolder(s, "b"));
		assert.deepEqual(s.folders.map((f) => [f.id, f.parentId]), [["a", null], ["c", "a"]]);
		assert.equal(s.placements.chat1, "a");
		assert.equal(s.placements.chat2, "a");
		s = ok(deleteFolder(s, "a"));
		assert.equal(s.placements.chat1, undefined, "top-level parent → unfiled");
		assert.deepEqual(s.folders.map((f) => [f.id, f.parentId]), [["c", null]]);
	});
	it("places and unplaces sessions; prunes dead ones", () => {
		let s = make(EMPTY_FOLDERS, "a");
		s = ok(placeSessions(s, ["x", "y"], "a"));
		assert.equal(placeSessions(s, ["x"], "nope").ok, false);
		s = ok(placeSessions(s, ["x"], null));
		assert.deepEqual(s.placements, { y: "a" });
		assert.deepEqual(pruneSessions(s, new Set(["x"])).placements, {});
	});
	it("sanitizes junk, dangling parents, cycles, and dead placements", () => {
		const s = sanitizeFolders({
			folders: [
				{ id: "a", name: "A", parentId: "b" },
				{ id: "b", name: "B", parentId: "a" }, // cycle
				{ id: "c", name: "C", parentId: "gone" },
				{ id: "c", name: "dup" },
				{ id: "", name: "x" },
				{ id: "d", name: "   " },
				"junk",
			],
			placements: { s1: "a", s2: "nope", s3: 5 },
		});
		assert.deepEqual(s.folders.map((f) => f.id).sort(), ["a", "b", "c"]);
		assert.ok(s.folders.every((f) => f.parentId === null || s.folders.some((g) => g.id === f.parentId)));
		assert.deepEqual(s.placements, { s1: "a" });
		assert.deepEqual(sanitizeFolders("nope"), EMPTY_FOLDERS);
	});
});

describe("layoutSessionRows", () => {
	let s: FoldersState = make(EMPTY_FOLDERS, "a");
	s = make(s, "b", "a");
	s = make(s, "empty");
	s = ok(placeSessions(s, ["s1"], "a"));
	s = ok(placeSessions(s, ["s2"], "b"));
	const ids = ["s1", "s2", "s3"];
	const shape = (rows: ReturnType<typeof layoutSessionRows>) => rows.map((r) => (r.type === "folder" ? `F:${r.folder.id}@${r.depth}${r.open ? "+" : "-"}${r.count}` : `S:${r.id}@${r.depth}`));

	it("collapsed folders hide contents; unfiled sessions follow", () => {
		assert.deepEqual(shape(layoutSessionRows(s, ids, new Set(), false)), ["F:a@0-2", "F:empty@0-0", "S:s3@0"]);
	});
	it("open folders show subfolders then their own sessions, indented", () => {
		assert.deepEqual(shape(layoutSessionRows(s, ids, new Set(["a", "b"]), false)), ["F:a@0+2", "F:b@1+1", "S:s2@2", "S:s1@1", "F:empty@0-0", "S:s3@0"]);
	});
	it("prune hides folders with no visible sessions", () => {
		assert.deepEqual(shape(layoutSessionRows(s, ["s3"], new Set(["a"]), true)), ["S:s3@0"]);
		assert.deepEqual(shape(layoutSessionRows(s, ["s2"], new Set(), true)), ["F:a@0-1"]);
	});
	it("a session placed in a missing folder shows as unfiled; a folder selects its subtree", () => {
		const stale: FoldersState = { folders: [], placements: { s1: "gone" } };
		assert.deepEqual(shape(layoutSessionRows(stale, ["s1"], new Set(), false)), ["S:s1@0"]);
		assert.deepEqual(sessionsUnderFolder(s, "a", ids).sort(), ["s1", "s2"]);
	});
});

type Handler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
const call = (h: Handler | ((req: Request) => Promise<Response>), method: string, body?: unknown, id = "x") =>
	(h as Handler)(new Request("http://x/api", { method, body: body === undefined ? undefined : JSON.stringify(body) }), { params: Promise.resolve({ id }) });

describe("folder routes + store", () => {
	let list: { GET: () => Promise<Response>; POST: Handler };
	let item: { PUT: Handler; DELETE: Handler };
	let move: { POST: Handler };
	let bulk: { POST: Handler };
	let createChat: (title: string) => { id: string };
	let getChat: (id: string) => unknown;
	before(async () => {
		list = (await import("../app/api/folders/route.ts")) as never;
		item = (await import("../app/api/folders/[id]/route.ts")) as never;
		move = (await import("../app/api/folders/move/route.ts")) as never;
		bulk = (await import("../app/api/chats/bulk-delete/route.ts")) as never;
		const server = await import("../src/server/chats.ts");
		createChat = server.createChat as never;
		getChat = server.getChat as never;
	});

	it("creates, nests, files sessions, and deleting a session un-files it", async () => {
		const a = (await (await call(list.POST, "POST", { name: "Math" })).json()) as { id: string };
		const b = (await (await call(list.POST, "POST", { name: "Calc", parentId: a.id })).json()) as { id: string };
		assert.equal((await call(list.POST, "POST", { name: "" })).status, 400);
		const chat = createChat("Limits");
		const moved = (await (await call(move.POST, "POST", { chatIds: [chat.id, "ghost"], folderId: b.id })).json()) as { moved: number; placements: Record<string, string> };
		assert.equal(moved.moved, 1, "unknown sessions are ignored");
		assert.equal(moved.placements[chat.id], b.id);
		assert.equal((await call(move.POST, "POST", { chatIds: [chat.id], folderId: "nope" })).status, 404);

		const renamed = await call(item.PUT, "PUT", { name: "Calculus" }, b.id);
		assert.equal(renamed.status, 200);
		assert.equal((await call(item.PUT, "PUT", { parentId: b.id }, a.id)).status, 400, "parent into its own child");
		const afterDelete = (await (await call(item.DELETE, "DELETE", undefined, b.id)).json()) as { folders: { id: string }[]; placements: Record<string, string> };
		assert.deepEqual(afterDelete.folders.map((f) => f.id), [a.id]);
		assert.equal(afterDelete.placements[chat.id], a.id, "the session moved up, not deleted");
		assert.ok(getChat(chat.id));

		// bulk delete removes the sessions and their placements
		const res = (await (await call(bulk.POST, "POST", { ids: [chat.id, "ghost"], mode: "preserve-graph" })).json()) as { deleted: string[]; failed: unknown[] };
		assert.deepEqual(res.deleted.sort(), [chat.id, "ghost"].sort());
		assert.deepEqual(res.failed, []);
		assert.ok(!getChat(chat.id), "the session is gone");
		const final = (await (await list.GET()).json()) as { placements: Record<string, string> };
		assert.equal(final.placements[chat.id], undefined);
	});

	it("bulk delete validates its input", async () => {
		assert.equal((await call(bulk.POST, "POST", { ids: [], mode: "preserve-graph" })).status, 400);
		assert.equal((await call(bulk.POST, "POST", { ids: ["a"], mode: "nuke" })).status, 400);
	});
});
