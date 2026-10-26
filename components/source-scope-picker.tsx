"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatPages, parseRangeSpec, type SourceOutline, type SourceScope } from "@/src/core";

/**
 * In-app file browser for the chip's scope picker (owner 2026-10-26):
 * browse PDF pages (thumbnails), PowerPoint slides (text cards), or
 * Word/Markdown outline sections, then pick which parts to include.
 */
export function SourceScopePicker({
	outlineUrl,
	previewUrl,
	scope,
	fileName,
	onChange,
	onClose,
}: {
	outlineUrl: string;
	/** PDF page PNG base URL (`…&page=` or `…?page=` appended). Omit for non-PDFs. */
	previewUrl?: string;
	scope?: SourceScope;
	fileName: string;
	onChange: (scope: SourceScope | undefined) => void;
	onClose: () => void;
}) {
	const rootRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.stopPropagation();
			onClose();
		};
		document.addEventListener("keydown", onKey, true);
		return () => document.removeEventListener("keydown", onKey, true);
	}, [onClose]);

	const [outline, setOutline] = useState<SourceOutline | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		let live = true;
		fetch(outlineUrl)
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
	}, [outlineUrl]);

	return createPortal(
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-6"
			data-testid="source-scope-picker"
			onPointerDown={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div
				ref={rootRef}
				role="dialog"
				aria-label={`Choose parts of ${fileName}`}
				className="flex max-h-[min(40rem,90vh)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-xl"
			>
				<header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
					<div className="min-w-0 flex-1">
						<div className="truncate text-sm font-medium text-foreground">{fileName}</div>
						<p className="text-[11px] text-muted-foreground">Browse and pick what to include</p>
					</div>
					<button
						type="button"
						aria-label="Close"
						onClick={onClose}
						className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
					>
						<XIcon className="size-4" />
					</button>
				</header>
				<div className="min-h-0 flex-1 overflow-y-auto p-3">
					{error ? (
						<p className="text-sm text-red-400">{error}</p>
					) : !outline ? (
						<p className="text-sm text-muted-foreground">Reading the file…</p>
					) : outline.kind === "pages" ? (
						<PageBrowse outline={outline} previewUrl={previewUrl} scope={scope} onChange={onChange} onClose={onClose} />
					) : outline.kind === "slides" ? (
						<SlideBrowse outline={outline} scope={scope} onChange={onChange} onClose={onClose} />
					) : outline.kind === "sections" ? (
						<SectionBrowse outline={outline} scope={scope} onChange={onChange} onClose={onClose} />
					) : (
						<p className="text-sm text-muted-foreground">This file can only be used whole.</p>
					)}
				</div>
			</div>
		</div>,
		document.body,
	);
}

function pageUrl(base: string | undefined, page: number): string | undefined {
	if (!base) return undefined;
	const join = base.includes("?") ? "&" : "?";
	return `${base}${join}page=${page}`;
}

