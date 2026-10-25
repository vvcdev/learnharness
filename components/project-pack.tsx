"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckIcon, FolderPlusIcon, PencilIcon, PlusIcon, TrashIcon, XIcon } from "lucide-react";
import {
	LESSON_SOURCE_ACCEPT,
	lessonSourceError,
	type ProjectDetail,
	type ProjectSummary,
	projectInstructionsError,
	projectNameError,
} from "@/src/core";

async function loadProjects(): Promise<{ activeId: string | null; projects: ProjectSummary[] }> {
	const res = await fetch("/api/projects", { cache: "no-store" });
	if (!res.ok) return { activeId: null, projects: [] };
	return (await res.json()) as { activeId: string | null; projects: ProjectSummary[] };
}

/** + Project control for the home stats row: pick/create/edit saved packs. */
export function ProjectPackControl({
	onActiveChange,
}: {
	/** Fires whenever the active pack changes (including clear). */
	onActiveChange?: (active: ProjectSummary | null) => void;
}) {
	const [projects, setProjects] = useState<ProjectSummary[]>([]);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [menuOpen, setMenuOpen] = useState(false);
	const [editor, setEditor] = useState<"create" | ProjectDetail | null>(null);
	const rootRef = useRef<HTMLDivElement>(null);

	const refresh = useCallback(async () => {
		const next = await loadProjects();
		setProjects(next.projects);
		setActiveId(next.activeId);
		onActiveChange?.(next.projects.find((p) => p.id === next.activeId) ?? null);
	}, [onActiveChange]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	useEffect(() => {
		if (!menuOpen) return;
		const onPointerDown = (e: PointerEvent) => {
			if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenuOpen(false);
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				setMenuOpen(false);
			}
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [menuOpen]);

	const active = projects.find((p) => p.id === activeId) ?? null;

	const activate = async (id: string | null) => {
		const res = await fetch("/api/projects/active", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ id }),
		});
		if (!res.ok) return;
		setMenuOpen(false);
		await refresh();
	};

	const openEdit = async (id: string) => {
		const res = await fetch(`/api/projects/${id}`);
		if (!res.ok) return;
		setMenuOpen(false);
		setEditor((await res.json()) as ProjectDetail);
	};

	const remove = async (id: string) => {
		const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
		if (!res.ok) return;
		setMenuOpen(false);
		await refresh();
	};

	return (
		<div ref={rootRef} className="relative" data-testid="project-pack-control">
			<button
				type="button"
				data-testid="project-pack-button"
				onClick={() => setMenuOpen((v) => !v)}
				className={
					"flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-2 py-0.5 text-[11px] transition-colors hover:bg-accent " +
					(active ? "text-foreground" : "text-muted-foreground")
				}
			>
				{active ? (
					<>
						<span className="max-w-[10rem] truncate">{active.name}</span>
						<span
							role="button"
							tabIndex={0}
							aria-label="Clear project"
							data-testid="project-pack-clear"
							className="rounded p-0.5 hover:bg-accent"
							onClick={(e) => {
								e.stopPropagation();
								void activate(null);
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									e.stopPropagation();
									void activate(null);
								}
							}}
						>
							<XIcon className="size-3" />
						</span>
					</>
				) : (
					<>
						<PlusIcon className="size-3" />
						Project
					</>
				)}
			</button>

			{menuOpen && (
				<div className="absolute bottom-full left-0 z-40 mb-1.5 w-64 overflow-hidden rounded-xl border bg-card shadow-lg">
					<div className="max-h-56 overflow-y-auto py-1">
						{projects.length === 0 && (
							<p className="px-3 py-2 text-xs text-muted-foreground">No saved projects yet.</p>
						)}
						{projects.map((project) => (
							<div key={project.id} className="flex items-center gap-0.5 px-1">
								<button
									type="button"
									data-testid={`project-pick-${project.id}`}
									onClick={() => void activate(project.id)}
									className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-accent"
								>
									<span className="w-3 shrink-0">
										{project.id === activeId ? <CheckIcon className="size-3" /> : null}
									</span>
									<span className="min-w-0 flex-1 truncate text-foreground">{project.name}</span>
									<span className="shrink-0 text-muted-foreground">{project.fileCount}</span>
								</button>
								<button
									type="button"
									aria-label={`Edit ${project.name}`}
									onClick={() => void openEdit(project.id)}
									className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
								>
									<PencilIcon className="size-3" />
								</button>
								<button
									type="button"
									aria-label={`Delete ${project.name}`}
									onClick={() => void remove(project.id)}
									className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
								>
									<TrashIcon className="size-3" />
								</button>
							</div>
						))}
					</div>
					<div className="border-t p-1">
						<button
							type="button"
							data-testid="project-pack-new"
							onClick={() => {
								setMenuOpen(false);
								setEditor("create");
							}}
							className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-foreground hover:bg-accent"
						>
							<FolderPlusIcon className="size-3.5" />
							New project
						</button>
					</div>
				</div>
			)}

			{editor && (
				<ProjectPackEditor
					initial={editor === "create" ? null : editor}
					onClose={() => setEditor(null)}
					onSaved={async () => {
						setEditor(null);
						await refresh();
					}}
				/>
			)}
		</div>
	);
}

