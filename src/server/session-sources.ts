import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../../config.ts";
import { lessonSourceError, lessonSourceExtension, MAX_LESSON_SOURCES } from "../core/lesson-sources.ts";

const ID = /^[A-Za-z0-9_-]+$/;

export interface IncomingSource {
	name: string;
	bytes: Uint8Array;
}

export type SaveSourcesResult =
	| { ok: true; paths: string[] }
	| { ok: false; status: number; error: string };

export function sessionSourcesDir(chatId: string, root = PATHS.data): string {
	if (!ID.test(chatId)) throw new Error("Invalid chat id");
	return path.join(root, "session-sources", chatId);
}

function storedName(name: string, used: Set<string>): string | null {
	const base = name.split(/[/\\]/).pop() ?? "";
	const ext = lessonSourceExtension(base);
	if (!ext) return null;
	const stem = base.slice(0, base.length - ext.length).replace(/[^\w.\- ()]+/g, "_").slice(0, 120) || "source";
	let candidate = `${stem}${ext}`;
	let n = 2;
	while (used.has(candidate)) {
		candidate = `${stem}-${n}${ext}`;
		n += 1;
	}
	used.add(candidate);
	return candidate;
}

/** Copy lesson files into this session's folder. Paths are absolute so the
 * teacher's existing read and pdf tools can open them. */
export function saveLessonSources(chatId: string, files: readonly IncomingSource[], root = PATHS.data): SaveSourcesResult {
	if (!ID.test(chatId)) return { ok: false, status: 400, error: "Invalid chat id" };
	if (files.length === 0) return { ok: false, status: 400, error: "Choose a file to attach." };
	if (files.length > MAX_LESSON_SOURCES) return { ok: false, status: 400, error: `A lesson can hold ${MAX_LESSON_SOURCES} sources.` };
	const dir = sessionSourcesDir(chatId, root);
	const used = new Set<string>();
	if (fs.existsSync(dir)) {
		for (const name of fs.readdirSync(dir)) used.add(name);
	}
	if (used.size + files.length > MAX_LESSON_SOURCES) return { ok: false, status: 400, error: `A lesson can hold ${MAX_LESSON_SOURCES} sources.` };
	const planned: { name: string; bytes: Uint8Array }[] = [];
	const existing = used.size;
	for (const file of files) {
		const reason = lessonSourceError(file.name, file.bytes.byteLength, existing + planned.length);
		if (reason) return { ok: false, status: 400, error: reason };
		const name = storedName(file.name, used);
		if (!name) return { ok: false, status: 400, error: "Attach a PDF, Word, PowerPoint, Excel, text, Markdown, code, data, or image file." };
		planned.push({ name, bytes: file.bytes });
	}
	fs.mkdirSync(dir, { recursive: true });
	const paths: string[] = [];
	for (const file of planned) {
		const dest = path.join(dir, file.name);
		fs.writeFileSync(dest, file.bytes);
		paths.push(dest);
	}
	return { ok: true, paths };
}

export function removeSessionSources(chatId: string, root = PATHS.data): void {
	if (!ID.test(chatId)) return;
	fs.rmSync(sessionSourcesDir(chatId, root), { recursive: true, force: true });
}
