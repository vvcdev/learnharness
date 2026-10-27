"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, FolderIcon, FolderOpenIcon } from "lucide-react";
import { useBackdropDismiss } from "@/components/backdrop-dismiss";
import { MenuShell } from "@/components/menu-shell";
import { cn } from "@/lib/utils";
import {
	EMPTY_FOLDERS,
	folderSubtreeIds,
	folderTree,
	MAX_FOLDER_NAME,
	sanitizeFolders,
	type ChatDeleteMode,
	type FolderNode,
	type FoldersState,
} from "@/src/core";

/**
 * The sidebar's folders + multi-select pieces (owner, 2026-10-27): the
 * folders hook, the folder row, the inline name input, the folder picker
 * menu, the bulk bar, and the bulk-delete dialog. The sidebar owns the
 * state and layout; the rules live in src/core/folders.ts.
 */

// ─── state ───────────────────────────────────────────────────────────────────

export type FolderCall = { ok: true; id?: string } | { ok: false; error: string };

export function useFolders() {
	const [state, setState] = useState<FoldersState>(EMPTY_FOLDERS);
	const refresh = useCallback(async () => {
		try {
			const res = await fetch("/api/folders", { cache: "no-store" });
			if (res.ok) setState(sanitizeFolders(await res.json()));
		} catch {
			/* keep the last known folders */
		}
	}, []);
	const send = useCallback(async (url: string, method: string, body?: unknown): Promise<FolderCall> => {
		try {
			const res = await fetch(url, {
				method,
				headers: body === undefined ? undefined : { "Content-Type": "application/json" },
				body: body === undefined ? undefined : JSON.stringify(body),
			});
			const payload = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
			if (!res.ok) return { ok: false, error: payload.error || "That didn't work." };
			setState(sanitizeFolders(payload));
			return { ok: true, id: payload.id };
		} catch {
			return { ok: false, error: "Could not reach the app. Try again." };
		}
	}, []);
	return {
		state,
		refresh,
		create: (name: string, parentId: string | null) => send("/api/folders", "POST", { name, parentId }),
		rename: (id: string, name: string) => send(`/api/folders/${encodeURIComponent(id)}`, "PUT", { name }),
		moveFolder: (id: string, parentId: string | null) => send(`/api/folders/${encodeURIComponent(id)}`, "PUT", { parentId }),
		remove: (id: string) => send(`/api/folders/${encodeURIComponent(id)}`, "DELETE"),
		place: (chatIds: string[], folderId: string | null) => send("/api/folders/move", "POST", { chatIds, folderId }),
	};
}

const OPEN_KEY = "lh:open-folders";

/** Which folders are expanded — remembered in this browser. */
export function useOpenFolders() {
	const [open, setOpen] = useState<Set<string>>(new Set());
	useEffect(() => {
		try {
			const raw = JSON.parse(window.localStorage.getItem(OPEN_KEY) ?? "[]") as unknown;
			if (Array.isArray(raw)) setOpen(new Set(raw.filter((x): x is string => typeof x === "string")));
		} catch {
			/* storage blocked or corrupt — start collapsed */
		}
	}, []);
	const save = (next: Set<string>) => {
		try {
			window.localStorage.setItem(OPEN_KEY, JSON.stringify([...next]));
		} catch {
			/* best-effort */
		}
	};
	const toggle = useCallback((id: string) => {
		setOpen((prev) => {
			const next = new Set(prev);
			if (!next.delete(id)) next.add(id);
			save(next);
			return next;
		});
	}, []);
	const expand = useCallback((id: string) => {
		setOpen((prev) => {
			if (prev.has(id)) return prev;
			const next = new Set(prev).add(id);
			save(next);
			return next;
		});
	}, []);
	return { open, toggle, expand };
}

// ─── rows ────────────────────────────────────────────────────────────────────

export type FolderSelection = "none" | "some" | "all";

