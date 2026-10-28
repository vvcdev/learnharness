/** Manual PDF splitting (owner, 2026-10-28): cut an oversized PDF into
 *  parts, each a real PDF under the source cap. Pure planning here — the
 *  panel does the cutting in the browser with pdf-lib. */

import { MAX_LESSON_SOURCE_BYTES } from "./lesson-sources.ts";

/** The largest PDF the splitter will load into memory. */
export const MAX_SPLIT_INPUT_BYTES = 400 * 1024 * 1024;

/** One part: pages `from`..`to`, 1-based and inclusive. */
export interface SplitPart {
	from: number;
	to: number;
}

/** A PDF too big to attach as-is (the splitter is offered instead of the
 *  size error). */
export function isOversizePdf(name: string, bytes: number): boolean {
	return /\.pdf$/i.test(name) && bytes > MAX_LESSON_SOURCE_BYTES;
}

/** Even parts that should land under the cap: aim for 80% of it per part
 *  (page weights vary, so the real sizes are shown after the cut). */
export function evenParts(pageCount: number, totalBytes: number, maxBytes = MAX_LESSON_SOURCE_BYTES): SplitPart[] {
	if (pageCount < 1) return [];
	const wanted = Math.max(2, Math.ceil(totalBytes / (maxBytes * 0.8)));
	const n = Math.min(wanted, pageCount);
	const base = Math.floor(pageCount / n);
	const extra = pageCount % n;
	const parts: SplitPart[] = [];
	let from = 1;
	for (let i = 0; i < n; i++) {
		const size = base + (i < extra ? 1 : 0);
		parts.push({ from, to: from + size - 1 });
		from += size;
	}
	return parts;
}

/** Why a part is invalid (null = fine). */
export function partError(part: SplitPart, pageCount: number): string | null {
	if (!Number.isInteger(part.from) || !Number.isInteger(part.to)) return "Use whole page numbers.";
	if (part.from < 1 || part.to > pageCount) return `Pages run from 1 to ${pageCount}.`;
	if (part.from > part.to) return "The first page must not come after the last.";
	return null;
}

/** The part's file name: `<stem> (pages 1-120).pdf`. */
export function partFileName(baseName: string, part: SplitPart): string {
	const stem =
		baseName
			.split(/[/\\]/)
			.pop()!
			.replace(/\.pdf$/i, "")
			.replace(/[^\w.\- ()]+/g, "_")
			.slice(0, 100) || "document";
	return part.from === part.to ? `${stem} (page ${part.from}).pdf` : `${stem} (pages ${part.from}-${part.to}).pdf`;
}

export function formatBytes(bytes: number): string {
	if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
