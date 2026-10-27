/** data/folders.json — the session folders (read-modify-write; sidebar
 *  organization only). The shape and every rule live in core/folders.ts. */

import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../../config.ts";
import { sanitizeFolders, type FolderResult, type FoldersState } from "../core/folders.ts";

function file(): string {
	return path.join(PATHS.data, "folders.json");
}

export function readFolders(): FoldersState {
	try {
		return sanitizeFolders(JSON.parse(fs.readFileSync(file(), "utf-8")));
	} catch {
		return sanitizeFolders(null); // never written / corrupt → empty, never crash the sidebar
	}
}

export function writeFolders(state: FoldersState): void {
	fs.mkdirSync(path.dirname(file()), { recursive: true });
	const tmp = `${file()}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(state, null, "\t"), "utf-8");
	fs.renameSync(tmp, file());
}

/** Run a pure transition over the stored state, persisting on success. */
export function updateFolders(transition: (state: FoldersState) => FolderResult): FolderResult {
	const result = transition(readFolders());
	if (result.ok) writeFolders(result.state);
	return result;
}

/** A deleted session leaves its folder (idempotent). */
export function unplaceChat(chatId: string): void {
	const state = readFolders();
	if (!(chatId in state.placements)) return;
	const placements = { ...state.placements };
	delete placements[chatId];
	writeFolders({ ...state, placements });
}
