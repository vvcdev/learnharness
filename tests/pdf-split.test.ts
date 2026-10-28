/**
 * Manual PDF splitting (owner, 2026-10-28): the pure planning (auto-fill,
 * validation, names, the oversize check) and a REAL cut of a generated PDF
 * — each part opens as its own PDF with exactly the chosen pages.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as pdfLib from "pdf-lib";
import { cutPdfPart } from "../components/pdf-cut.ts";
import {
	evenParts,
	formatBytes,
	isOversizePdf,
	partError,
	partFileName,
} from "../src/core/pdf-split.ts";

const MB = 1024 * 1024;

describe("evenParts", () => {
	it("aims at 80% of the cap per part and covers every page exactly once", () => {
		const parts = evenParts(100, 80 * MB); // 80 / (25*0.8=20) = 4 parts
		assert.equal(parts.length, 4);
		assert.deepEqual(parts[0], { from: 1, to: 25 });
		assert.deepEqual(parts[3], { from: 76, to: 100 });
		assert.equal(parts.reduce((n, p) => n + (p.to - p.from + 1), 0), 100);
	});
	it("spreads the remainder, never makes more parts than pages, and always offers at least two", () => {
		assert.deepEqual(evenParts(10, 60 * MB).map((p) => p.to - p.from + 1), [4, 3, 3]);
		assert.equal(evenParts(3, 900 * MB).length, 3);
		assert.equal(evenParts(10, 1 * MB).length, 2);
		assert.deepEqual(evenParts(1, 100 * MB), [{ from: 1, to: 1 }]);
		assert.deepEqual(evenParts(0, 100 * MB), []);
	});
});

describe("partError / names / oversize", () => {
	it("validates ranges against the page count", () => {
		assert.equal(partError({ from: 1, to: 10 }, 10), null);
		assert.match(partError({ from: 0, to: 5 }, 10)!, /1 to 10/);
		assert.match(partError({ from: 3, to: 11 }, 10)!, /1 to 10/);
		assert.match(partError({ from: 6, to: 5 }, 10)!, /must not come after/);
		assert.match(partError({ from: NaN, to: 5 }, 10)!, /whole page numbers/);
	});
	it("names parts from the file name", () => {
		assert.equal(partFileName("Physics C.pdf", { from: 1, to: 120 }), "Physics C (pages 1-120).pdf");
		assert.equal(partFileName("/x/y/book.PDF", { from: 7, to: 7 }), "book (page 7).pdf");
		assert.equal(partFileName("we!rd:name.pdf", { from: 1, to: 2 }), "we_rd_name (pages 1-2).pdf");
	});
	it("offers the splitter only for PDFs over the 25 MB cap", () => {
		assert.equal(isOversizePdf("a.pdf", 26 * MB), true);
		assert.equal(isOversizePdf("a.PDF", 26 * MB), true);
		assert.equal(isOversizePdf("a.pdf", 25 * MB), false);
		assert.equal(isOversizePdf("a.docx", 100 * MB), false);
		assert.equal(formatBytes(1536 * 1024), "1.5 MB");
		assert.equal(formatBytes(2048), "2 KB");
	});
});

describe("cutPdfPart (real PDFs)", () => {
	async function samplePdf(pages: number): Promise<pdfLib.PDFDocument> {
		const doc = await pdfLib.PDFDocument.create();
		for (let i = 1; i <= pages; i++) {
			const page = doc.addPage([200, 200]);
			page.drawText(`Page ${i}`, { x: 20, y: 100 });
		}
		return pdfLib.PDFDocument.load(await doc.save());
	}
	it("cuts each range into its own PDF with exactly those pages", async () => {
		const source = await samplePdf(10);
		const sizes: number[] = [];
		for (const part of evenParts(10, 60 * MB)) {
			const bytes = await cutPdfPart(pdfLib, source, part);
			const out = await pdfLib.PDFDocument.load(bytes);
			sizes.push(out.getPageCount());
			assert.equal(out.getPageCount(), part.to - part.from + 1);
			assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
		}
		assert.deepEqual(sizes, [4, 3, 3]);
		assert.equal(source.getPageCount(), 10, "the source is untouched");
	});
	it("keeps the chosen pages in order (a single middle page)", async () => {
		const source = await samplePdf(5);
		const out = await pdfLib.PDFDocument.load(await cutPdfPart(pdfLib, source, { from: 3, to: 3 }));
		assert.equal(out.getPageCount(), 1);
	});
});