function ProjectPackEditor({
	initial,
	onClose,
	onSaved,
}: {
	initial: ProjectDetail | null;
	onClose: () => void;
	onSaved: () => void | Promise<void>;
}) {
	const [name, setName] = useState(initial?.name ?? "");
	const [instructions, setInstructions] = useState(initial?.instructions ?? "");
	const [existing, setExisting] = useState(initial?.files ?? []);
	const [incoming, setIncoming] = useState<File[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const save = async () => {
		const nameErr = projectNameError(name);
		if (nameErr) {
			setError(nameErr);
			return;
		}
		const instrErr = projectInstructionsError(instructions);
		if (instrErr) {
			setError(instrErr);
			return;
		}
		setBusy(true);
		setError(null);
		try {
			if (!initial) {
				const body = new FormData();
				body.set("name", name.trim());
				body.set("instructions", instructions);
				for (const file of incoming) body.append("file", file);
				const res = await fetch("/api/projects", { method: "POST", body });
				const payload = (await res.json().catch(() => ({}))) as { error?: string };
				if (!res.ok) throw new Error(payload.error || "Could not save the project.");
			} else {
				const metaRes = await fetch(`/api/projects/${initial.id}`, {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ name: name.trim(), instructions }),
				});
				const metaPayload = (await metaRes.json().catch(() => ({}))) as { error?: string };
				if (!metaRes.ok) throw new Error(metaPayload.error || "Could not save the project.");
				if (incoming.length > 0) {
					const body = new FormData();
					for (const file of incoming) body.append("file", file);
					const filesRes = await fetch(`/api/projects/${initial.id}/files`, { method: "POST", body });
					const filesPayload = (await filesRes.json().catch(() => ({}))) as { error?: string };
					if (!filesRes.ok) throw new Error(filesPayload.error || "Could not add files.");
				}
			}
			await onSaved();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not save the project.");
			setBusy(false);
		}
	};

	const removeExisting = async (stored: string) => {
		if (!initial) return;
		const res = await fetch(`/api/projects/${initial.id}/files/${encodeURIComponent(stored)}`, { method: "DELETE" });
		if (!res.ok) {
			const payload = (await res.json().catch(() => ({}))) as { error?: string };
			setError(payload.error || "Could not remove the file.");
			return;
		}
		const project = (await res.json()) as ProjectDetail;
		setExisting(project.files);
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" data-testid="project-pack-editor">
			<div className="flex w-full max-w-md flex-col gap-3 rounded-2xl border bg-card p-4 shadow-xl">
				<div className="flex items-center justify-between gap-2">
					<h2 className="font-ui text-sm font-medium text-foreground">
						{initial ? "Edit project" : "New project"}
					</h2>
					<button type="button" aria-label="Close" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
						<XIcon className="size-4" />
					</button>
				</div>
				<label className="flex flex-col gap-1">
					<span className="text-[11px] uppercase tracking-wider text-muted-foreground">Name</span>
					<input
						value={name}
						onChange={(e) => setName(e.target.value)}
						autoFocus
						className="lh-input rounded-lg border bg-background px-2.5 py-2 text-sm outline-none focus:border-ring"
						placeholder="AP Calculus notes"
					/>
				</label>
				<label className="flex flex-col gap-1">
					<span className="text-[11px] uppercase tracking-wider text-muted-foreground">Instructions</span>
					<textarea
						value={instructions}
						onChange={(e) => setInstructions(e.target.value)}
						rows={4}
						className="lh-input resize-none rounded-lg border bg-background px-2.5 py-2 text-sm outline-none focus:border-ring"
						placeholder="Standing context for every lesson that uses this pack…"
					/>
				</label>
				<div className="flex flex-col gap-1.5">
					<div className="flex items-center justify-between">
						<span className="text-[11px] uppercase tracking-wider text-muted-foreground">Files</span>
						<button
							type="button"
							onClick={() => fileInputRef.current?.click()}
							className="text-xs text-muted-foreground hover:text-foreground"
						>
							Add files
						</button>
						<input
							ref={fileInputRef}
							type="file"
							multiple
							accept={LESSON_SOURCE_ACCEPT}
							className="sr-only"
							tabIndex={-1}
							onChange={(e) => {
								const list = e.target.files;
								if (!list) return;
								const next = [...incoming];
								for (const file of list) {
									const reason = lessonSourceError(file.name, file.size, existing.length + next.length);
									if (reason) {
										setError(reason);
										break;
									}
									next.push(file);
									setError(null);
								}
								setIncoming(next);
								e.target.value = "";
							}}
						/>
					</div>
					{(existing.length > 0 || incoming.length > 0) && (
						<div className="flex flex-wrap gap-1.5">
							{existing.map((file) => (
								<span key={file.stored} className="flex max-w-40 items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs">
									<span className="truncate">{file.name}</span>
									<button type="button" aria-label={`Remove ${file.name}`} onClick={() => void removeExisting(file.stored)} className="text-muted-foreground hover:text-foreground">
										<XIcon className="size-3" />
									</button>
								</span>
							))}
							{incoming.map((file, index) => (
								<span key={`${file.name}-${index}`} className="flex max-w-40 items-center gap-1 rounded-sm border border-dashed px-1.5 py-0.5 text-xs">
									<span className="truncate">{file.name}</span>
									<button
										type="button"
										aria-label={`Remove ${file.name}`}
										onClick={() => setIncoming(incoming.filter((_, i) => i !== index))}
										className="text-muted-foreground hover:text-foreground"
									>
										<XIcon className="size-3" />
									</button>
								</span>
							))}
						</div>
					)}
				</div>
				{error && <p role="alert" className="text-xs text-red-400">{error}</p>}
				<div className="flex justify-end gap-2 pt-1">
					<button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
						Cancel
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={() => void save()}
						data-testid="project-pack-save"
						className="rounded-lg bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-40"
					>
						{busy ? "Saving…" : "Save"}
					</button>
				</div>
			</div>
		</div>
	);
}
