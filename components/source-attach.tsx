"use client";

import { useRef, type ReactNode } from "react";
import { PaperclipIcon, XIcon } from "lucide-react";
import { appendProjectContext, LESSON_SOURCE_ACCEPT, lessonSourceError } from "@/src/core";
import { isImageFile } from "@/components/learner-images";

/** A picked file already copied into the app's uploads folder. */
export type AttachedSource = {
	name: string;
	size: number;
	batchId: string;
	stored: string;
};

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

export async function uploadLessonSources(chatId: string, files: readonly AttachedSource[]): Promise<string[]> {
	const response = await fetch(`/api/chats/${chatId}/sources`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			claim: files.map((file) => ({ batchId: file.batchId, stored: file.stored })),
		}),
	});
	const payload = (await response.json().catch(() => ({}))) as { paths?: string[]; error?: string };
	if (!response.ok || !payload.paths) throw new Error(payload.error || "Could not save the sources.");
	return payload.paths;
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
	if (options.projectId || options.useActiveProject) {
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
	if (files.length === 0 && !error) return null;
	return (
		<div className="flex flex-col gap-1 px-1.5 pb-1">
			{files.length > 0 && (
				<div className="flex flex-wrap items-center gap-1.5">
					{files.map((file) => (
						<span key={`${file.batchId}:${file.stored}`} className="flex max-w-48 items-center gap-1 rounded-sm border border-border bg-background px-1.5 py-0.5 text-xs text-foreground">
							<span className="truncate">{file.name}</span>
							<button
								type="button"
								aria-label={`Remove ${file.name}`}
								className="text-muted-foreground hover:text-foreground"
								onClick={() => onChange(files.filter((f) => !(f.batchId === file.batchId && f.stored === file.stored)))}
							>
								<XIcon className="size-3" />
							</button>
						</span>
					))}
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
