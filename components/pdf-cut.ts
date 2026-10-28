import type { PDFDocument } from "pdf-lib";
import type { SplitPart } from "@/src/core";

/** Cut pages `part.from`..`part.to` (1-based, inclusive) out of an open
 *  document into a new PDF. The splitter loads pdf-lib lazily and passes
 *  the module in, so the library stays out of the main bundle. */
export async function cutPdfPart(
	lib: typeof import("pdf-lib"),
	source: PDFDocument,
	part: SplitPart,
): Promise<Uint8Array> {
	const doc = await lib.PDFDocument.create();
	const indices = Array.from({ length: part.to - part.from + 1 }, (_, i) => part.from - 1 + i);
	for (const page of await doc.copyPages(source, indices)) doc.addPage(page);
	return doc.save();
}
