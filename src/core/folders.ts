/** Session folders (owner, 2026-10-27): nested, any session kind inside,
 *  one folder per session. Pure — the store moves the bytes. Folders are
 *  sidebar organization only; sessions, the graph, and chat records never
 *  know about them. */

export const MAX_FOLDER_DEPTH = 6;
export const MAX_FOLDER_NAME = 80;
export const MAX_FOLDERS = 500;

export interface FolderRecord {
	id: string;
	name: string;
	/** null = top level. */
	parentId: string | null;
	createdAt: string;
}

export interface FoldersState {
	folders: FolderRecord[];
	/** chat id → the folder it sits in (absent = unfiled). */
	placements: Record<string, string>;
}

export const EMPTY_FOLDERS: FoldersState = { folders: [], placements: {} };

export type FolderResult<T = FoldersState> = { ok: true; state: T } | { ok: false; status: number; error: string };

const fail = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });

export function cleanFolderName(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const name = raw.replace(/\s+/g, " ").trim().slice(0, MAX_FOLDER_NAME);
	return name || null;
}

/** Whatever came off disk, made safe: drops malformed rows, dangling
 *  parents/placements, cycles, and over-deep branches (re-rooted). */
export function sanitizeFolders(raw: unknown): FoldersState {
	if (!raw || typeof raw !== "object") return { folders: [], placements: {} };
	const r = raw as { folders?: unknown; placements?: unknown };
	const seen = new Set<string>();
	const rows: FolderRecord[] = [];
	for (const f of Array.isArray(r.folders) ? r.folders : []) {
		if (!f || typeof f !== "object") continue;
		const { id, name, parentId, createdAt } = f as Record<string, unknown>;
		const clean = cleanFolderName(name);
		if (typeof id !== "string" || !id || seen.has(id) || !clean) continue;
		seen.add(id);
		rows.push({
			id,
			name: clean,
			parentId: typeof parentId === "string" ? parentId : null,
			createdAt: typeof createdAt === "string" ? createdAt : new Date(0).toISOString(),
		});
	}
	const byId = new Map(rows.map((f) => [f.id, f]));
	// Dangling parent → top level.
	for (const f of rows) if (f.parentId !== null && !byId.has(f.parentId)) f.parentId = null;
	// Cycles / over-deep → re-root the offender.
	for (const f of rows) {
		const depth = depthOfIn(byId, f.id);
		if (depth === null || depth > MAX_FOLDER_DEPTH) f.parentId = null;
	}
	const placements: Record<string, string> = {};
	if (r.placements && typeof r.placements === "object") {
		for (const [chatId, folderId] of Object.entries(r.placements as Record<string, unknown>)) {
			if (typeof folderId === "string" && byId.has(folderId)) placements[chatId] = folderId;
		}
	}
	return { folders: rows.slice(0, MAX_FOLDERS), placements };
}

/** Depth of a folder (top level = 1); null when its parent chain cycles. */
function depthOfIn(byId: Map<string, FolderRecord>, id: string): number | null {
	let depth = 0;
	const walked = new Set<string>();
	let cursor: string | null = id;
	while (cursor !== null) {
		if (walked.has(cursor)) return null;
		walked.add(cursor);
		const folder = byId.get(cursor);
		if (!folder) return depth;
		depth += 1;
		cursor = folder.parentId;
	}
	return depth;
}

const index = (s: FoldersState) => new Map(s.folders.map((f) => [f.id, f]));

/** The height of the subtree under `id` (a leaf = 1). */
function subtreeHeight(s: FoldersState, id: string): number {
	const kids = s.folders.filter((f) => f.parentId === id);
	return 1 + Math.max(0, ...kids.map((k) => subtreeHeight(s, k.id)));
}

export function createFolder(s: FoldersState, rawName: unknown, parentId: string | null, id: string, now: string): FolderResult {
	const name = cleanFolderName(rawName);
	if (!name) return fail(400, "Give the folder a name.");
	if (s.folders.length >= MAX_FOLDERS) return fail(400, `You can have ${MAX_FOLDERS} folders.`);
	const byId = index(s);
	if (parentId !== null) {
		if (!byId.has(parentId)) return fail(404, "That parent folder doesn't exist.");
		if ((depthOfIn(byId, parentId) ?? MAX_FOLDER_DEPTH) >= MAX_FOLDER_DEPTH) return fail(400, `Folders can nest ${MAX_FOLDER_DEPTH} levels deep.`);
	}
	return { ok: true, state: { ...s, folders: [...s.folders, { id, name, parentId, createdAt: now }] } };
}

export function renameFolder(s: FoldersState, id: string, rawName: unknown): FolderResult {
	const name = cleanFolderName(rawName);
	if (!name) return fail(400, "Give the folder a name.");
	if (!s.folders.some((f) => f.id === id)) return fail(404, "No such folder.");
	return { ok: true, state: { ...s, folders: s.folders.map((f) => (f.id === id ? { ...f, name } : f)) } };
}

/** Move a folder under another (or to the top level) — never into itself
 *  or its own descendants, never past the depth cap. */