function PageBrowse({
	outline,
	previewUrl,
	scope,
	onChange,
	onClose,
}: {
	outline: Extract<SourceOutline, { kind: "pages" }>;
	previewUrl?: string;
	scope?: SourceScope;
	onChange: (scope: SourceScope | undefined) => void;
	onClose: () => void;
}) {
	const initial = useMemo(() => {
		if (scope?.kind !== "pages") return new Set<number>();
		const parsed = parseRangeSpec(scope.spec, outline.count);
		return "pages" in parsed ? new Set(parsed.pages) : new Set<number>();
	}, [scope, outline.count]);
	const [picked, setPicked] = useState<Set<number>>(initial);
	const [spec, setSpec] = useState(scope?.kind === "pages" ? scope.spec : "");

	const syncFromSpec = (value: string) => {
		setSpec(value);
		if (!value.trim()) {
			setPicked(new Set());
			return;
		}
		const parsed = parseRangeSpec(value, outline.count);
		if ("pages" in parsed) setPicked(new Set(parsed.pages));
	};

	const toggle = (page: number) => {
		setPicked((prev) => {
			const next = new Set(prev);
			if (next.has(page)) next.delete(page);
			else next.add(page);
			setSpec(next.size ? formatPages([...next].sort((a, b) => a - b)).replace(/–/g, "-") : "");
			return next;
		});
	};

	const parsed = spec.trim() ? parseRangeSpec(spec, outline.count) : null;
	const apply = () => {
		if (picked.size === 0 && !spec.trim()) {
			onChange(undefined);
			onClose();
			return;
		}
		const pages = [...picked].sort((a, b) => a - b);
		if (pages.length === 0) return;
		onChange({ kind: "pages", spec: formatPages(pages).replace(/–/g, "-") });
		onClose();
	};

	return (
		<div className="flex flex-col gap-3">
			<div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4" data-testid="source-scope-pages">
				{Array.from({ length: outline.count }, (_, i) => i + 1).map((page) => {
					const on = picked.has(page);
					const src = pageUrl(previewUrl, page);
					return (
						<button
							key={page}
							type="button"
							aria-pressed={on}
							onClick={() => toggle(page)}
							className={cn(
								"group relative flex flex-col overflow-hidden rounded-lg border text-left transition-colors",
								on ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-foreground/30",
							)}
						>
							<div className="relative aspect-[3/4] bg-muted/40">
								{src ? (
									// eslint-disable-next-line @next/next/no-img-element -- API PNG thumbs, not static assets
									<img src={src} alt={`Page ${page}`} loading="lazy" className="size-full object-contain object-top" />
								) : (
									<div className="flex size-full items-center justify-center text-xs text-muted-foreground">p. {page}</div>
								)}
								{on && (
									<span className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
										<CheckIcon className="size-3" />
									</span>
								)}
							</div>
							<span className="border-t border-border px-2 py-1 text-[11px] text-muted-foreground">Page {page}</span>
						</button>
					);
				})}
			</div>
			<label className="flex flex-col gap-1">
				<span className="text-[11px] uppercase tracking-wider text-muted-foreground">Or type pages</span>
				<input
					data-testid="source-scope-range"
					value={spec}
					placeholder={`e.g. 3-7, 12 — empty = whole PDF (${outline.count} pages)`}
					onChange={(e) => syncFromSpec(e.target.value)}
					className="h-8 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-primary/50"
				/>
			</label>
			{parsed && "error" in parsed && <p className="text-xs text-red-400">{parsed.error}</p>}
			{picked.size > 0 && (
				<p className="text-xs text-muted-foreground">
					{picked.size} page{picked.size === 1 ? "" : "s"}: {formatPages([...picked].sort((a, b) => a - b))}
				</p>
			)}
			<Actions onApply={apply} disabled={Boolean(parsed && "error" in parsed)} onWhole={() => (onChange(undefined), onClose())} />
		</div>
	);
}

