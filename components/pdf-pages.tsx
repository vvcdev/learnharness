"use client";

import "pdfjs-dist/web/pdf_viewer.css";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

/**
 * The PDF pages of the document viewer (owner 2026-10-29): each page is a
 * canvas with pdfjs's selectable text layer on top, rendered only while it
 * is near the viewport. Loaded lazily by the viewer — pdfjs and its
 * stylesheet never reach a page that has no document open.
 */

/** Pages are drawn this far (px) before they scroll into view. */
const PRELOAD_MARGIN = "600px";

async function loadPdfjs() {
	const pdfjs = await import("pdfjs-dist");
	pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
	return pdfjs;
}

export default function PdfPages({ url, width }: { url: string; width: number }) {
	const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
	const [aspect, setAspect] = useState(1.3);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		let task: { destroy(): Promise<void> } | null = null;
		setDoc(null);
		setError(null);
		void (async () => {
			try {
				const pdfjs = await loadPdfjs();
				const loading = pdfjs.getDocument({ url });
				task = loading;
				const loaded = await loading.promise;
				if (cancelled) return;
				const first = await loaded.getPage(1);
				const v = first.getViewport({ scale: 1 });
				if (!cancelled) {
					setAspect(v.height / v.width);
					setDoc(loaded);
				}
			} catch {
				if (!cancelled) setError("Couldn’t open this PDF.");
			}
		})();
		return () => {
			cancelled = true;
			void task?.destroy();
		};
	}, [url]);

	if (error) return <p className="p-4 text-sm text-muted-foreground">{error}</p>;
	if (!doc) return <p className="p-4 text-sm text-muted-foreground">Opening…</p>;
	return (
		<div className="flex flex-col items-center gap-3 py-3" data-testid="pdf-pages">
			{Array.from({ length: doc.numPages }, (_, i) => (
				<PdfPage key={i + 1} doc={doc} num={i + 1} width={width} aspect={aspect} />
			))}
		</div>
	);
}

function PdfPage({ doc, num, width, aspect }: { doc: PDFDocumentProxy; num: number; width: number; aspect: number }) {
	const shell = useRef<HTMLDivElement>(null);
	const canvas = useRef<HTMLCanvasElement>(null);
	const textLayer = useRef<HTMLDivElement>(null);
	const [visible, setVisible] = useState(false);
	const [height, setHeight] = useState(width * aspect);
	const [scanned, setScanned] = useState(false);

	useEffect(() => {
		const el = shell.current;
		if (!el) return;
		const io = new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)), { rootMargin: PRELOAD_MARGIN });
		io.observe(el);
		return () => io.disconnect();
	}, []);

	useEffect(() => {
		if (!visible) return;
		let cancelled = false;
		let renderTask: { cancel(): void; promise: Promise<unknown> } | null = null;
		void (async () => {
			try {
				const pdfjs = await loadPdfjs();
				const page = await doc.getPage(num);
				const scale = width / page.getViewport({ scale: 1 }).width;
				const viewport = page.getViewport({ scale });
				const cv = canvas.current;
				const tl = textLayer.current;
				if (cancelled || !cv || !tl) return;
				setHeight(viewport.height);
				const dpr = window.devicePixelRatio || 1;
				cv.width = Math.floor(viewport.width * dpr);
				cv.height = Math.floor(viewport.height * dpr);
				cv.style.width = `${viewport.width}px`;
				cv.style.height = `${viewport.height}px`;
				const ctx = cv.getContext("2d");
				if (!ctx) return;
				renderTask = page.render({ canvas: cv, canvasContext: ctx, viewport, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0] });
				await renderTask.promise;
				if (cancelled) return;
				tl.replaceChildren();
				tl.style.setProperty("--total-scale-factor", String(scale));
				const layer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport });
				await layer.render();
				// A page with no text items is a scan: nothing to highlight on it.
				if (!cancelled) setScanned(tl.querySelector("span") === null);
			} catch {
				/* a cancelled render (scrolled away or resized) rejects — expected */
			}
		})();
		return () => {
			cancelled = true;
			renderTask?.cancel();
		};
	}, [visible, doc, num, width]);

	return (
		<div
			ref={shell}
			data-page={num}
			data-testid="pdf-page"
			className="relative shrink-0 bg-white shadow-sm"
			style={{ width, height }}
		>
			<canvas ref={canvas} className="block" />
			<div ref={textLayer} className="textLayer" />
			{scanned && (
				<span className="absolute right-2 bottom-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white" data-testid="pdf-page-scanned">
					Scanned page — no selectable text
				</span>
			)}
		</div>
	);
}
