"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckIcon, FolderIcon, PlusIcon, XIcon } from "lucide-react";
import type { ProjectSummary } from "@/src/core";

async function loadProjects(): Promise<{ activeId: string | null; projects: ProjectSummary[] }> {
	const res = await fetch("/api/projects", { cache: "no-store" });
	if (!res.ok) return { activeId: null, projects: [] };
	return (await res.json()) as { activeId: string | null; projects: ProjectSummary[] };
}

/** Compact home control: pick the active pack; customize on /projects. */
export function ProjectPackControl({
	onActiveChange,
}: {
	onActiveChange?: (active: ProjectSummary | null) => void;
}) {
	const router = useRouter();
	const [projects, setProjects] = useState<ProjectSummary[]>([]);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [menuOpen, setMenuOpen] = useState(false);
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
							<button
								key={project.id}
								type="button"
								data-testid={`project-pick-${project.id}`}
								onClick={() => void activate(project.id)}
								className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent"
							>
								<span className="w-3 shrink-0">
									{project.id === activeId ? <CheckIcon className="size-3" /> : null}
								</span>
								<span className="min-w-0 flex-1 truncate text-foreground">{project.name}</span>
								<span className="shrink-0 text-muted-foreground">{project.fileCount}</span>
							</button>
						))}
					</div>
					<div className="border-t p-1">
						<button
							type="button"
							data-testid="project-pack-manage"
							onClick={() => {
								setMenuOpen(false);
								router.push("/projects");
							}}
							className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-foreground hover:bg-accent"
						>
							<FolderIcon className="size-3.5" />
							Manage projects
						</button>
						<Link
							href="/projects"
							onClick={() => setMenuOpen(false)}
							className="sr-only"
						>
							Projects
						</Link>
					</div>
				</div>
			)}
		</div>
	);
}
