"use client";

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Maximize2Icon, Minimize2Icon, XIcon } from "lucide-react";
import { cleanSelection, type DocumentKind, type Passage } from "@/src/core";
import { cn } from "@/lib/utils";

const PdfPages = lazy(() => import("@/components/pdf-pages"));

/**
 * The in-chat document viewer (owner 2026-10-29): read a PDF or document
 * beside the chat or full screen, select text, and ask for it to be
 * explained. The selection becomes a normal chat message via `onExplain`.
 */

export type ViewerDocument = {
	name: string;
	kind: DocumentKind;
	/** PDF bytes. */
	fileUrl: string;
	/** Plain text of a non-PDF. */
	textUrl: string;
};

export type ViewerMode = "side" | "full";

type Popover = { passage: Passage; x: number; y: number };

export function DocumentViewer({
	documents,
	current,
	onSelect,
	mode,
	onModeChange,
	onClose,
	onExplain,
}: {
	documents: readonly ViewerDocument[];
	/** Name of the document shown. */
	current: string;
	onSelect: (name: string) => void;
	mode: ViewerMode;
	onModeChange: (mode: ViewerMode) => void;
	onClose: () => void;
	onExplain: (passage: Passage) => void;
}) {
	const doc = documents.find((d) => d.name === current) ?? documents[0];
	const root = useRef<HTMLDivElement>(null);
	const body = useRef<HTMLDivElement>(null);
	const [pop, setPop] = useState<Popover | null>(null);
	const [bodyWidth, setBodyWidth] = useState(0);

	// Pages fit the pane: re-measure when the pane resizes (side ↔ full).
	useEffect(() => {
		const el = body.current;
		if (!el) return;
		const measure = () => setBodyWidth(Math.max(240, Math.floor(el.clientWidth - 24)));
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, [doc?.name, mode]);

	// The Explain pop-up follows the learner's selection inside the viewer.
	useEffect(() => {
		const read = () => {
			const sel = window.getSelection();
			const el = root.current;
			if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !el || !doc) return setPop(null);
			const range = sel.getRangeAt(0);
			if (!el.contains(range.commonAncestorContainer)) return setPop(null);
			const text = cleanSelection(sel.toString());
			if (!text) return setPop(null);
			const node = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
			const page = Number(node?.closest("[data-page]")?.getAttribute("data-page")) || undefined;
			const rect = range.getBoundingClientRect();
			setPop({ passage: { name: doc.name, page, text }, x: rect.left + rect.width / 2, y: rect.top });
		};
		const onChange = () => {
			const sel = window.getSelection();
			if (!sel || sel.isCollapsed) setPop(null);
		};
		document.addEventListener("selectionchange", onChange);
		const el = root.current;
		el?.addEventListener("mouseup", read);
		el?.addEventListener("keyup", read);
		return () => {
			document.removeEventListener("selectionchange", onChange);
			el?.removeEventListener("mouseup", read);
			el?.removeEventListener("keyup", read);
		};
	}, [doc]);

	if (!doc) return null;
	const explain = () => {
		if (!pop) return;
		onExplain(pop.passage);
		window.getSelection()?.removeAllRanges();
		setPop(null);
	};

	return (
		<aside
			ref={root}
			data-testid="document-viewer"
			data-mode={mode}
			aria-label={`Document: ${doc.name}`}
			tabIndex={-1}
			onKeyDown={(e) => {
				if (e.key === "Escape") {
					e.stopPropagation();
					onClose();
				}
			}}
			className={cn(
				"flex min-h-0 flex-col bg-background",
				mode === "full" ? "fixed inset-0 z-50" : "h-full w-[min(46vw,640px)] shrink-0 border-l border-border",
			)}
		>
			<div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
				{documents.length > 1 ? (
					<select
						value={doc.name}
						onChange={(e) => onSelect(e.target.value)}
						data-testid="document-viewer-select"
						aria-label="Document"
						className="min-w-0 flex-1 truncate rounded bg-transparent text-sm font-medium outline-none"
					>
						{documents.map((d) => (
							<option key={d.name} value={d.name}>{d.name}</option>
						))}
					</select>
				) : (
					<span className="min-w-0 flex-1 truncate text-sm font-medium" title={doc.name}>{doc.name}</span>
				)}
				<button
					type="button"
					data-testid="document-viewer-mode"
					aria-label={mode === "full" ? "Show beside the chat" : "Full screen"}
					title={mode === "full" ? "Show beside the chat" : "Full screen"}
					onClick={() => onModeChange(mode === "full" ? "side" : "full")}
					className="cursor-pointer rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
				>
					{mode === "full" ? <Minimize2Icon className="size-4" /> : <Maximize2Icon className="size-4" />}
				</button>
				<button
					type="button"
					data-testid="document-viewer-close"
					aria-label="Close document"
					onClick={onClose}
					className="cursor-pointer rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
				>
					<XIcon className="size-4" />
				</button>
			</div>
			<p className="shrink-0 border-b border-border/60 px-3 py-1.5 text-xs text-muted-foreground">Select text to have it explained.</p>
			<div ref={body} className="min-h-0 flex-1 overflow-y-auto">
				{doc.kind === "pdf" ? (
					bodyWidth > 0 && (
						<Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Opening…</p>}>
							<PdfPages url={doc.fileUrl} width={bodyWidth} />
						</Suspense>
					)
				) : (
					<TextBody url={doc.textUrl} />
				)}
			</div>
			{pop && (
				<button
					type="button"
					data-testid="document-viewer-explain"
					// Keep the selection alive while the button is pressed.
					onMouseDown={(e) => e.preventDefault()}
					onClick={explain}
					style={{ left: pop.x, top: Math.max(8, pop.y - 40) }}
					className="fixed z-[60] -translate-x-1/2 cursor-pointer rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-lg hover:opacity-90"
				>
					Explain
				</button>
			)}
		</aside>
	);
}

function TextBody({ url }: { url: string }) {
	const [state, setState] = useState<{ text?: string; error?: string } | null>(null);
	useEffect(() => {
		let live = true;
		setState(null);
		void fetch(url, { cache: "no-store" })
			.then(async (res) => {
				const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
				if (live) setState(res.ok && typeof body.text === "string" ? { text: body.text } : { error: body.error ?? "Couldn’t open this file." });
			})
			.catch(() => live && setState({ error: "Couldn’t open this file." }));
		return () => { live = false; };
	}, [url]);
	if (!state) return <p className="p-4 text-sm text-muted-foreground">Opening…</p>;
	if (state.error) return <p className="p-4 text-sm text-muted-foreground" data-testid="document-viewer-error">{state.error}</p>;
	return <div className="lh-prose whitespace-pre-wrap px-4 py-3 text-[15px] leading-relaxed" data-testid="document-viewer-text">{state.text}</div>;
}
