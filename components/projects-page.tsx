"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckIcon, FolderPlusIcon, TrashIcon } from "lucide-react";
import {
	isOversizePdf,
	LESSON_SOURCE_ACCEPT,
	type ProjectDetail,
	type ProjectSummary,
	projectInstructionsError,
	projectNameError,
} from "@/src/core";
import { SidebarToggle } from "@/components/sidebar";
import { stagePickedFiles, stageYoutube, YoutubeLinkForm, type AttachedSource } from "@/components/source-attach";
import { PdfSplitter } from "@/components/pdf-splitter";

async function loadList(): Promise<{ activeId: string | null; projects: ProjectSummary[] }> {
	const res = await fetch("/api/projects", { cache: "no-store" });
	if (!res.ok) return { activeId: null, projects: [] };
	return (await res.json()) as { activeId: string | null; projects: ProjectSummary[] };
}

/** Full-page project pack manager — list + roomy editor. */
export function ProjectsPage() {
	const [projects, setProjects] = useState<ProjectSummary[]>([]);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [selectedId, setSelectedId] = useState<string | "new" | null>(null);
	const [detail, setDetail] = useState<ProjectDetail | null>(null);
	const [loadingDetail, setLoadingDetail] = useState(false);

	const refresh = useCallback(async () => {
		const next = await loadList();
		setProjects(next.projects);
		setActiveId(next.activeId);
		return next;
	}, []);

	useEffect(() => {
		void refresh().then((next) => {
			setSelectedId((cur) => {
				if (cur === "new") return cur;
				if (cur && next.projects.some((p) => p.id === cur)) return cur;
				// Empty list → open the create form so the page is never a blank wall.
				if (next.projects.length === 0) return "new";
				return next.activeId ?? next.projects[0]?.id ?? null;
			});
		});
	}, [refresh]);

	useEffect(() => {
		if (!selectedId || selectedId === "new") {
			setDetail(null);
			return;
		}
		let cancelled = false;
		setLoadingDetail(true);
		void fetch(`/api/projects/${selectedId}`)
			.then(async (res) => {
				if (!res.ok) return null;
				return (await res.json()) as ProjectDetail;
			})
			.then((project) => {
				if (!cancelled) setDetail(project);
			})
			.finally(() => {
				if (!cancelled) setLoadingDetail(false);
			});
		return () => {
			cancelled = true;
		};
	}, [selectedId]);

	const activate = async (id: string | null) => {
		const res = await fetch("/api/projects/active", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ id }),
		});
		if (!res.ok) return;
		await refresh();
	};

	const remove = async (id: string) => {
		const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
		if (!res.ok) return;
		const next = await refresh();
		setSelectedId(next.activeId ?? next.projects[0]?.id ?? null);
	};

	return (
		<div className="relative flex h-dvh flex-col" data-testid="projects-page">
			<div className="lh-drag absolute inset-x-0 top-0 h-13" aria-hidden="true" />
			<header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center gap-2 px-3 py-2">
				<div className="pointer-events-auto">
					<SidebarToggle />
				</div>
			</header>

			<div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-4 px-4 pb-8 pt-14 sm:px-6">
				<div className="flex items-end justify-between gap-3">
					<div>
						<h1 className="font-title text-2xl tracking-tight text-foreground">Projects</h1>
						<p className="mt-1 text-sm text-muted-foreground">
							Saved packs of files and standing instructions for new lessons.
						</p>
					</div>
					<button
						type="button"
						data-testid="projects-new"
						onClick={() => setSelectedId("new")}
						className="flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-accent"
					>
						<FolderPlusIcon className="size-3.5" />
						New project
					</button>
				</div>

				<div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[16rem_minmax(0,1fr)]">
					<aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl border bg-card">
						<div className="border-b px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground">
							Your packs
						</div>
						<div className="min-h-0 flex-1 overflow-y-auto p-1">
							{projects.length === 0 && selectedId !== "new" && (
								<button
									type="button"
									onClick={() => setSelectedId("new")}
									className="w-full rounded-xl px-2.5 py-3 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
								>
									No projects yet — create one
								</button>
							)}
							{projects.map((project) => {
								const selected = selectedId === project.id;
								const active = activeId === project.id;
								return (
									<button
										key={project.id}
										type="button"
										data-testid={`projects-row-${project.id}`}
										onClick={() => setSelectedId(project.id)}
										className={
											"flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm transition-colors " +
											(selected ? "bg-accent text-foreground" : "text-foreground hover:bg-accent/60")
										}
									>
										<span className="w-3 shrink-0">
											{active ? <CheckIcon className="size-3" /> : null}
										</span>
										<span className="min-w-0 flex-1 truncate">{project.name}</span>
										<span className="shrink-0 text-[11px] text-muted-foreground">{project.fileCount}</span>
									</button>
								);
							})}
							{selectedId === "new" && (
								<div className="rounded-xl bg-accent px-2.5 py-2 text-sm text-foreground">New project</div>
							)}
						</div>
					</aside>

					<section className="min-h-0 overflow-y-auto rounded-2xl border bg-card p-4 sm:p-5">
						{selectedId === null && (
							<p className="text-sm text-muted-foreground">Create a project to get started.</p>
						)}
						{selectedId === "new" && (
							<ProjectPackForm
								key="new"
								initial={null}
								onSaved={async (project) => {
									await refresh();
									setSelectedId(project.id);
								}}
								onCancel={() => setSelectedId(projects[0]?.id ?? null)}
							/>
						)}
						{selectedId && selectedId !== "new" && loadingDetail && (
							<p className="text-sm text-muted-foreground">Loading…</p>
						)}
						{selectedId && selectedId !== "new" && detail && detail.id === selectedId && (
							<div className="flex flex-col gap-4">
								<div className="flex flex-wrap items-center gap-2">
									<button
										type="button"
										onClick={() => void activate(activeId === detail.id ? null : detail.id)}
										className="rounded-lg border px-3 py-1.5 text-xs transition-colors hover:bg-accent"
									>
										{activeId === detail.id ? "Clear active" : "Use for new lessons"}
									</button>
									<button
										type="button"
										onClick={() => void remove(detail.id)}
										className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
									>
										<TrashIcon className="size-3" />
										Delete
									</button>
								</div>
								<ProjectPackForm
									key={detail.id}
									initial={detail}
									onSaved={async (project) => {
										await refresh();
										setDetail(project);
									}}
								/>
							</div>
						)}
					</section>
				</div>
			</div>
		</div>
	);
}

