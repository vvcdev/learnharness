import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../../config.ts";
import { lessonSourceError, lessonSourceExtension, MAX_LESSON_SOURCES } from "../core/lesson-sources.ts";
import type { IncomingSource } from "./session-sources.ts";

const BATCH = /^upl_[A-Za-z0-9]+_[A-Za-z0-9]+$/;

export interface StagedFileMeta {
	name: string;
	stored: string;
}

export interface StagedBatch {
	id: string;
	files: StagedFileMeta[];
}

export type StageUploadsResult =
	| { ok: true; batch: StagedBatch }
	| { ok: false; status: number; error: string };

export type ClaimUploadsResult =
	| { ok: true; files: IncomingSource[] }
	| { ok: false; status: number; error: string };

function uploadsRoot(root = PATHS.data): string {
	return path.join(root, "uploads");
}

function batchDir(batchId: string, root = PATHS.data): string {
	if (!BATCH.test(batchId)) throw new Error("Invalid upload id");
	return path.join(uploadsRoot(root), batchId);
}

function metaPath(batchId: string, root = PATHS.data): string {
	return path.join(batchDir(batchId, root), "meta.json");
}

function mintBatchId(): string {
	return `upl_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
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

function readMeta(batchId: string, root = PATHS.data): StagedBatch | null {
	if (!BATCH.test(batchId)) return null;
	try {
		const raw = JSON.parse(fs.readFileSync(metaPath(batchId, root), "utf8")) as StagedBatch;
		if (raw.id !== batchId || !Array.isArray(raw.files)) return null;
		return {
			id: batchId,
			files: raw.files.filter((f) => f && typeof f.name === "string" && typeof f.stored === "string"),
		};
	} catch {
		return null;
	}
}

function writeMeta(batch: StagedBatch, root = PATHS.data): void {
	fs.mkdirSync(batchDir(batch.id, root), { recursive: true });
	fs.writeFileSync(metaPath(batch.id, root), `${JSON.stringify(batch, null, "\t")}\n`);
}

/** Copy picked files into the app data folder immediately so Downloads can go away. */
export function stageUploads(files: readonly IncomingSource[], root = PATHS.data): StageUploadsResult {
	if (files.length === 0) return { ok: false, status: 400, error: "Choose a file to attach." };
	if (files.length > MAX_LESSON_SOURCES) {
		return { ok: false, status: 400, error: `A lesson can hold ${MAX_LESSON_SOURCES} sources.` };
	}
	const used = new Set<string>();
	const planned: StagedFileMeta[] = [];
	const bytesByStored = new Map<string, Uint8Array>();
	for (const file of files) {
		const reason = lessonSourceError(file.name, file.bytes.byteLength, planned.length);
		if (reason) return { ok: false, status: 400, error: reason };
		const stored = storedName(file.name, used);
		if (!stored) {
			return { ok: false, status: 400, error: "Attach a PDF, Word, PowerPoint, Excel, text, Markdown, code, data, or image file." };
		}
		const display = file.name.split(/[/\\]/).pop() ?? stored;
		planned.push({ name: display, stored });
		bytesByStored.set(stored, file.bytes);
	}
	const id = mintBatchId();
	const dir = batchDir(id, root);
	fs.mkdirSync(dir, { recursive: true });
	for (const file of planned) {
		fs.writeFileSync(path.join(dir, file.stored), bytesByStored.get(file.stored)!);
	}
	const batch: StagedBatch = { id, files: planned };
	writeMeta(batch, root);
	return { ok: true, batch };
}

/** Read staged files (and remove the batch) so they can be claimed into a session or project. */
export function claimUploads(
	refs: readonly { batchId: string; stored: string }[],
	root = PATHS.data,
): ClaimUploadsResult {
	if (refs.length === 0) return { ok: false, status: 400, error: "Choose a file to attach." };
	if (refs.length > MAX_LESSON_SOURCES) {
		return { ok: false, status: 400, error: `A lesson can hold ${MAX_LESSON_SOURCES} sources.` };
	}
	const out: IncomingSource[] = [];
	const touched = new Set<string>();
	for (const ref of refs) {
		const meta = readMeta(ref.batchId, root);
		if (!meta) return { ok: false, status: 404, error: "Upload not found." };
		const entry = meta.files.find((f) => f.stored === ref.stored);
		if (!entry) return { ok: false, status: 404, error: "Upload file not found." };
		const filePath = path.join(batchDir(ref.batchId, root), entry.stored);
		try {
			out.push({ name: entry.name, bytes: new Uint8Array(fs.readFileSync(filePath)) });
		} catch {
			return { ok: false, status: 500, error: `Missing upload: ${entry.name}` };
		}
		touched.add(ref.batchId);
	}
	for (const batchId of touched) {
		fs.rmSync(batchDir(batchId, root), { recursive: true, force: true });
	}
	return { ok: true, files: out };
}

/** A staged file's path on disk (the scope picker's outline reads it). */
export function stagedUploadPath(batchId: string, stored: string, root = PATHS.data): { path: string; name: string } | null {
	const meta = readMeta(batchId, root);
	const entry = meta?.files.find((f) => f.stored === stored);
	return entry ? { path: path.join(batchDir(batchId, root), entry.stored), name: entry.name } : null;
}

export function removeUploadBatch(batchId: string, root = PATHS.data): void {
	if (!BATCH.test(batchId)) return;
	fs.rmSync(batchDir(batchId, root), { recursive: true, force: true });
}