export function moveFolder(s: FoldersState, id: string, parentId: string | null): FolderResult {
	const byId = index(s);
	if (!byId.has(id)) return fail(404, "No such folder.");
	if (parentId !== null) {
		if (!byId.has(parentId)) return fail(404, "That parent folder doesn't exist.");
		// Walk the target's ancestry: hitting `id` means moving into itself/descendant.
		for (let cursor: string | null = parentId; cursor !== null; cursor = byId.get(cursor)?.parentId ?? null) {
			if (cursor === id) return fail(400, "A folder can't go inside itself.");
		}
		const base = depthOfIn(byId, parentId) ?? MAX_FOLDER_DEPTH;
		if (base + subtreeHeight(s, id) > MAX_FOLDER_DEPTH) return fail(400, `Folders can nest ${MAX_FOLDER_DEPTH} levels deep.`);
	}
	return { ok: true, state: { ...s, folders: s.folders.map((f) => (f.id === id ? { ...f, parentId } : f)) } };
}

/** Delete a folder. Sessions and subfolders are NEVER deleted: they move up
 *  to the deleted folder's parent. */
export function deleteFolder(s: FoldersState, id: string): FolderResult {
	const target = s.folders.find((f) => f.id === id);
	if (!target) return fail(404, "No such folder.");
	const placements: Record<string, string> = {};
	for (const [chatId, folderId] of Object.entries(s.placements)) {
		if (folderId !== id) placements[chatId] = folderId;
		else if (target.parentId !== null) placements[chatId] = target.parentId;
	}
	return {
		ok: true,
		state: {
			folders: s.folders.filter((f) => f.id !== id).map((f) => (f.parentId === id ? { ...f, parentId: target.parentId } : f)),
			placements,
		},
	};
}

/** File sessions into a folder (null = back to the top level). */
export function placeSessions(s: FoldersState, chatIds: readonly string[], folderId: string | null): FolderResult {
	if (folderId !== null && !s.folders.some((f) => f.id === folderId)) return fail(404, "No such folder.");
	const placements = { ...s.placements };
	for (const chatId of chatIds) {
		if (folderId === null) delete placements[chatId];
		else placements[chatId] = folderId;
	}
	return { ok: true, state: { ...s, placements } };
}

/** Drop placements for sessions that no longer exist. */
export function pruneSessions(s: FoldersState, liveChatIds: ReadonlySet<string>): FoldersState {
	const placements: Record<string, string> = {};
	for (const [chatId, folderId] of Object.entries(s.placements)) if (liveChatIds.has(chatId)) placements[chatId] = folderId;
	return Object.keys(placements).length === Object.keys(s.placements).length ? s : { ...s, placements };
}

export interface FolderNode {
	folder: FolderRecord;
	depth: number;
	children: FolderNode[];
}

/** The folders as a tree, siblings sorted by name (case-insensitive). */
export function folderTree(s: FoldersState): FolderNode[] {
	const byParent = new Map<string | null, FolderRecord[]>();
	for (const f of s.folders) byParent.set(f.parentId, [...(byParent.get(f.parentId) ?? []), f]);
	const build = (parentId: string | null, depth: number): FolderNode[] =>
		(byParent.get(parentId) ?? [])
			.slice()
			.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
			.map((folder) => ({ folder, depth, children: build(folder.id, depth + 1) }));
	return build(null, 0);
}

/** A folder and everything under it (ids). */
export function folderSubtreeIds(s: FoldersState, id: string): string[] {
	const out = [id];
	for (const f of s.folders) if (f.parentId === id) out.push(...folderSubtreeIds(s, f.id));
	return out;
}

export type SessionListRow =
	| { type: "folder"; folder: FolderRecord; depth: number; open: boolean; count: number }
	| { type: "session"; id: string; depth: number };

/** The sidebar list as flat rows: folders (collapsible, nested) first, then
 *  the unfiled sessions. `sessionIds` are the visible sessions in display
 *  order; a session placed in a missing folder reads as unfiled. With
 *  `prune`, folders holding no visible session are left out (an active
 *  mode filter); otherwise empty folders still show. */
export function layoutSessionRows(s: FoldersState, sessionIds: readonly string[], openIds: ReadonlySet<string>, prune: boolean): SessionListRow[] {
	const known = new Set(s.folders.map((f) => f.id));
	const direct = new Map<string | null, string[]>();
	for (const id of sessionIds) {
		const placed = s.placements[id];
		const key = placed && known.has(placed) ? placed : null;
		direct.set(key, [...(direct.get(key) ?? []), id]);
	}
	const countIn = (node: FolderNode): number => (direct.get(node.folder.id)?.length ?? 0) + node.children.reduce((n, c) => n + countIn(c), 0);
	const rows: SessionListRow[] = [];
	const walk = (nodes: FolderNode[]) => {
		for (const node of nodes) {
			const count = countIn(node);
			if (prune && count === 0) continue;
			const open = openIds.has(node.folder.id);
			rows.push({ type: "folder", folder: node.folder, depth: node.depth, open, count });
			if (!open) continue;
			walk(node.children);
			for (const id of direct.get(node.folder.id) ?? []) rows.push({ type: "session", id, depth: node.depth + 1 });
		}
	};
	walk(folderTree(s));
	for (const id of direct.get(null) ?? []) rows.push({ type: "session", id, depth: 0 });
	return rows;
}

/** Every visible session at or under a folder (for a folder's select-all). */
export function sessionsUnderFolder(s: FoldersState, folderId: string, sessionIds: readonly string[]): string[] {
	const under = new Set(folderSubtreeIds(s, folderId));
	return sessionIds.filter((id) => under.has(s.placements[id] ?? ""));
}
