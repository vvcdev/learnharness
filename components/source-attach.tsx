"use client";

import { useRef, useState, type ReactNode } from "react";
import { FolderIcon, PaperclipIcon, XIcon } from "lucide-react";
import { appendProjectContext, LESSON_SOURCE_ACCEPT, lessonSourceError, scopeChipLabel, scopeKindFor, type SourceScope } from "@/src/core";
import { SourceScopePicker } from "@/components/source-scope-picker";
import { cn } from "@/lib/utils";
import { isImageFile } from "@/components/learner-images";

/** A picked file already copied into the app's uploads folder. */
export type AttachedSource = {
	name: string;
	size: number;
	batchId: string;
	stored: string;
	/** Limit to chosen pages / slides / sections (owner 2026-10-26). */
	scope?: SourceScope;
	/** An @-mentioned project file (owner 2026-10-26): the project's id;
	 *  `stored` is the file's name inside the project, batchId unused. */
	project?: string;
};

/** An @-mentioned project file as a chip. */
export function projectSource(projectId: string, file: { name: string; stored: string }): AttachedSource {
	return { name: file.name, size: 0, batchId: `project:${projectId}`, stored: file.stored, project: projectId };
}

/** Where a chip's scope picker reads the file's outline. */
function outlineUrlFor(file: AttachedSource): string {
	return file.project
		? `/api/projects/${encodeURIComponent(file.project)}/files/${encodeURIComponent(file.stored)}/outline`
		: `/api/uploads/outline?batch=${encodeURIComponent(file.batchId)}&stored=${encodeURIComponent(file.stored)}`;
}

/** PDF page thumbnail base URL (the picker appends `&page=N` / `?page=N`). */
function previewUrlFor(file: AttachedSource): string | undefined {
	if (scopeKindFor(file.name) !== "pages") return undefined;
	return file.project
		? `/api/projects/${encodeURIComponent(file.project)}/files/${encodeURIComponent(file.stored)}/preview`
		: `/api/uploads/preview?batch=${encodeURIComponent(file.batchId)}&stored=${encodeURIComponent(file.stored)}`;
}

/** Copy @-mentioned project files into a session (with their limits).
 *  Returns the source-list lines plus the project's instructions. */
export async function attachProjectFiles(
	chatId: string,
	files: readonly AttachedSource[],
): Promise<{ paths: string[]; instructions: string }> {
	const projectId = files[0]?.project;
	if (!projectId) return { paths: [], instructions: "" };
	const response = await fetch(`/api/chats/${chatId}/project`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			projectId,
			files: files.map((f) => ({ stored: f.stored, ...(f.scope ? { scope: f.scope } : {}) })),
		}),
	});
	const payload = (await response.json().catch(() => ({}))) as {
		paths?: string[];
		notes?: (string | null)[];
		instructions?: string;
		error?: string;
	};
	if (!response.ok || !payload.paths) throw new Error(payload.error || "Could not add the project files.");
	return {
		paths: payload.paths.map((p, i) => (payload.notes?.[i] ? `${p} — ${payload.notes[i]}` : p)),
		instructions: payload.instructions ?? "",
	};
}

export async function stagePickedFiles(
	current: readonly AttachedSource[],
	incoming: FileList | null,
	/** How many files already live on the project/session besides `current`. */
	already = 0,
): Promise<{ files: AttachedSource[]; error: string | null }> {
	if (!incoming || incoming.length === 0) return { files: [...current], error: null };
	const next = [...current];
	const toUpload: File[] = [];
	for (const file of incoming) {
		const reason = lessonSourceError(file.name, file.size, already + next.length + toUpload.length);
		if (reason) return { files: next, error: reason };
		// Snapshot bytes immediately so deleting Downloads can't empty the File handle.
		const bytes = await file.arrayBuffer();
		toUpload.push(new File([bytes], file.name, { type: file.type }));
	}
	if (toUpload.length === 0) return { files: next, error: null };
	const body = new FormData();
	for (const file of toUpload) body.append("file", file);
	const response = await fetch("/api/uploads", { method: "POST", body });
	const payload = (await response.json().catch(() => ({}))) as {
		id?: string;
		files?: { name: string; stored: string }[];
		error?: string;
	};
	if (!response.ok || !payload.id || !payload.files) {
		return { files: next, error: payload.error || "Could not save the files inside the app." };
	}
	payload.files.forEach((file, index) => {
		next.push({
			name: file.name,
			size: toUpload[index]?.size ?? 0,
			batchId: payload.id!,
			stored: file.stored,
		});
	});
	return { files: next, error: null };
}

