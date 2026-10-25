"use client";

import { useRef, type ReactNode } from "react";
import { PaperclipIcon, XIcon } from "lucide-react";
import { appendProjectContext, LESSON_SOURCE_ACCEPT, lessonSourceError } from "@/src/core";

export async function uploadLessonSources(chatId: string, files: readonly File[]): Promise<string[]> {
	const body = new FormData();
	for (const file of files) body.append("file", file);
	const response = await fetch(`/api/chats/${chatId}/sources`, { method: "POST", body });
	const payload = (await response.json().catch(() => ({}))) as { paths?: string[]; error?: string };
	if (!response.ok || !payload.paths) throw new Error(payload.error || "Could not save the sources.");
	return payload.paths;
}

/** Apply the active (or named) project pack into the session, then attach extra files. */
export async function openingWithSources(
	chatId: string,
	text: string,
	files: readonly File[],
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

export function takeSourceFiles(current: readonly File[], incoming: FileList | null): { files: File[]; error: string | null } {
	if (!incoming || incoming.length === 0) return { files: [...current], error: null };
	const next = [...current];
	for (const file of incoming) {
		const reason = lessonSourceError(file.name, file.size, next.length);
		if (reason) return { files: next, error: reason };
		next.push(file);
	}
	return { files: next, error: null };
}

function SourceChips({
	files,
	onChange,
	error,
}: {
	files: readonly File[];
	onChange: (files: File[]) => void;
	error?: string | null;
}) {
	if (files.length === 0 && !error) return null;
	return (
		<div className="flex flex-col gap-1 px-1.5 pb-1">
			{files.length > 0 && (
				<div className="flex flex-wrap items-center gap-1.5">
					{files.map((file, index) => (
						<span key={`${file.name}-${index}`} className="flex max-w-48 items-center gap-1 rounded-sm border border-border bg-background px-1.5 py-0.5 text-xs text-foreground">
							<span className="truncate">{file.name}</span>
							<button
								type="button"
								aria-label={`Remove ${file.name}`}
								className="text-muted-foreground hover:text-foreground"
								onClick={() => onChange(files.filter((_, i) => i !== index))}
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
}: {
	files: readonly File[];
	disabled?: boolean;
	onChange: (files: File[]) => void;
	onError: (error: string | null) => void;
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
					const picked = takeSourceFiles(files, event.target.files);
					onChange(picked.files);
					onError(picked.error);
					event.target.value = "";
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
}: {
	files: readonly File[];
	disabled?: boolean;
	error?: string | null;
	onChange: (files: File[]) => void;
	onError: (error: string | null) => void;
	/** When set, only the paperclip is returned so the parent can place it in the text row. */
	row?: (attach: ReactNode) => ReactNode;
}) {
	const attach = (
		<SourceAttachButton files={files} disabled={disabled} onChange={onChange} onError={onError} />
	);
	return (
		<>
			<SourceChips files={files} onChange={onChange} error={error} />
			{row ? row(attach) : attach}
		</>
	);
}