export function FolderRow({
	name,
	depth,
	open,
	count,
	onToggle,
	onContextMenu,
	selecting = false,
	selection = "none",
	onSelect,
	testId,
}: {
	name: string;
	depth: number;
	open: boolean;
	count: number;
	onToggle: () => void;
	onContextMenu?: (e: React.MouseEvent<HTMLButtonElement>) => void;
	selecting?: boolean;
	selection?: FolderSelection;
	onSelect?: () => void;
	testId?: string;
}) {
	const Icon = open ? FolderOpenIcon : FolderIcon;
	return (
		<div className="mb-0.5 flex items-center" style={{ paddingLeft: depth * 12 }}>
			{selecting && (
				<SelectBox checked={selection === "all"} mixed={selection === "some"} onChange={onSelect} label={`Select folder ${name}`} />
			)}
			<button
				type="button"
				data-testid={testId ?? "folder-row"}
				aria-expanded={open}
				onClick={onToggle}
				onContextMenu={onContextMenu}
				className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
			>
				{open ? <ChevronDownIcon className="size-3 shrink-0" /> : <ChevronRightIcon className="size-3 shrink-0" />}
				<Icon className="size-3.5 shrink-0" />
				<span className="min-w-0 flex-1 truncate font-prose text-(length:--lh-prose-size)">{name}</span>
				<span className="shrink-0 text-xs text-muted-foreground/70">{count}</span>
			</button>
		</div>
	);
}

export function SelectBox({
	checked,
	mixed = false,
	onChange,
	label,
}: {
	checked: boolean;
	mixed?: boolean;
	onChange?: () => void;
	label: string;
}) {
	return (
		<button
			type="button"
			role="checkbox"
			aria-checked={mixed ? "mixed" : checked}
			aria-label={label}
			data-testid="select-box"
			onClick={(e) => {
				e.stopPropagation();
				onChange?.();
			}}
			className={cn(
				"mr-1 flex size-4 shrink-0 items-center justify-center rounded-sm border",
				checked || mixed ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background",
			)}
		>
			{checked ? <CheckIcon className="size-3" /> : mixed ? <span className="h-0.5 w-2 bg-current" /> : null}
		</button>
	);
}

/** Inline name entry (new folder / rename): Enter commits, Esc discards,
 *  blur commits a non-empty name — the session rename's rules. */
export function NameInput({
	initial = "",
	depth,
	placeholder,
	onCommit,
	onCancel,
}: {
	initial?: string;
	depth: number;
	placeholder: string;
	onCommit: (name: string) => void;
	onCancel: () => void;
}) {
	const ref = useRef<HTMLInputElement>(null);
	const done = useRef(false);
	useEffect(() => {
		ref.current?.focus();
		ref.current?.select();
	}, []);
	const finish = (commit: boolean) => {
		if (done.current) return;
		done.current = true;
		const value = ref.current?.value.trim() ?? "";
		if (commit && value) onCommit(value);
		else onCancel();
	};
	return (
		<div className="mb-0.5 flex items-center gap-1.5 px-2 py-1" style={{ paddingLeft: depth * 12 + 8 }}>
			<FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
			<input
				ref={ref}
				data-testid="folder-name-input"
				defaultValue={initial}
				maxLength={MAX_FOLDER_NAME}
				placeholder={placeholder}
				aria-label={placeholder}
				onKeyDown={(e) => {
					e.stopPropagation();
					if (e.key === "Enter") finish(true);
					else if (e.key === "Escape") finish(false);
				}}
				onBlur={() => finish(true)}
				className="lh-input min-w-0 flex-1 rounded-sm border bg-background px-1.5 py-0.5 text-xs outline-none focus:border-ring"
			/>
		</div>
	);
}

// ─── the folder picker ───────────────────────────────────────────────────────

/** Pick a destination folder (or the top level). `exclude` hides a folder's
 *  own subtree when moving a folder. Dismissal belongs to the caller. */