export async function uploadLessonSources(chatId: string, all: readonly AttachedSource[]): Promise<string[]> {
	// @-mentioned project files ride their own route (attachProjectFiles).
	const files = all.filter((f) => !f.project);
	if (files.length === 0) return [];
	const response = await fetch(`/api/chats/${chatId}/sources`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			claim: files.map((file) => ({ batchId: file.batchId, stored: file.stored, ...(file.scope ? { scope: file.scope } : {}) })),
		}),
	});
	const payload = (await response.json().catch(() => ({}))) as { paths?: string[]; notes?: (string | null)[]; error?: string };
	if (!response.ok || !payload.paths) throw new Error(payload.error || "Could not save the sources.");
	// A limited file's line carries its note (the agent reads the limit).
	return payload.paths.map((p, i) => (payload.notes?.[i] ? `${p} — ${payload.notes[i]}` : p));
}

/** Apply the active (or named) project pack into the session, then attach extra files. */
export async function openingWithSources(
	chatId: string,
	text: string,
	files: readonly AttachedSource[],
	options: { useActiveProject?: boolean; projectId?: string } = { useActiveProject: true },
): Promise<string> {
	const paths: string[] = [];
	let instructions = "";
	// @-mentioned project files (owner 2026-10-26): the session starts with
	// ONLY those (plus the instructions) instead of the whole project.
	const mentioned = files.filter((f) => f.project);
	if (mentioned.length > 0) {
		const picked = await attachProjectFiles(chatId, mentioned);
		paths.push(...picked.paths);
		instructions = picked.instructions;
	} else if (options.projectId || options.useActiveProject) {
		const response = await fetch(`/api/chats/${chatId}/project`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(options.projectId ? { projectId: options.projectId } : {}),
		});
		if (response.ok) {
			const payload = (await response.json()) as { paths?: string[]; instructions?: string };
			paths.push(...(payload.paths ?? []));
			instructions = payload.instructions ?? "";
		} else if (response.status !== 404 || options.projectId) {
			const payload = (await response.json().catch(() => ({}))) as { error?: string };
			throw new Error(payload.error || "Could not load the project.");
		}
	}
	if (files.length > 0) paths.push(...await uploadLessonSources(chatId, files));
	const opening = appendProjectContext(text, instructions, paths);
	if (!opening) throw new Error("Add a topic, attach files, or choose a project.");
	return opening;
}

/** @deprecated Prefer stagePickedFiles — kept for tests that only validate counts. */
export function takeSourceFiles(current: readonly AttachedSource[], incoming: FileList | null): { files: AttachedSource[]; error: string | null } {
	if (!incoming || incoming.length === 0) return { files: [...current], error: null };
	const next = [...current];
	for (const file of incoming) {
		const reason = lessonSourceError(file.name, file.size, next.length);
		if (reason) return { files: next, error: reason };
		next.push({ name: file.name, size: file.size, batchId: "pending", stored: file.name });
	}
	return { files: next, error: null };
}