function SlideBrowse({
	outline,
	scope,
	onChange,
	onClose,
}: {
	outline: Extract<SourceOutline, { kind: "slides" }>;
	scope?: SourceScope;
	onChange: (scope: SourceScope | undefined) => void;
	onClose: () => void;
}) {
	const initial = useMemo(() => {
		if (scope?.kind !== "slides") return new Set<number>();
		const parsed = parseRangeSpec(scope.spec, outline.count);
		return "pages" in parsed ? new Set(parsed.pages) : new Set<number>();
	}, [scope, outline.count]);
	const [picked, setPicked] = useState<Set<number>>(initial);
	const [spec, setSpec] = useState(scope?.kind === "slides" ? scope.spec : "");

	const syncFromSpec = (value: string) => {
		setSpec(value);
		if (!value.trim()) {
			setPicked(new Set());
			return;
		}
		const parsed = parseRangeSpec(value, outline.count);
		if ("pages" in parsed) setPicked(new Set(parsed.pages));
	};

	const toggle = (slide: number) => {
		setPicked((prev) => {
			const next = new Set(prev);
			if (next.has(slide)) next.delete(slide);
			else next.add(slide);
			setSpec(next.size ? formatPages([...next].sort((a, b) => a - b)).replace(/–/g, "-") : "");
			return next;
		});
	};

	const parsed = spec.trim() ? parseRangeSpec(spec, outline.count) : null;
	const apply = () => {
		if (picked.size === 0 && !spec.trim()) {
			onChange(undefined);
			onClose();
			return;
		}
		const pages = [...picked].sort((a, b) => a - b);
		if (pages.length === 0) return;
		onChange({ kind: "slides", spec: formatPages(pages).replace(/–/g, "-") });
		onClose();
	};

	return (
		<div className="flex flex-col gap-3">
			<div className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="source-scope-slides">
				{Array.from({ length: outline.count }, (_, i) => i + 1).map((slide) => {
					const on = picked.has(slide);
					const title = outline.titles[slide - 1]?.trim() || `Slide ${slide}`;
					const preview = outline.previews?.[slide - 1]?.trim();
					return (
						<button
							key={slide}
							type="button"
							aria-pressed={on}
							onClick={() => toggle(slide)}
							className={cn(
								"relative flex flex-col gap-1 rounded-lg border p-2.5 text-left transition-colors",
								on ? "border-primary bg-primary/5 ring-2 ring-primary/30" : "border-border hover:border-foreground/30",
							)}
						>
							{on && (
								<span className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
									<CheckIcon className="size-3" />
								</span>
							)}
							<span className="text-[10px] uppercase tracking-wider text-muted-foreground">Slide {slide}</span>
							<span className="pr-6 text-sm font-medium leading-snug text-foreground">{title}</span>
							{preview && preview !== title && (
								<span className="line-clamp-4 whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground">{preview}</span>
							)}
						</button>
					);
				})}
			</div>
			<label className="flex flex-col gap-1">
				<span className="text-[11px] uppercase tracking-wider text-muted-foreground">Or type slides</span>
				<input
					data-testid="source-scope-range"
					value={spec}
					placeholder={`e.g. 1-3, 8 — empty = whole deck (${outline.count} slides)`}
					onChange={(e) => syncFromSpec(e.target.value)}
					className="h-8 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-primary/50"
				/>
			</label>
			{parsed && "error" in parsed && <p className="text-xs text-red-400">{parsed.error}</p>}
			<Actions onApply={apply} disabled={Boolean(parsed && "error" in parsed)} onWhole={() => (onChange(undefined), onClose())} />
		</div>
	);
}

function SectionBrowse({
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
		return <p className="text-sm text-muted-foreground">No headings found — this file can only be used whole.</p>;
	}
	const minLevel = Math.min(...outline.sections.map((s) => s.level));
	const apply = () => {
		const sections = [...picked].sort((a, b) => a - b);
		onChange(sections.length > 0 ? { kind: "sections", sections, titles: sections.map((i) => outline.sections[i]!.title) } : undefined);
		onClose();
	};
	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col gap-1.5" data-testid="source-scope-sections">
				{outline.sections.map((s, i) => {
					const on = picked.has(i);
					return (
						<button
							key={i}
							type="button"
							aria-pressed={on}
							onClick={() => toggle(i)}
							style={{ marginLeft: `${(s.level - minLevel) * 12}px` }}
							className={cn(
								"rounded-lg border px-2.5 py-2 text-left transition-colors",
								on ? "border-primary bg-primary/5 ring-2 ring-primary/30" : "border-border hover:border-foreground/30",
							)}
						>
							<div className="flex items-start gap-2">
								<span
									className={cn(
										"mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border",
										on ? "border-primary bg-primary text-primary-foreground" : "border-border",
									)}
								>
									{on ? <CheckIcon className="size-3" /> : null}
								</span>
								<div className="min-w-0 flex-1">
									<div className="text-sm font-medium leading-snug text-foreground">{s.title}</div>
									{s.preview ? (
										<p className="mt-0.5 line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">{s.preview}</p>
									) : null}
								</div>
							</div>
						</button>
					);
				})}
			</div>
			<p className="text-xs text-muted-foreground">A section includes its subsections.</p>
			<Actions onApply={apply} onWhole={() => (onChange(undefined), onClose())} />
		</div>
	);
}

function Actions({ onApply, onWhole, disabled }: { onApply: () => void; onWhole: () => void; disabled?: boolean }) {
	return (
		<div className="flex items-center justify-end gap-1.5 border-t border-border pt-2">
			<button type="button" onClick={onWhole} className="rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
				Whole file
			</button>
			<button
				type="button"
				data-testid="source-scope-apply"
				disabled={disabled}
				onClick={onApply}
				className={cn("rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground", disabled && "opacity-40")}
			>
				Use these
			</button>
		</div>
	);
}
