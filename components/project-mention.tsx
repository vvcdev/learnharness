"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { FileTextIcon, FolderIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProjectDetail, ProjectFileMeta } from "@/src/core";
import { ACTIVE_PROJECT_CHANGED_EVENT } from "@/components/project-pack";

/**
 * @-MENTION PROJECT FILES (owner 2026-10-26): with a project active, typing
 * "@" in a message box lists the project's files; picking one adds it as a
 * chip (click the chip to limit pages / slides / sections). If any are
 * @-mentioned, a new session starts with just those; mid-session they
 * join the session's sources.
 */

/** The active project with its files, or null (none active). */
export function useActiveProject(): ProjectDetail | null {
	const [project, setProject] = useState<ProjectDetail | null>(null);
	const [generation, setGeneration] = useState(0);
	useEffect(() => {
		const bump = () => setGeneration((g) => g + 1);
		window.addEventListener(ACTIVE_PROJECT_CHANGED_EVENT, bump);
		return () => window.removeEventListener(ACTIVE_PROJECT_CHANGED_EVENT, bump);
	}, []);
	useEffect(() => {
		let live = true;
		void (async () => {
			const list = (await fetch("/api/projects", { cache: "no-store" }).then((r) => r.json()).catch(() => null)) as {
				activeId?: string | null;
			} | null;
			if (!live || !list?.activeId) return setProject(null);
			const detail = (await fetch(`/api/projects/${encodeURIComponent(list.activeId)}`, { cache: "no-store" })
				.then((r) => (r.ok ? r.json() : null))
				.catch(() => null)) as ProjectDetail | null;
			if (live) setProject(detail);
		})();
		return () => {
			live = false;
		};
	}, [generation]);
	return project;
}

/** The "@query" right before the caret, or null. */
export function mentionQuery(text: string, caret: number): { query: string; start: number } | null {
	const m = text.slice(0, caret).match(/(?:^|\s)@([^\s@]*)$/);
	return m ? { query: m[1]!, start: caret - m[1]!.length - 1 } : null;
}

export function useProjectMention({
	project,
	inputRef,
	value,
	setValue,
	onPick,
}: {
	project: ProjectDetail | null;
	inputRef: RefObject<HTMLTextAreaElement | null>;
	value: string;
	setValue: (v: string) => void;
	onPick: (file: ProjectFileMeta, projectId: string) => void;
}) {
	const [open, setOpen] = useState<{ query: string; start: number } | null>(null);
	const [index, setIndex] = useState(0);
	const files = project?.files ?? [];
	const matches = open ? files.filter((f) => f.name.toLowerCase().includes(open.query.toLowerCase())).slice(0, 8) : [];

	/** Re-read the caret (on every edit / selection move). */
	const sync = useCallback(() => {
		const el = inputRef.current;
		if (!el || !project || project.files.length === 0) return setOpen(null);
		const next = mentionQuery(el.value, el.selectionStart ?? el.value.length);
		setOpen(next);
		if (!next) setIndex(0);
	}, [inputRef, project]);

	const pick = useCallback(
		(file: ProjectFileMeta) => {
			if (!open || !project) return;
			const caret = inputRef.current?.selectionStart ?? value.length;
			setValue(value.slice(0, open.start) + value.slice(caret));
			onPick(file, project.id);
			setOpen(null);
			setIndex(0);
			requestAnimationFrame(() => {
				const el = inputRef.current;
				if (!el) return;
				el.focus();
				el.setSelectionRange(open.start, open.start);
			});
		},
		[open, project, inputRef, value, setValue, onPick],
	);

	/** Claim the list's keys while it is open; true = handled. */
	const onKeyDown = useCallback(
		(e: React.KeyboardEvent): boolean => {
			if (!open || matches.length === 0) return false;
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				setIndex((i) => (i + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
				return true;
			}
			if (e.key === "Enter" || e.key === "Tab") {
				e.preventDefault();
				pick(matches[Math.min(index, matches.length - 1)]!);
				return true;
			}
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				setOpen(null);
				return true;
			}
			return false;
		},
		[open, matches, index, pick],
	);

	const anchor = inputRef.current;
	const popover =
		open && anchor && project && typeof document !== "undefined"
			? createPortal(
					<MentionList
						rect={anchor.getBoundingClientRect()}
						projectName={project.name}
						matches={matches}
						index={Math.min(index, Math.max(0, matches.length - 1))}
						onHover={setIndex}
						onPick={pick}
					/>,
					document.body,
				)
			: null;

	return { onKeyDown, sync, popover, active: Boolean(project && project.files.length > 0) };
}

export type ProjectMention = ReturnType<typeof useProjectMention>;

function MentionList({
	rect,
	projectName,
	matches,
	index,
	onHover,
	onPick,
}: {
	rect: DOMRect;
	projectName: string;
	matches: ProjectFileMeta[];
	index: number;
	onHover: (i: number) => void;
	onPick: (file: ProjectFileMeta) => void;
}) {
	return (
		<div
			data-testid="project-mention"
			style={{ left: rect.left, bottom: window.innerHeight - rect.top + 6, width: Math.min(360, rect.width) }}
			className="fixed z-50 overflow-hidden rounded-lg border border-border bg-popover text-sm shadow-md"
			onPointerDown={(e) => e.preventDefault()}
		>
			<div className="flex items-center gap-1.5 border-b border-border/60 px-2.5 py-1.5 font-ui text-[11px] uppercase tracking-wider text-muted-foreground">
				<FolderIcon className="size-3" aria-hidden />
				{projectName}
			</div>
			{matches.length === 0 ? (
				<div className="px-2.5 py-2 text-xs text-muted-foreground">No matching files.</div>
			) : (
				matches.map((f, i) => (
					<button
						key={f.stored}
						type="button"
						data-testid="project-mention-item"
						onMouseEnter={() => onHover(i)}
						onClick={() => onPick(f)}
						className={cn("flex w-full items-center gap-2 px-2.5 py-1.5 text-left", i === index && "bg-accent")}
					>
						<FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
						<span className="truncate">{f.name}</span>
					</button>
				))
			)}
		</div>
	);
}