export function FolderPicker({
	anchorRef,
	state,
	exclude = [],
	onPick,
	testid = "folder-picker",
}: {
	anchorRef: RefObject<HTMLElement | null>;
	state: FoldersState;
	exclude?: readonly string[];
	onPick: (folderId: string | null) => void;
	testid?: string;
}) {
	const hidden = new Set(exclude.flatMap((id) => folderSubtreeIds(state, id)));
	const flat: { id: string; name: string; depth: number }[] = [];
	const walk = (nodes: FolderNode[]) => {
		for (const n of nodes) {
			if (!hidden.has(n.folder.id)) {
				flat.push({ id: n.folder.id, name: n.folder.name, depth: n.depth });
				walk(n.children);
			}
		}
	};
	walk(folderTree(state));
	return (
		<MenuShell
			anchorRef={anchorRef}
			testid={testid}
			preferredSide="down"
			menuClass="flex max-h-72 w-56 flex-col gap-0.5 overflow-y-auto rounded-xl border bg-card p-2 text-xs shadow-xl"
		>
			<button
				type="button"
				data-testid="picker-top"
				onClick={() => onPick(null)}
				className="flex items-center rounded-lg px-2.5 py-1.5 text-left text-foreground transition-colors hover:bg-accent"
			>
				No folder (top level)
			</button>
			{flat.length > 0 && <div className="my-0.5 border-t border-border/60" aria-hidden="true" />}
			{flat.map((f) => (
				<button
					key={f.id}
					type="button"
					data-testid="picker-folder"
					onClick={() => onPick(f.id)}
					style={{ paddingLeft: 10 + f.depth * 12 }}
					className="flex items-center gap-1.5 rounded-lg py-1.5 pr-2.5 text-left text-foreground transition-colors hover:bg-accent"
				>
					<FolderIcon className="size-3 shrink-0 text-muted-foreground" />
					<span className="truncate">{f.name}</span>
				</button>
			))}
		</MenuShell>
	);
}

// ─── bulk bar ────────────────────────────────────────────────────────────────

export function BulkBar({
	count,
	moveRef,
	onMove,
	onDelete,
	onCancel,
}: {
	count: number;
	moveRef: RefObject<HTMLButtonElement | null>;
	onMove: () => void;
	onDelete: () => void;
	onCancel: () => void;
}) {
	const none = count === 0;
	return (
		<div data-testid="bulk-bar" className="mx-2 mb-2 flex items-center gap-1.5 rounded-lg border bg-card px-2 py-1.5 text-xs">
			<span className="min-w-0 flex-1 truncate text-muted-foreground" data-testid="bulk-count">
				{count} selected
			</span>
			<button
				ref={moveRef}
				type="button"
				data-testid="bulk-move"
				disabled={none}
				onClick={onMove}
				className="rounded-sm px-2 py-1 text-foreground transition-colors hover:bg-accent disabled:opacity-40"
			>
				Move…
			</button>
			<button
				type="button"
				data-testid="bulk-delete"
				disabled={none}
				onClick={onDelete}
				className="rounded-sm border border-destructive/50 bg-destructive/10 px-2 py-1 text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-40"
			>
				Delete…
			</button>
			<button
				type="button"
				data-testid="bulk-cancel"
				onClick={onCancel}
				className="rounded-sm px-2 py-1 text-muted-foreground transition-colors hover:text-foreground"
			>
				Cancel
			</button>
		</div>
	);
}

// ─── bulk delete ─────────────────────────────────────────────────────────────

type BulkFailure = { id: string; code: string; error: string };

/** The multi-select deletion confirm: one graph-traces choice for all.
 *  Sessions with running work are skipped by the server and listed back. */
