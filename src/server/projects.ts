import { parseSourceScope, scopeNote } from "../core/source-scope.ts";
import { applySourceScope, writePdfPageLimit } from "./source-scope.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../../config.ts";
import {
	projectInstructionsError,
	projectNameError,
	type ProjectDetail,
	type ProjectFileMeta,
	type ProjectSummary,
} from "../core/projects.ts";
import { lessonSourceError, lessonSourceExtension, MAX_LESSON_SOURCES } from "../core/lesson-sources.ts";
import type { IncomingSource } from "./session-sources.ts";
import { saveLessonSources } from "./session-sources.ts";

const ID = /^proj_[A-Za-z0-9]+_[A-Za-z0-9]+$/;

interface ProjectState {
	version: 1;
	activeId: string | null;
}

interface ProjectMeta {
	id: string;
	name: string;
	instructions: string;
	files: ProjectFileMeta[];
	updatedAt: number;
}

function projectsRoot(root = PATHS.data): string {
	return path.join(root, "projects");
}

function statePath(root = PATHS.data): string {
	return path.join(projectsRoot(root), "state.json");
}

function projectDir(id: string, root = PATHS.data): string {
	return path.join(projectsRoot(root), id);
}

function metaPath(id: string, root = PATHS.data): string {
	return path.join(projectDir(id, root), "meta.json");
}

function filesDir(id: string, root = PATHS.data): string {
	return path.join(projectDir(id, root), "files");
}

function readState(root = PATHS.data): ProjectState {
	try {
		const raw = JSON.parse(fs.readFileSync(statePath(root), "utf8")) as Partial<ProjectState>;
		const activeId = typeof raw.activeId === "string" && ID.test(raw.activeId) ? raw.activeId : null;
		return { version: 1, activeId };
	} catch {
		return { version: 1, activeId: null };
	}
}

function writeState(state: ProjectState, root = PATHS.data): void {
	fs.mkdirSync(projectsRoot(root), { recursive: true });
	fs.writeFileSync(statePath(root), `${JSON.stringify(state, null, "\t")}\n`);
}

function readMeta(id: string, root = PATHS.data): ProjectMeta | null {
	if (!ID.test(id)) return null;
	try {
		const raw = JSON.parse(fs.readFileSync(metaPath(id, root), "utf8")) as ProjectMeta;
		if (raw.id !== id || typeof raw.name !== "string") return null;
		return {
			id,
			name: raw.name,
			instructions: typeof raw.instructions === "string" ? raw.instructions : "",
			files: Array.isArray(raw.files) ? raw.files.filter((f) => f && typeof f.name === "string" && typeof f.stored === "string") : [],
			updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
		};
	} catch {
		return null;
	}
}

function writeMeta(meta: ProjectMeta, root = PATHS.data): void {
	fs.mkdirSync(projectDir(meta.id, root), { recursive: true });
	fs.writeFileSync(metaPath(meta.id, root), `${JSON.stringify(meta, null, "\t")}\n`);
}

function toDetail(meta: ProjectMeta): ProjectDetail {
	return {
		id: meta.id,
		name: meta.name,
		instructions: meta.instructions,
		files: meta.files,
		fileCount: meta.files.length,
		updatedAt: meta.updatedAt,
	};
}

