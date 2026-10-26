"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { formatPages, parseRangeSpec, type SourceOutline, type SourceScope } from "@/src/core";

/**
 * The file chip's scope picker (owner 2026-10-26): limit an attached PDF
 * to pages, a PowerPoint to slides, or a Word/Markdown file to sections —
 * the agent then works only from those parts. Opens from the chip; reads
 * the staged file's outline once.
 */
export function SourceScopePicker({
	batchId,
	stored,
	scope,
	anchor,
	onChange,
	onClose,
}: {
	batchId: string;
	stored: string;
	scope?: SourceScope;
	/** The chip it opens from — portaled above it (composer shells clip). */
	anchor: HTMLElement;
	onChange: (scope: SourceScope | undefined) => void;
	onClose: () => void;
}) {
	const rootRef = useRef<HTMLDivElement>(null);
	// Outside = neither the panel nor its chip (the chip toggles itself).
	useEffect(() => {
		const onDown = (e: PointerEvent) => {
			const t = e.target as Node;
			if (!rootRef.current?.contains(t) && !anchor.contains(t)) onClose();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.stopPropagation();
			onClose();
		};
		document.addEventListener("pointerdown", onDown);
		document.addEventListener("keydown", onKey, true);
		return () => {
			document.removeEventListener("pointerdown", onDown);
			document.removeEventListener("keydown", onKey, true);
		};
	}, [anchor, onClose]);
	const rect = anchor.getBoundingClientRect();
	const [outline, setOutline] = useState<SourceOutline | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		let live = true;
		fetch(`/api/uploads/outline?batch=${encodeURIComponent(batchId)}&stored=${encodeURIComponent(stored)}`)
			.then(async (r) => {
				const body = (await r.json().catch(() => ({}))) as SourceOutline & { error?: string };
				if (!live) return;
				if (!r.ok) setError(body.error ?? "Couldn't read this file.");
				else setOutline(body);
			})
			.catch(() => live && setError("Couldn't read this file."));
		return () => {
			live = false;
		};
	}, [batchId, stored]);

	return createPortal(
		<div
			ref={rootRef}
			data-testid="source-scope-picker"
			style={{ left: Math.min(rect.left, window.innerWidth - 300), bottom: window.innerHeight - rect.top + 6 }}
			className="fixed z-50 w-72 rounded-lg border border-border bg-popover p-2.5 text-xs shadow-md"
		>
			{error ? (
				<p className="text-red-400">{error}</p>
			) : !outline ? (
				<p className="text-muted-foreground">Reading the file…</p>
			) : outline.kind === "pages" || outline.kind === "slides" ? (
				<RangeScope outline={outline} scope={scope} onChange={onChange} onClose={onClose} />
			) : outline.kind === "sections" ? (
				<SectionScope outline={outline} scope={scope} onChange={onChange} onClose={onClose} />
			) : (
				<p className="text-muted-foreground">This file can only be used whole.</p>
			)}
		</div>,
		document.body,
	);
}

function RangeScope({
	outline,
	scope,
	onChange,
	onClose,
}: {
	outline: Extract<SourceOutline, { kind: "pages" | "slides" }>;
	scope?: SourceScope;
	onChange: (scope: SourceScope | undefined) => void;
	onClose: () => void;
}) {
	const noun = outline.kind === "pages" ? "Pages" : "Slides";
	const [spec, setSpec] = useState(scope && scope.kind === outline.kind ? scope.spec : "");
	const parsed = spec.trim() ? parseRangeSpec(spec, outline.count) : null;
	const apply = () => {
		if (!spec.trim()) {
			onChange(undefined);
			onClose();
			return;
		}
		if (!parsed || "error" in parsed) return;
		onChange({ kind: outline.kind, spec: formatPages(parsed.pages).replace(/–/g, "-") });
		onClose();
	};
	return (
		<div className="flex flex-col gap-2">
			<div className="font-ui uppercase tracking-wider text-muted-foreground">
				{noun} to use <span className="normal-case tracking-normal">(of {outline.count})</span>
			</div>
			<input
				autoFocus
				data-testid="source-scope-range"
				value={spec}
				placeholder={`e.g. 3-7, 12 — empty = whole ${outline.kind === "pages" ? "PDF" : "deck"}`}
				onChange={(e) => setSpec(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						e.stopPropagation();
						apply();
					}
				}}
				className="h-8 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-primary/50"
			/>
			{parsed && "error" in parsed && <p className="text-red-400">{parsed.error}</p>}
			{parsed && "pages" in parsed && (
				<p className="text-muted-foreground">
					{parsed.pages.length} {parsed.pages.length === 1 ? noun.toLowerCase().slice(0, -1) : noun.toLowerCase()}:{" "}
					{formatPages(parsed.pages)}
				</p>
			)}
			<Actions onApply={apply} disabled={Boolean(parsed && "error" in parsed)} onWhole={() => (onChange(undefined), onClose())} />
		</div>
	);
}

function SectionScope({
	outline,
	scope,
	onChange,
	onClose,
}: {
	outline: Extract<SourceOutline, { kind: "sections" }>;
	scope?: SourceScope;
	onChange: (scope: SourceScope | undefined) => void;
	onClose: () => void;
}) {
	const [picked, setPicked] = useState<Set<number>>(new Set(scope?.kind === "sections" ? scope.sections : []));
	const toggle = useCallback(
		(i: number) =>
			setPicked((prev) => {
				const next = new Set(prev);
				if (next.has(i)) next.delete(i);
				else next.add(i);
				return next;
			}),
		[],
	);
	if (outline.sections.length === 0) {
		return <p className="text-muted-foreground">No headings found — this file can only be used whole.</p>;
	}
	const minLevel = Math.min(...outline.sections.map((s) => s.level));
	const apply = () => {
		const sections = [...picked].sort((a, b) => a - b);
		onChange(sections.length > 0 ? { kind: "sections", sections, titles: sections.map((i) => outline.sections[i]!.title) } : undefined);
		onClose();
	};
	return (
		<div className="flex flex-col gap-2">
			<div className="font-ui uppercase tracking-wider text-muted-foreground">Sections to use</div>
			<div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto" data-testid="source-scope-sections">
				{outline.sections.map((s, i) => (
					<label
						key={i}
						className="flex cursor-pointer items-start gap-2 rounded-sm px-1 py-0.5 hover:bg-accent"
						style={{ paddingLeft: `${(s.level - minLevel) * 12 + 4}px` }}
					>
						<input type="checkbox" checked={picked.has(i)} onChange={() => toggle(i)} className="mt-0.5" />
						<span className="text-sm leading-snug">{s.title}</span>
					</label>
				))}
			</div>
			<p className="text-muted-foreground">A section includes its subsections.</p>
			<Actions onApply={apply} onWhole={() => (onChange(undefined), onClose())} />
		</div>
	);
}

function Actions({ onApply, onWhole, disabled }: { onApply: () => void; onWhole: () => void; disabled?: boolean }) {
	return (
		<div className="flex items-center justify-end gap-1.5">
			<button type="button" onClick={onWhole} className="rounded-md px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground">
				Whole file
			</button>
			<button
				type="button"
				data-testid="source-scope-apply"
				disabled={disabled}
				onClick={onApply}
				className={cn("rounded-md bg-primary px-2.5 py-1 font-medium text-primary-foreground", disabled && "opacity-40")}
			>
				Use these
			</button>
		</div>
	);
}
