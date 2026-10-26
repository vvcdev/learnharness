/**
 * Source scopes (owner 2026-10-26): range parsing, the outline a chip
 * offers, the hard cut of slides/sections, the PDF page-limit sidecar,
 * and the source-list note the agent reads.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { crc32 } from "node:zlib";
import { describe, it } from "node:test";
import { formatPages, parseRangeSpec, parseSourceScope, scopeKindFor, scopeNote } from "../src/core/source-scope.ts";
import { appendLessonSources } from "../src/core/lesson-sources.ts";
import { applySourceScope, readPdfPageLimit, sourceOutline, writePdfPageLimit } from "../src/server/source-scope.ts";

/** A minimal stored (uncompressed) zip — enough for docx/pptx fixtures. */
function zip(files: Record<string, string>): Uint8Array {
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	for (const [name, text] of Object.entries(files)) {
		const data = Buffer.from(text, "utf-8");
		const nameBuf = Buffer.from(name);
		const crc = crc32(data);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(data.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(nameBuf.length, 26);
		locals.push(local, nameBuf, data);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(data.length, 20);
		central.writeUInt32LE(data.length, 24);
		central.writeUInt16LE(nameBuf.length, 28);
		central.writeUInt32LE(offset, 42);
		centrals.push(central, nameBuf);
		offset += 30 + nameBuf.length + data.length;
	}
	const cd = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(Object.keys(files).length, 8);
	end.writeUInt16LE(Object.keys(files).length, 10);
	end.writeUInt32LE(cd.length, 12);
	end.writeUInt32LE(offset, 16);
	return new Uint8Array(Buffer.concat([...locals, cd, end]));
}

const slide = (text: string) => `<p:sld><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sld>`;
const para = (text: string, style?: string) =>
	`<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t>${text}</w:t></w:r></w:p>`;

const pptx = zip({
	"ppt/slides/slide1.xml": slide("Intro"),
	"ppt/slides/slide2.xml": slide("Kinematics &amp; motion"),
	"ppt/slides/slide10.xml": slide("Summary"),
});
const docx = zip({
	"word/document.xml": `<w:document><w:body>${[
		para("Chapter 1", "Heading1"),
		para("Alpha text"),
		para("1.1 Detail", "Heading2"),
		para("Detail text"),
		para("Chapter 2", "Heading1"),
		para("Beta text"),
	].join("")}</w:body></w:document>`,
});

function tmpFile(name: string, bytes: Uint8Array): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-scope-test-"));
	const p = path.join(dir, name);
	fs.writeFileSync(p, bytes);
	return p;
}

describe("ranges", () => {
	it("parse strictly against the file and format back", () => {
		assert.deepEqual(parseRangeSpec("3-5, 9", 10), { pages: [3, 4, 5, 9] });
		assert.ok("error" in parseRangeSpec("8-12", 10));
		assert.ok("error" in parseRangeSpec("abc", 10));
		assert.equal(formatPages([1, 2, 3, 7, 9, 10]), "1–3, 7, 9–10");
	});
	it("know which files can be limited", () => {
		assert.equal(scopeKindFor("a.PDF"), "pages");
		assert.equal(scopeKindFor("deck.pptx"), "slides");
		assert.equal(scopeKindFor("notes.docx"), "sections");
		assert.equal(scopeKindFor("notes.md"), "sections");
		assert.equal(scopeKindFor("data.csv"), null);
		assert.equal(parseSourceScope({ kind: "slides", spec: "1" }, "a.pdf"), null, "the kind must match the file");
	});
});

describe("slides", () => {
	it("outline in slide-number order and cut only the chosen ones", async () => {
		const outline = await sourceOutline(tmpFile("deck.pptx", pptx), "deck.pptx");
		assert.deepEqual(outline, { kind: "slides", count: 3, titles: ["Intro", "Kinematics & motion", "Summary"] });
		const cut = await applySourceScope({ name: "deck.pptx", bytes: pptx }, { kind: "slides", spec: "2" });
		const text = Buffer.from(cut.bytes).toString();
		assert.equal(cut.name, "deck (slides 2).md");
		assert.match(text, /Kinematics & motion/);
		assert.doesNotMatch(text, /Intro|Summary/);
	});
	it("refuses a range outside the deck", async () => {
		await assert.rejects(applySourceScope({ name: "deck.pptx", bytes: pptx }, { kind: "slides", spec: "4" }), /outside/);
	});
});

describe("sections", () => {
	it("outline headings; a chapter includes its subsections, nothing else survives", async () => {
		const outline = await sourceOutline(tmpFile("n.docx", docx), "n.docx");
		assert.deepEqual(outline, {
			kind: "sections",
			sections: [
				{ level: 1, title: "Chapter 1" },
				{ level: 2, title: "1.1 Detail" },
				{ level: 1, title: "Chapter 2" },
			],
		});
		const cut = await applySourceScope({ name: "n.docx", bytes: docx }, { kind: "sections", sections: [0], titles: ["Chapter 1"] });
		const text = Buffer.from(cut.bytes).toString();
		assert.match(text, /Alpha text/);
		assert.match(text, /Detail text/);
		assert.doesNotMatch(text, /Beta text/);
	});
	it("works on Markdown headings too", async () => {
		const md = new TextEncoder().encode("# A\none\n## A.1\ntwo\n# B\nthree\n");
		const cut = await applySourceScope({ name: "x.md", bytes: md }, { kind: "sections", sections: [1], titles: ["A.1"] });
		const text = Buffer.from(cut.bytes).toString();
		assert.match(text, /two/);
		assert.doesNotMatch(text, /one|three/);
	});
});

describe("PDF page limits and the source list", () => {
	it("the sidecar round-trips beside the saved file", () => {
		const file = tmpFile("doc.pdf", new Uint8Array([37, 80, 68, 70]));
		assert.equal(readPdfPageLimit(file), null);
		writePdfPageLimit(file, [3, 4, 9]);
		assert.deepEqual([...readPdfPageLimit(file)!], [3, 4, 9]);
	});
	it("a limited line carries the note and the guidance rides along", () => {
		const line = `/s/doc.pdf — ${scopeNote({ kind: "pages", spec: "3-4" })}`;
		const text = appendLessonSources("quiz me", [line, "/s/other.txt"]);
		assert.match(text, /LIMITED TO pages 3-4/);
		assert.match(text, /Work ONLY from those parts/);
		assert.match(text, /ask the learner/);
		assert.doesNotMatch(appendLessonSources("quiz me", ["/s/other.txt"]), /Work ONLY/);
	});
});
