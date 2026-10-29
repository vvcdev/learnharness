"use client";

import { useRef, useState, type ReactNode } from "react";
import { BookOpenIcon, FolderIcon, LinkIcon, PaperclipIcon, XIcon } from "lucide-react";
import { appendProjectContext, documentKindFor, isOversizePdf, LESSON_SOURCE_ACCEPT, lessonSourceError, scopeChipLabel, scopeKindFor, type SourceScope } from "@/src/core";
import { SourceScopePicker } from "@/components/source-scope-picker";
import { PdfSplitter } from "@/components/pdf-splitter";
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
	incoming: FileList | readonly File[] | null,
	/** How many files already live on the project/session besides `current`. */
	already = 0,
): Promise<{ files: AttachedSource[]; error: string | null }> {
	if (!incoming || incoming.length === 0) return { files: [...current], error: null };
	const next = [...current];
	const toUpload: File[] = [];
	for (const file of Array.from(incoming)) {
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

/** Add a YouTube video as a source: the server stages its transcript as a
 *  markdown file, which then rides every path a picked file does. */
export async function stageYoutube(
	current: readonly AttachedSource[],
	url: string,
	/** How many files already live on the project/session besides `current`. */
	already = 0,
): Promise<{ files: AttachedSource[]; error: string | null }> {
	const next = [...current];
	const reason = lessonSourceError("video.md", 1, already + next.length);
	if (reason) return { files: next, error: reason };
	const response = await fetch("/api/uploads/youtube", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ url }),
	}).catch(() => null);
	if (!response) return { files: next, error: "Could not reach the app. Try again." };
	const payload = (await response.json().catch(() => ({}))) as {
		id?: string;
		files?: { name: string; stored: string }[];
		size?: number;
		error?: string;
	};
	const file = payload.files?.[0];
	if (!response.ok || !payload.id || !file) return { files: next, error: payload.error || "Could not read that video." };
	next.push({ name: file.name, size: payload.size ?? 0, batchId: payload.id, stored: file.stored });
	return { files: next, error: null };
}

/** A link button + URL field that stages a YouTube transcript. `children`
 *  renders the trigger (so the composer and the projects page can style it). */
export function YoutubeLinkForm({
	onSubmit,
	onClose,
	className,
}: {
	onSubmit: (url: string) => Promise<string | null>;
	onClose: () => void;
	className?: string;
}) {
	const [url, setUrl] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	return (
		<form
			data-testid="youtube-form"
			className={cn("flex flex-col gap-1", className)}
			onSubmit={(event) => {
				event.preventDefault();
				if (!url.trim() || busy) return;
				setBusy(true);
				setError(null);
				void onSubmit(url.trim()).then((failure) => {
					setBusy(false);
					if (failure) setError(failure);
					else onClose();
				});
			}}
		>
			<div className="flex items-center gap-1.5">
				<input
					autoFocus
					value={url}
					onChange={(event) => setUrl(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Escape") onClose();
					}}
					placeholder="Paste a YouTube link"
					aria-label="YouTube link"
					className="lh-input min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-xs outline-none focus:border-ring"
				/>
				<button type="submit" disabled={busy || !url.trim()} className="rounded-md border px-2 py-1 text-xs hover:bg-accent disabled:opacity-40">
					{busy ? "Reading…" : "Add"}
				</button>
				<button type="button" aria-label="Cancel" onClick={onClose} className="text-muted-foreground hover:text-foreground">
					<XIcon className="size-3" />
				</button>
			</div>
			{error && <p role="alert" className="text-xs text-red-400">{error}</p>}
		</form>
	);
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
	onOpen,
	error,
}: {
	files: readonly AttachedSource[];
	onChange: (files: AttachedSource[]) => void;
	/** Open a staged file in the document viewer. */
	onOpen?: (file: AttachedSource) => void;
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
							{onOpen && !file.project && file.batchId !== "pending" && documentKindFor(file.name) !== null && (
								<button
									type="button"
									data-testid="source-chip-read"
									aria-label={`Read ${file.name}`}
									title="Read it here and highlight passages to explain"
									className="cursor-pointer text-muted-foreground hover:text-foreground"
									onClick={() => onOpen(file)}
								>
									<BookOpenIcon className="size-3" />
								</button>
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
	onLinkToggle,
	onSplit,
}: {
	files: readonly AttachedSource[];
	disabled?: boolean;
	onChange: (files: AttachedSource[]) => void;
	onError: (error: string | null) => void;
	/** Opens / closes the YouTube link field (SourcePicker owns it). */
	onLinkToggle?: () => void;
	/** An oversized PDF was picked: open the manual splitter on it. */
	onSplit?: (file: File) => void;
	/** In a live session (owner 2026-10-26): picked images go to the model
	 *  as pictures with the message; everything else stays a lesson source. */
	onImages?: (files: File[]) => void;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	return (
		<>
			<button
				type="button"
				aria-label="Add a YouTube link"
				data-testid="attach-youtube"
				disabled={disabled}
				onClick={onLinkToggle}
				className="flex size-10 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
			>
				<LinkIcon className="size-4" />
			</button>
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
					let rest = all.filter((file) => !images.includes(file));
					// An oversized PDF opens the splitter instead of the size error
					// (one at a time; the rest stage as usual).
					const big = onSplit ? rest.find((f) => isOversizePdf(f.name, f.size)) : undefined;
					if (big) {
						onSplit!(big);
						rest = rest.filter((f) => f !== big);
					}
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
	onOpen,
}: {
	files: readonly AttachedSource[];
	disabled?: boolean;
	error?: string | null;
	/** Open a staged file in the document viewer (chat only). */
	onOpen?: (file: AttachedSource) => void;
	onChange: (files: AttachedSource[]) => void;
	onError: (error: string | null) => void;
	/** Images route (see SourceAttachButton). */
	onImages?: (files: File[]) => void;
	/** When set, only the paperclip is returned so the parent can place it in the text row. */
	row?: (attach: ReactNode) => ReactNode;
}) {
	const [linking, setLinking] = useState(false);
	const [splitting, setSplitting] = useState<File | null>(null);
	const attach = (
		<SourceAttachButton
			files={files}
			disabled={disabled}
			onChange={onChange}
			onError={onError}
			onImages={onImages}
			onLinkToggle={() => setLinking((open) => !open)}
			onSplit={setSplitting}
		/>
	);
	return (
		<>
			{splitting && (
				<PdfSplitter
					file={splitting}
					onCancel={() => setSplitting(null)}
					onDone={(parts) => {
						setSplitting(null);
						void stagePickedFiles(files, parts).then((picked) => {
							onChange(picked.files);
							onError(picked.error);
						});
					}}
				/>
			)}
			{linking && (
				<div className="px-1.5 pb-1">
					<YoutubeLinkForm
						onClose={() => setLinking(false)}
						onSubmit={async (url) => {
							const picked = await stageYoutube(files, url);
							onChange(picked.files);
							onError(picked.error);
							return picked.error;
						}}
					/>
				</div>
			)}
			<SourceChips files={files} onChange={onChange} onOpen={onOpen} error={error} />
			{row ? row(attach) : attach}
		</>
	);
}