function toSummary(meta: ProjectMeta): ProjectSummary {
	return {
		id: meta.id,
		name: meta.name,
		fileCount: meta.files.length,
		updatedAt: meta.updatedAt,
	};
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

function mintId(): string {
	return `proj_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
}

export function listProjects(root = PATHS.data): { activeId: string | null; projects: ProjectSummary[] } {
	const state = readState(root);
	const dir = projectsRoot(root);
	if (!fs.existsSync(dir)) return { activeId: null, projects: [] };
	const projects: ProjectSummary[] = [];
	for (const name of fs.readdirSync(dir)) {
		if (!ID.test(name)) continue;
		const meta = readMeta(name, root);
		if (meta) projects.push(toSummary(meta));
	}
	projects.sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name));
	const activeId = state.activeId && projects.some((p) => p.id === state.activeId) ? state.activeId : null;
	if (activeId !== state.activeId) writeState({ version: 1, activeId }, root);
	return { activeId, projects };
}

export function getProject(id: string, root = PATHS.data): ProjectDetail | null {
	const meta = readMeta(id, root);
	return meta ? toDetail(meta) : null;
}

export function getActiveProject(root = PATHS.data): ProjectDetail | null {
	const { activeId } = listProjects(root);
	return activeId ? getProject(activeId, root) : null;
}

export type ProjectWriteResult =
	| { ok: true; project: ProjectDetail }
	| { ok: false; status: number; error: string };

export function createProject(
	input: { name: string; instructions: string; files: readonly IncomingSource[] },
	root = PATHS.data,
): ProjectWriteResult {
	const nameErr = projectNameError(input.name);
	if (nameErr) return { ok: false, status: 400, error: nameErr };
	const instrErr = projectInstructionsError(input.instructions);
	if (instrErr) return { ok: false, status: 400, error: instrErr };
	if (input.files.length > MAX_LESSON_SOURCES) {
		return { ok: false, status: 400, error: `A project can hold ${MAX_LESSON_SOURCES} files.` };
	}
	const id = mintId();
	const used = new Set<string>();
	const planned: ProjectFileMeta[] = [];
	const bytesByStored = new Map<string, Uint8Array>();
	for (const file of input.files) {
		const reason = lessonSourceError(file.name, file.bytes.byteLength, planned.length);
		if (reason) return { ok: false, status: 400, error: reason };
		const stored = storedName(file.name, used);
		if (!stored) return { ok: false, status: 400, error: "Attach a PDF, Word, PowerPoint, Excel, text, Markdown, code, data, or image file." };
		const display = file.name.split(/[/\\]/).pop() ?? stored;
		planned.push({ name: display, stored });
		bytesByStored.set(stored, file.bytes);
	}
	const meta: ProjectMeta = {
		id,
		name: input.name.trim(),
		instructions: input.instructions,
		files: planned,
		updatedAt: Date.now(),
	};
	fs.mkdirSync(filesDir(id, root), { recursive: true });
	for (const file of planned) {
		fs.writeFileSync(path.join(filesDir(id, root), file.stored), bytesByStored.get(file.stored)!);
	}
	writeMeta(meta, root);
	writeState({ version: 1, activeId: id }, root);
	return { ok: true, project: toDetail(meta) };
}

export function updateProjectMeta(
	id: string,
	patch: { name?: string; instructions?: string },
	root = PATHS.data,
): ProjectWriteResult {
	const meta = readMeta(id, root);
	if (!meta) return { ok: false, status: 404, error: "Project not found." };
	if (patch.name !== undefined) {
		const nameErr = projectNameError(patch.name);
		if (nameErr) return { ok: false, status: 400, error: nameErr };
		meta.name = patch.name.trim();
	}
	if (patch.instructions !== undefined) {
		const instrErr = projectInstructionsError(patch.instructions);
		if (instrErr) return { ok: false, status: 400, error: instrErr };
		meta.instructions = patch.instructions;
	}
	meta.updatedAt = Date.now();
	writeMeta(meta, root);
	return { ok: true, project: toDetail(meta) };
}

export function addProjectFiles(
	id: string,
	files: readonly IncomingSource[],
	root = PATHS.data,
): ProjectWriteResult {
	const meta = readMeta(id, root);
	if (!meta) return { ok: false, status: 404, error: "Project not found." };
	if (files.length === 0) return { ok: false, status: 400, error: "Choose a file to attach." };
	if (meta.files.length + files.length > MAX_LESSON_SOURCES) {
		return { ok: false, status: 400, error: `A project can hold ${MAX_LESSON_SOURCES} files.` };
	}
	const used = new Set(meta.files.map((f) => f.stored));
	fs.mkdirSync(filesDir(id, root), { recursive: true });
	for (const file of files) {
		const reason = lessonSourceError(file.name, file.bytes.byteLength, meta.files.length);
		if (reason) return { ok: false, status: 400, error: reason };
		const stored = storedName(file.name, used);
		if (!stored) return { ok: false, status: 400, error: "Attach a PDF, Word, PowerPoint, Excel, text, Markdown, code, data, or image file." };
		const display = file.name.split(/[/\\]/).pop() ?? stored;
		fs.writeFileSync(path.join(filesDir(id, root), stored), file.bytes);
		meta.files.push({ name: display, stored });
	}
	meta.updatedAt = Date.now();
	writeMeta(meta, root);
	return { ok: true, project: toDetail(meta) };
}

export function removeProjectFile(id: string, stored: string, root = PATHS.data): ProjectWriteResult {
	const meta = readMeta(id, root);
	if (!meta) return { ok: false, status: 404, error: "Project not found." };
	const next = meta.files.filter((f) => f.stored !== stored);
	if (next.length === meta.files.length) return { ok: false, status: 404, error: "File not found." };
	meta.files = next;
	meta.updatedAt = Date.now();
	fs.rmSync(path.join(filesDir(id, root), stored), { force: true });
	writeMeta(meta, root);
	return { ok: true, project: toDetail(meta) };
}

export function deleteProject(id: string, root = PATHS.data): { ok: true } | { ok: false; status: number; error: string } {
	if (!ID.test(id)) return { ok: false, status: 400, error: "Invalid project id." };
	if (!readMeta(id, root)) return { ok: false, status: 404, error: "Project not found." };
	fs.rmSync(projectDir(id, root), { recursive: true, force: true });
	const state = readState(root);
	if (state.activeId === id) writeState({ version: 1, activeId: null }, root);
	return { ok: true };
}

export function setActiveProject(id: string | null, root = PATHS.data): { ok: true; activeId: string | null } | { ok: false; status: number; error: string } {
	if (id === null) {
		writeState({ version: 1, activeId: null }, root);
		return { ok: true, activeId: null };
	}
	if (!getProject(id, root)) return { ok: false, status: 404, error: "Project not found." };
	writeState({ version: 1, activeId: id }, root);
	return { ok: true, activeId: id };
}

/** Copy the pack's files into the session folder and return paths + instructions. */
export function applyProjectToSession(
	chatId: string,
	projectId: string | undefined,
	root = PATHS.data,
): { ok: true; paths: string[]; instructions: string; projectId: string } | { ok: false; status: number; error: string } {
	const id = projectId ?? readState(root).activeId;
	if (!id) return { ok: false, status: 404, error: "No project selected." };
	const meta = readMeta(id, root);
	if (!meta) return { ok: false, status: 404, error: "Project not found." };
	if (meta.files.length === 0) {
		return { ok: true, paths: [], instructions: meta.instructions, projectId: id };
	}
	const incoming: IncomingSource[] = [];
	for (const file of meta.files) {
		const filePath = path.join(filesDir(id, root), file.stored);
		try {
			incoming.push({ name: file.name, bytes: new Uint8Array(fs.readFileSync(filePath)) });
		} catch {
			return { ok: false, status: 500, error: `Missing project file: ${file.name}` };
		}
	}
	const saved = saveLessonSources(chatId, incoming, root);
	if (!saved.ok) return { ok: false, status: saved.status, error: saved.error };
	return { ok: true, paths: saved.paths, instructions: meta.instructions, projectId: id };
}

/** A project file's path on disk (the @-mention scope picker's outline). */
export function projectFilePath(id: string, stored: string, root = PATHS.data): { path: string; name: string } | null {
	const meta = readMeta(id, root);
	const file = meta?.files.find((f) => f.stored === stored);
	return file ? { path: path.join(filesDir(id, root), file.stored), name: file.name } : null;
}

/** @-mentioned project files (owner 2026-10-26): copy ONLY the picked
 *  files into the session, each cut to its scope (slides/sections) or
 *  page-limited (PDFs) — the same hard limit as an attached file. */
export async function applyProjectFilesToSession(
	chatId: string,
	projectId: string,
	picks: ReadonlyArray<{ stored: string; scope?: unknown }>,
	root = PATHS.data,
): Promise<
	| { ok: true; paths: string[]; notes: (string | null)[]; instructions: string; projectId: string }
	| { ok: false; status: number; error: string }
> {
	const meta = readMeta(projectId, root);
	if (!meta) return { ok: false, status: 404, error: "Project not found." };
	const files: Array<{ name: string; bytes: Uint8Array; pdfPages?: number[] }> = [];
	const notes: (string | null)[] = [];
	for (const pick of picks) {
		const file = meta.files.find((f) => f.stored === pick.stored);
		if (!file) return { ok: false, status: 404, error: "Project file not found." };
		let bytes: Uint8Array;
		try {
			bytes = new Uint8Array(fs.readFileSync(path.join(filesDir(projectId, root), file.stored)));
		} catch {
			return { ok: false, status: 500, error: `Missing project file: ${file.name}` };
		}
		const scope = parseSourceScope(pick.scope, file.name);
		try {
			files.push(scope ? await applySourceScope({ name: file.name, bytes }, scope) : { name: file.name, bytes });
		} catch (err) {
			return { ok: false, status: 400, error: err instanceof Error ? err.message : "Couldn't limit the file." };
		}
		notes.push(scope ? scopeNote(scope) : null);
	}
	const saved = saveLessonSources(chatId, files, root);
	if (!saved.ok) return { ok: false, status: saved.status, error: saved.error };
	files.forEach((f, i) => {
		if (f.pdfPages) writePdfPageLimit(saved.paths[i]!, f.pdfPages);
	});
	return { ok: true, paths: saved.paths, notes, instructions: meta.instructions, projectId };
}