export function ProjectPackForm({
	initial,
	onSaved,
	onCancel,
}: {
	initial: ProjectDetail | null;
	onSaved: (project: ProjectDetail) => void | Promise<void>;
	onCancel?: () => void;
}) {
	const [name, setName] = useState(initial?.name ?? "");
	const [instructions, setInstructions] = useState(initial?.instructions ?? "");
	const [existing, setExisting] = useState(initial?.files ?? []);
	const [incoming, setIncoming] = useState<AttachedSource[]>([]);
	const [linking, setLinking] = useState(false);
	/** The PDF open in the manual splitter (an oversized pick, or Split a PDF…). */
	const [splitting, setSplitting] = useState<File | null>(null);
	const splitInputRef = useRef<HTMLInputElement>(null);
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
		const claim = incoming.map((file) => ({ batchId: file.batchId, stored: file.stored }));
		try {
			if (!initial) {
				const res = await fetch("/api/projects", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ name: name.trim(), instructions, claim }),
				});
				const payload = (await res.json().catch(() => ({}))) as ProjectDetail & { error?: string };
				if (!res.ok) throw new Error(payload.error || "Could not save the project.");
				await onSaved(payload);
			} else {
				const metaRes = await fetch(`/api/projects/${initial.id}`, {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ name: name.trim(), instructions }),
				});
				let project = (await metaRes.json().catch(() => ({}))) as ProjectDetail & { error?: string };
				if (!metaRes.ok) throw new Error(project.error || "Could not save the project.");
				if (claim.length > 0) {
					const filesRes = await fetch(`/api/projects/${initial.id}/files`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ claim }),
					});
					project = (await filesRes.json().catch(() => ({}))) as ProjectDetail & { error?: string };
					if (!filesRes.ok) throw new Error(project.error || "Could not add files.");
				}
				setIncoming([]);
				setExisting(project.files);
				await onSaved(project);
				setBusy(false);
			}
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
		<div className="flex flex-col gap-4" data-testid="project-pack-form">
			<label className="flex flex-col gap-1.5">
				<span className="text-[11px] uppercase tracking-wider text-muted-foreground">Name</span>
				<input
					value={name}
					onChange={(e) => setName(e.target.value)}
					autoFocus
					className="lh-input rounded-lg border bg-background px-3 py-2.5 text-sm outline-none focus:border-ring"
					placeholder="AP Calculus notes"
				/>
			</label>
			<label className="flex flex-col gap-1.5">
				<span className="text-[11px] uppercase tracking-wider text-muted-foreground">Instructions</span>
				<textarea
					value={instructions}
					onChange={(e) => setInstructions(e.target.value)}
					rows={10}
					className="lh-input min-h-40 resize-y rounded-lg border bg-background px-3 py-2.5 text-sm outline-none focus:border-ring"
					placeholder="Standing context for every lesson that uses this pack…"
				/>
			</label>
			<div className="flex flex-col gap-2">
				<div className="flex items-center justify-between">
					<span className="text-[11px] uppercase tracking-wider text-muted-foreground">Files</span>
					<button
						type="button"
						onClick={() => fileInputRef.current?.click()}
						className="text-xs text-muted-foreground hover:text-foreground"
					>
						Add files
					</button>
					<button
						type="button"
						data-testid="split-pdf"
						onClick={() => splitInputRef.current?.click()}
						className="text-xs text-muted-foreground hover:text-foreground"
					>
						Split a PDF…
					</button>
					<input
						ref={splitInputRef}
						type="file"
						accept=".pdf,application/pdf"
						data-testid="split-pdf-input"
						className="sr-only"
						tabIndex={-1}
						onChange={(e) => {
							const f = Array.from(e.target.files ?? [])[0];
							e.target.value = "";
							if (f) setSplitting(f);
						}}
					/>
					<button
						type="button"
						onClick={() => setLinking((open) => !open)}
						className="text-xs text-muted-foreground hover:text-foreground"
					>
						Add YouTube link
					</button>
					<input
						ref={fileInputRef}
						type="file"
						multiple
						accept={LESSON_SOURCE_ACCEPT}
						className="sr-only"
						tabIndex={-1}
						onChange={(e) => {
							// Copy BEFORE clearing the input: resetting its value empties
							// the live FileList in Chrome, and nothing would upload.
							const picked = Array.from(e.target.files ?? []);
							e.target.value = "";
							// An oversized PDF opens the splitter instead of the size
							// error (one at a time; the rest stage as usual).
							const big = picked.find((f) => isOversizePdf(f.name, f.size));
							if (big) setSplitting(big);
							const list = big ? picked.filter((f) => f !== big) : picked;
							if (list.length === 0) return;
							void stagePickedFiles(incoming, list, existing.length).then((picked) => {
								if (picked.error) {
									setError(picked.error);
									return;
								}
								setIncoming(picked.files);
								setError(null);
							});
						}}
					/>
				</div>
				{linking && (
					<YoutubeLinkForm
						onClose={() => setLinking(false)}
						onSubmit={async (url) => {
							const picked = await stageYoutube(incoming, url, existing.length);
							if (picked.error) return picked.error;
							setIncoming(picked.files);
							setError(null);
							return null;
						}}
					/>
				)}
				{(existing.length > 0 || incoming.length > 0) ? (
					<div className="flex flex-wrap gap-1.5">
						{existing.map((file) => (
							<span key={file.stored} className="flex max-w-52 items-center gap-1 rounded-md border px-2 py-1 text-xs">
								<span className="truncate">{file.name}</span>
								<button type="button" aria-label={`Remove ${file.name}`} onClick={() => void removeExisting(file.stored)} className="text-muted-foreground hover:text-foreground">
									×
								</button>
							</span>
						))}
						{incoming.map((file) => (
							<span key={`${file.batchId}:${file.stored}`} className="flex max-w-52 items-center gap-1 rounded-md border border-dashed px-2 py-1 text-xs">
								<span className="truncate">{file.name}</span>
								<button
									type="button"
									aria-label={`Remove ${file.name}`}
									onClick={() => setIncoming(incoming.filter((f) => !(f.batchId === file.batchId && f.stored === file.stored)))}
									className="text-muted-foreground hover:text-foreground"
								>
									×
								</button>
							</span>
						))}
					</div>
				) : (
					<p className="text-xs text-muted-foreground">Optional. PDFs, Word, PowerPoint, Excel, text, code, data, images, or a YouTube link (its transcript). A PDF over 25 MB can be split into parts.</p>
				)}
			</div>
			{splitting && (
				<PdfSplitter
					file={splitting}
					onCancel={() => setSplitting(null)}
					onDone={(parts) => {
						setSplitting(null);
						void stagePickedFiles(incoming, parts, existing.length).then((picked) => {
							setIncoming(picked.files);
							setError(picked.error);
						});
					}}
				/>
			)}
			{error && <p role="alert" className="text-xs text-red-400">{error}</p>}
			<div className="flex justify-end gap-2 pt-1">
				{onCancel && (
					<button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
						Cancel
					</button>
				)}
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
	);
}