export function BulkDeleteDialog({
	chats,
	onClose,
	onDeleted,
}: {
	/** The selected sessions; null = closed. */
	chats: readonly { id: string; title: string }[] | null;
	onClose: () => void;
	onDeleted: (ids: string[], mode: ChatDeleteMode, graphRevision: number) => void;
}) {
	const [traces, setTraces] = useState(false);
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState<BulkFailure[] | null>(null);
	const backdropDismiss = useBackdropDismiss(() => {
		if (!busy) onClose();
	});
	useEffect(() => {
		if (!chats) {
			setTraces(false);
			setBusy(false);
			setFailed(null);
		}
	}, [chats]);
	useEffect(() => {
		if (!chats) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.preventDefault();
			e.stopPropagation();
			if (!busy) onClose();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [chats, busy, onClose]);

	if (!chats) return null;
	const titles = new Map(chats.map((c) => [c.id, c.title]));

	const run = async () => {
		if (busy) return;
		const mode: ChatDeleteMode = traces ? "delete-nodes" : "preserve-graph";
		const ids = failed ? failed.map((f) => f.id) : chats.map((c) => c.id);
		setBusy(true);
		try {
			const res = await fetch("/api/chats/bulk-delete", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ids, mode }),
			});
			const body = (await res.json().catch(() => ({}))) as {
				deleted?: string[];
				failed?: BulkFailure[];
				graphRevision?: number;
				error?: string;
			};
			if (!res.ok) {
				setFailed(ids.map((id) => ({ id, code: "error", error: body.error ?? `Delete failed (${res.status})` })));
				setBusy(false);
				return;
			}
			onDeleted(body.deleted ?? [], mode, body.graphRevision ?? 0);
			if ((body.failed ?? []).length === 0) {
				onClose();
				return;
			}
			setFailed(body.failed!);
		} catch {
			setFailed(ids.map((id) => ({ id, code: "network", error: "Network error. Try again." })));
		}
		setBusy(false);
	};

	const remaining = failed ? failed.length : chats.length;
	return createPortal(
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80" {...backdropDismiss}>
			<div
				role="dialog"
				aria-modal="true"
				aria-label="Delete sessions"
				data-testid="bulk-delete-dialog"
				onClick={(e) => e.stopPropagation()}
				className="w-[32rem] max-w-[calc(100vw-2rem)] rounded-xl border bg-card p-5 shadow-xl"
			>
				<h2 className="text-sm font-semibold text-destructive">
					Delete {remaining} session{remaining === 1 ? "" : "s"}?
				</h2>
				{failed ? (
					<div role="alert" data-testid="bulk-failures" className="mt-2 rounded-sm border border-border/60 px-3 py-2 text-xs">
						<p className="text-foreground">These couldn’t be deleted — wait for their running work to finish, then try again:</p>
						<ul className="mt-1.5 flex flex-col gap-0.5 text-muted-foreground">
							{failed.map((f) => (
								<li key={f.id} className="truncate">
									{titles.get(f.id) ?? f.id} — {f.error}
								</li>
							))}
						</ul>
					</div>
				) : (
					<>
						<ul className="mt-1.5 max-h-32 overflow-y-auto font-mono text-xs text-foreground">
							{chats.map((c) => (
								<li key={c.id} className="truncate">
									{c.title}
								</li>
							))}
						</ul>
						<p className="mt-2 text-sm text-muted-foreground">
							This permanently removes these sessions — their messages, background jobs, and extraction records. Everything
							they added to the graph stays unless you check below. This cannot be undone.
						</p>
					</>
				)}
				<label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-lg border border-border/60 px-4 py-3">
					<input
						type="checkbox"
						data-testid="bulk-delete-traces"
						checked={traces}
						onChange={(e) => setTraces(e.target.checked)}
						disabled={busy}
						className="mt-0.5 size-4 shrink-0 accent-primary"
					/>
					<span className="min-w-0">
						<span className="block text-sm text-foreground">Also remove their graph traces</span>
						<span className="mt-1 block text-xs text-muted-foreground">
							These sessions’ topics, links, and events leave the graph too. Topics other sessions or imported notes also
							cover survive; topics only these sessions created are removed entirely.
						</span>
					</span>
				</label>
				<div className="mt-4 flex justify-end gap-2">
					<button
						type="button"
						data-testid="bulk-delete-cancel"
						onClick={onClose}
						disabled={busy}
						className="rounded-sm px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
					>
						{failed ? "Close" : "Cancel"}
					</button>
					<button
						type="button"
						data-testid="bulk-delete-confirm"
						onClick={() => void run()}
						disabled={busy}
						className="rounded-sm border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-40"
					>
						{busy ? "Deleting…" : failed ? "Try again" : "Delete"}
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
}
