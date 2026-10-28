"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PlusIcon, XIcon } from "lucide-react";
import { useBackdropDismiss } from "@/components/backdrop-dismiss";
import { cutPdfPart } from "@/components/pdf-cut";
import {
	evenParts,
	formatBytes,
	MAX_LESSON_SOURCE_BYTES,
	MAX_SPLIT_INPUT_BYTES,
	partError,
	partFileName,
	type SplitPart,
} from "@/src/core";
import { cn } from "@/lib/utils";

/**
 * Manual PDF splitter (owner, 2026-10-28): cut one PDF into parts by page
 * range, each part a real PDF under the source cap. The cutting happens
 * here in the browser with pdf-lib — the big file is never uploaded, so
 * the upload limit never applies. The parts go back to the caller as
 * ordinary files.
 */

type Row = SplitPart & { id: number };

export function PdfSplitter({
	file,
	onDone,
	onCancel,
}: {
	file: File;
	/** The finished parts, as ordinary PDF files. */
	onDone: (files: File[]) => void;
	onCancel: () => void;
}) {
	const [pageCount, setPageCount] = useState<number | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [rows, setRows] = useState<Row[]>([]);
	const [sizes, setSizes] = useState<Record<number, number>>({});
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const nextId = useRef(1);
	const libRef = useRef<typeof import("pdf-lib") | null>(null);
	const sourceRef = useRef<import("pdf-lib").PDFDocument | null>(null);
	const backdropDismiss = useBackdropDismiss(() => {
		if (!busy) onCancel();
	});

	// Load the document once: page count + the auto-filled even parts.
	useEffect(() => {
		let cancelled = false;
		void (async () => {
			if (file.size > MAX_SPLIT_INPUT_BYTES) {
				setLoadError(`That PDF is ${formatBytes(file.size)} — the splitter handles files up to ${formatBytes(MAX_SPLIT_INPUT_BYTES)}.`);
				return;
			}
			try {
				const lib = await import("pdf-lib");
				const bytes = new Uint8Array(await file.arrayBuffer());
				const source = await lib.PDFDocument.load(bytes); // throws on encrypted files
				if (cancelled) return;
				libRef.current = lib;
				sourceRef.current = source;
				const count = source.getPageCount();
				setPageCount(count);
				setRows(evenParts(count, file.size).map((p) => ({ ...p, id: nextId.current++ })));
			} catch (err) {
				if (cancelled) return;
				const msg = err instanceof Error ? err.message : "";
				setLoadError(/encrypt/i.test(msg) ? "That PDF is password-protected, so it can't be split." : "Couldn't read that PDF — it may be damaged.");
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [file]);

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.preventDefault();
			e.stopPropagation();
			if (!busy) onCancel();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [busy, onCancel]);

	const edit = (id: number, patch: Partial<SplitPart>) => {
		setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
		setSizes({});
		setError(null);
	};
	const rowErrors = rows.map((r) => (pageCount ? partError(r, pageCount) : null));
	const canSplit = pageCount !== null && rows.length > 0 && rowErrors.every((e) => e === null) && !busy;

	const run = async () => {
		const lib = libRef.current;
		const source = sourceRef.current;
		if (!lib || !source || !canSplit) return;
		setError(null);
		setSizes({});
		const files: File[] = [];
		const nextSizes: Record<number, number> = {};
		try {
			for (const [i, row] of rows.entries()) {
				setBusy(`Cutting part ${i + 1} of ${rows.length}…`);
				await new Promise((r) => setTimeout(r, 0)); // let the panel repaint
				const bytes = await cutPdfPart(lib, source, row);
				nextSizes[row.id] = bytes.byteLength;
				files.push(new File([bytes as BlobPart], partFileName(file.name, row), { type: "application/pdf" }));
			}
		} catch {
			setError("Something went wrong while cutting. Try a smaller range.");
			setBusy(null);
			return;
		}
		setSizes(nextSizes);
		setBusy(null);
		const tooBig = rows.filter((r) => nextSizes[r.id]! > MAX_LESSON_SOURCE_BYTES);
		if (tooBig.length > 0) {
			setError(
				`${tooBig.length === 1 ? "One part is" : `${tooBig.length} parts are`} still over ${formatBytes(MAX_LESSON_SOURCE_BYTES)} — split those into smaller ranges.`,
			);
			return;
		}
		onDone(files);
	};

	return createPortal(
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80" {...backdropDismiss}>
			<div
				role="dialog"
				aria-modal="true"
				aria-label="Split PDF"
				data-testid="pdf-splitter"
				onClick={(e) => e.stopPropagation()}
				className="flex max-h-[85vh] w-[36rem] max-w-[calc(100vw-2rem)] flex-col rounded-xl border bg-card p-5 shadow-xl"
			>
				<h2 className="text-sm font-semibold text-foreground">Split this PDF</h2>
				<p className="mt-1 truncate font-mono text-xs text-muted-foreground" title={file.name}>
					{file.name} · {formatBytes(file.size)}
					{pageCount ? ` · ${pageCount} pages` : ""}
				</p>
				{file.size > MAX_LESSON_SOURCE_BYTES && (
					<p className="mt-1 text-xs text-muted-foreground">
						Each source can be up to {formatBytes(MAX_LESSON_SOURCE_BYTES)}. Cut it into parts by page range — it happens on your computer,
						nothing is uploaded yet.
					</p>
				)}

				{loadError ? (
					<p role="alert" data-testid="splitter-load-error" className="mt-4 text-sm text-red-400">
						{loadError}
					</p>
				) : pageCount === null ? (
					<p className="mt-4 text-sm text-muted-foreground">Reading the PDF…</p>
				) : (
					<>
						<div className="mt-4 flex items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground">
							<span>Parts</span>
							<button
								type="button"
								data-testid="splitter-autofill"
								disabled={!!busy}
								onClick={() => {
									setRows(evenParts(pageCount, file.size).map((p) => ({ ...p, id: nextId.current++ })));
									setSizes({});
									setError(null);
								}}
								className="rounded-sm px-1 py-0.5 normal-case tracking-normal transition-colors hover:text-foreground disabled:opacity-40"
							>
								Auto-fill even parts
							</button>
						</div>
						<div className="mt-1.5 min-h-0 flex-1 overflow-y-auto" data-testid="splitter-rows">
							{rows.map((row, i) => (
								<div key={row.id} className="mb-1.5" data-testid="splitter-row">
									<div className="flex items-center gap-2 text-xs">
										<span className="w-12 shrink-0 text-muted-foreground">Part {i + 1}</span>
										<span className="text-muted-foreground">pages</span>
										<input
											type="number"
											min={1}
											max={pageCount}
											value={Number.isFinite(row.from) ? row.from : ""}
											disabled={!!busy}
											aria-label={`Part ${i + 1} first page`}
											onChange={(e) => edit(row.id, { from: e.target.value === "" ? NaN : Number(e.target.value) })}
											className="lh-input w-16 rounded-md border bg-background px-2 py-1 outline-none focus:border-ring"
										/>
										<span className="text-muted-foreground">to</span>
										<input
											type="number"
											min={1}
											max={pageCount}
											value={Number.isFinite(row.to) ? row.to : ""}
											disabled={!!busy}
											aria-label={`Part ${i + 1} last page`}
											onChange={(e) => edit(row.id, { to: e.target.value === "" ? NaN : Number(e.target.value) })}
											className="lh-input w-16 rounded-md border bg-background px-2 py-1 outline-none focus:border-ring"
										/>
										{sizes[row.id] !== undefined && (
											<span className={cn("ml-auto shrink-0", sizes[row.id]! > MAX_LESSON_SOURCE_BYTES ? "text-red-400" : "text-muted-foreground")} data-testid="splitter-size">
												{formatBytes(sizes[row.id]!)}
											</span>
										)}
										<button
											type="button"
											aria-label={`Remove part ${i + 1}`}
											disabled={!!busy || rows.length <= 1}
											onClick={() => {
												setRows((prev) => prev.filter((r) => r.id !== row.id));
												setSizes({});
												setError(null);
											}}
											className={cn("text-muted-foreground hover:text-foreground disabled:opacity-30", sizes[row.id] === undefined && "ml-auto")}
										>
											<XIcon className="size-3.5" />
										</button>
									</div>
									{rowErrors[i] && <p className="ml-14 mt-0.5 text-[11px] text-red-400">{rowErrors[i]}</p>}
									<p className="ml-14 mt-0.5 truncate text-[11px] text-muted-foreground/70">{partFileName(file.name, row)}</p>
								</div>
							))}
							<button
								type="button"
								data-testid="splitter-add-row"
								disabled={!!busy}
								onClick={() => {
									const last = rows[rows.length - 1];
									const from = last && Number.isFinite(last.to) ? Math.min(last.to + 1, pageCount) : 1;
									setRows((prev) => [...prev, { id: nextId.current++, from, to: pageCount }]);
									setSizes({});
								}}
								className="mt-1 flex items-center gap-1 rounded-sm px-1 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
							>
								<PlusIcon className="size-3" />
								Add a part
							</button>
						</div>
					</>
				)}

				{busy && (
					<p className="mt-3 text-xs text-muted-foreground" data-testid="splitter-busy">
						{busy}
					</p>
				)}
				{error && (
					<p role="alert" data-testid="splitter-error" className="mt-3 text-xs text-red-400">
						{error}
					</p>
				)}
				<div className="mt-4 flex justify-end gap-2">
					<button
						type="button"
						data-testid="splitter-cancel"
						onClick={onCancel}
						disabled={!!busy}
						className="rounded-sm px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
					>
						Cancel
					</button>
					{!loadError && (
						<button
							type="button"
							data-testid="splitter-run"
							disabled={!canSplit}
							onClick={() => void run()}
							className="rounded-sm bg-primary px-3 py-1.5 text-xs text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
						>
							Split and add {rows.length > 0 ? `${rows.length} file${rows.length === 1 ? "" : "s"}` : ""}
						</button>
					)}
				</div>
			</div>
		</div>,
		document.body,
	);
}