function SourceChips({
	files,
	onChange,
	error,
}: {
	files: readonly AttachedSource[];
	onChange: (files: AttachedSource[]) => void;
	error?: string | null;
}) {
	const [picking, setPicking] = useState<string | null>(null);
	if (files.length === 0 && !error) return null;
	return (
		<div className="flex flex-col gap-1 px-1.5 pb-1">
			{files.length > 0 && (
				<div className="flex flex-wrap items-center gap-1.5">
					{files.map((file) => {
						const key = `${file.batchId}:${file.stored}`;
						const scopable = scopeKindFor(file.name) !== null;
						return (
						<span key={key} className="relative flex max-w-64 items-center gap-1 rounded-sm border border-border bg-background px-1.5 py-0.5 text-xs text-foreground">
							{/* Click to browse & limit pages / slides / sections (owner 2026-10-26). */}
							<button
								type="button"
								data-testid="source-chip"
								disabled={!scopable}
								title={scopable ? "Browse and pick pages, slides, or sections" : undefined}
								onClick={() => setPicking(picking === key ? null : key)}
								className={cn("flex min-w-0 items-center gap-1", scopable && "cursor-pointer hover:text-primary")}
							>
								{file.project && <FolderIcon className="size-3 shrink-0 text-muted-foreground" aria-label="Project file" />}
								<span className="truncate">{file.name}</span>
								{file.scope ? (
									<span className="shrink-0 rounded-sm bg-accent px-1 text-[10px] text-muted-foreground">{scopeChipLabel(file.scope)}</span>
								) : scopable ? (
									<span className="shrink-0 text-[10px] text-muted-foreground">all</span>
								) : null}
							</button>
							{picking === key && (
								<SourceScopePicker
									outlineUrl={outlineUrlFor(file)}
									previewUrl={previewUrlFor(file)}
									fileName={file.name}
									scope={file.scope}
									onChange={(scope) =>
										onChange(files.map((f) => (f.batchId === file.batchId && f.stored === file.stored ? { ...f, scope } : f)))
									}
									onClose={() => setPicking(null)}
								/>
							)}
							<button
								type="button"
								aria-label={`Remove ${file.name}`}
								className="text-muted-foreground hover:text-foreground"
								onClick={() => onChange(files.filter((f) => !(f.batchId === file.batchId && f.stored === file.stored)))}
							>
								<XIcon className="size-3" />
							</button>
						</span>
						);
					})}
				</div>
			)}
			{error && <p role="alert" className="text-xs text-red-400">{error}</p>}
		</div>
	);
}

/** Paperclip + hidden file input for the SAME row as the textarea and send button. */
export function SourceAttachButton({
	files,
	disabled,
	onChange,
	onError,
	onImages,
}: {
	files: readonly AttachedSource[];
	disabled?: boolean;
	onChange: (files: AttachedSource[]) => void;
	onError: (error: string | null) => void;
	/** In a live session (owner 2026-10-26): picked images go to the model
	 *  as pictures with the message; everything else stays a lesson source. */
	onImages?: (files: File[]) => void;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	return (
		<>
			<button
				type="button"
				aria-label="Attach sources"
				data-testid="attach-sources"
				disabled={disabled}
				onClick={() => inputRef.current?.click()}
				className="flex size-10 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
			>
				<PaperclipIcon className="size-4" />
			</button>
			<input
				ref={inputRef}
				type="file"
				multiple
				accept={LESSON_SOURCE_ACCEPT}
				data-testid="attach-sources-input"
				className="sr-only"
				tabIndex={-1}
				onChange={(event) => {
					const all = Array.from(event.target.files ?? []);
					event.target.value = "";
					const images = onImages ? all.filter(isImageFile) : [];
					if (images.length > 0) onImages!(images);
					const rest = all.filter((file) => !images.includes(file));
					if (rest.length === 0) return;
					const list = new DataTransfer();
					for (const file of rest) list.items.add(file);
					void stagePickedFiles(files, list.files).then((picked) => {
						onChange(picked.files);
						onError(picked.error);
					});
				}}
			/>
		</>
	);
}

/** Chips above + paperclip for the text row. Use `row` around the paperclip. */
export function SourcePicker({
	files,
	disabled,
	error,
	onChange,
	onError,
	row,
	onImages,
}: {
	files: readonly AttachedSource[];
	disabled?: boolean;
	error?: string | null;
	onChange: (files: AttachedSource[]) => void;
	onError: (error: string | null) => void;
	/** Images route (see SourceAttachButton). */
	onImages?: (files: File[]) => void;
	/** When set, only the paperclip is returned so the parent can place it in the text row. */
	row?: (attach: ReactNode) => ReactNode;
}) {
	const attach = (
		<SourceAttachButton files={files} disabled={disabled} onChange={onChange} onError={onError} onImages={onImages} />
	);
	return (
		<>
			<SourceChips files={files} onChange={onChange} error={error} />
			{row ? row(attach) : attach}
		</>
	);
}
