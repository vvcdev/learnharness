import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import yauzl from "yauzl";
import { pdfPageCount } from "../agent/subagents/pdf-ops.ts";
import { realHeadless } from "../agent/subagents/headless.ts";
import { parseRangeSpec, scopeKindFor, type SourceOutline, type SourceScope } from "../core/source-scope.ts";

/**
 * SOURCE SCOPES, server side (owner 2026-10-26): the outline a file's
 * chip picks from, the cut-out text of chosen slides/sections, and the
 * page limit a PDF carries beside it (a sidecar the pdf tools read).
 */

// ─── zip (pptx / docx) ───────────────────────────────────────────────────────

function readZipEntries(bytes: Uint8Array, want: (name: string) => boolean): Promise<Map<string, string>> {
	return new Promise((resolve, reject) => {
		yauzl.fromBuffer(Buffer.from(bytes), { lazyEntries: true }, (err, zip) => {
			if (err || !zip) return reject(err ?? new Error("Not a zip file"));
			const out = new Map<string, string>();
			zip.on("entry", (entry) => {
				if (!want(entry.fileName)) return zip.readEntry();
				zip.openReadStream(entry, (e, stream) => {
					if (e) return reject(e);
					const chunks: Buffer[] = [];
					stream.on("data", (c: Buffer) => chunks.push(c));
					stream.on("end", () => {
						out.set(entry.fileName, Buffer.concat(chunks).toString("utf-8"));
						zip.readEntry();
					});
					stream.on("error", reject);
				});
			});
			zip.on("end", () => resolve(out));
			zip.on("error", reject);
			zip.readEntry();
		});
	});
}

function decodeXml(s: string): string {
	return s
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
		.replace(/&amp;/g, "&");
}

/** Slide texts in slide-number order: each slide's paragraphs (a:p) as lines. */
async function slideTexts(bytes: Uint8Array): Promise<string[]> {
	const files = await readZipEntries(bytes, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
	return [...files.entries()]
		.sort(([a], [b]) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]))
		.map(([, xml]) =>
			(xml.match(/<a:p[ >][\s\S]*?<\/a:p>/g) ?? [])
				.map((p) => decodeXml((p.match(/<a:t>([\s\S]*?)<\/a:t>/g) ?? []).map((t) => t.replace(/<\/?a:t>/g, "")).join("")))
				.filter((line) => line.trim())
				.join("\n"),
		);
}

/** A document as paragraphs: heading level (1-9, 0 = title) or null. */
interface Para {
	level: number | null;
	text: string;
}

async function docxParagraphs(bytes: Uint8Array): Promise<Para[]> {
	const files = await readZipEntries(bytes, (n) => n === "word/document.xml");
	const xml = files.get("word/document.xml") ?? "";
	return (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).map((p) => {
		const style = p.match(/<w:pStyle w:val="([^"]+)"/)?.[1] ?? "";
		const heading = style.match(/^Heading(\d)$/i);
		const level = heading ? Number(heading[1]) : /^Title$/i.test(style) ? 0 : null;
		const text = decodeXml((p.match(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g) ?? []).map((t) => t.replace(/<\/?w:t(?: [^>]*)?>/g, "")).join(""));
		return { level, text };
	});
}

function markdownParagraphs(text: string): Para[] {
	return text.split("\n").map((line) => {
		const m = line.match(/^(#{1,6})\s+(.*)$/);
		return m ? { level: m[1]!.length, text: m[2]!.trim() } : { level: null, text: line };
	});
}

function paragraphsOf(bytes: Uint8Array, fileName: string): Promise<Para[]> {
	return fileName.toLowerCase().endsWith(".docx")
		? docxParagraphs(bytes)
		: Promise.resolve(markdownParagraphs(Buffer.from(bytes).toString("utf-8")));
}

/** Sections: each heading runs until the next heading of the same or a
 *  higher level (so a chapter includes its subsections). */
function sectionsOf(paras: Para[]): Array<{ level: number; title: string; start: number; end: number }> {
	const heads = paras.flatMap((p, i) => (p.level !== null && p.text.trim() ? [{ i, level: p.level, title: p.text.trim() }] : []));
	return heads.map((h, k) => {
		const next = heads.slice(k + 1).find((n) => n.level <= h.level);
		return { level: h.level, title: h.title, start: h.i, end: next ? next.i : paras.length };
	});
}

// ─── the public surface ──────────────────────────────────────────────────────

/** The outline a file's chip offers (pages / slides / sections). */
export async function sourceOutline(filePath: string, fileName: string): Promise<SourceOutline> {
	const kind = scopeKindFor(fileName);
	if (kind === "pages") return { kind: "pages", count: await pdfPageCount(filePath) };
	const bytes = new Uint8Array(fs.readFileSync(filePath));
	if (kind === "slides") {
		const slides = await slideTexts(bytes);
		return {
			kind: "slides",
			count: slides.length,
			titles: slides.map((s) => s.split("\n")[0]?.slice(0, 80) ?? ""),
			previews: slides.map((s) => s.slice(0, 280)),
		};
	}
	if (kind === "sections") {
		const paras = await paragraphsOf(bytes, fileName);
		return {
			kind: "sections",
			sections: sectionsOf(paras).map(({ level, title, start, end }) => ({
				level,
				title,
				preview: paras
					.slice(start, Math.min(end, start + 8))
					.map((p) => p.text)
					.filter((t) => t.trim())
					.join(" ")
					.slice(0, 220),
			})),
		};
	}
	return { kind: "none" };
}

/** One PDF page as a PNG thumbnail for the in-app scope browser. */
export async function renderPdfPreviewPage(filePath: string, page: number, dpi = 72): Promise<Uint8Array | null> {
	if (!Number.isInteger(page) || page < 1) return null;
	const rendered = await realHeadless.renderPdfPages(filePath, [page], { dpi });
	const png = rendered[0]?.png;
	return png ?? null;
}

/** A limited file, ready to save: slides/sections become a Markdown cut
 *  (the rest never reaches the session); a PDF stays whole and its page
 *  list rides back for the sidecar. Throws a learner-readable error. */
export async function applySourceScope(
	file: { name: string; bytes: Uint8Array },
	scope: SourceScope,
): Promise<{ name: string; bytes: Uint8Array; pdfPages?: number[] }> {
	const stem = file.name.replace(/\.[^.]+$/, "");
	if (scope.kind === "pages") {
		const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lh-scope-")), "f.pdf");
		fs.writeFileSync(tmp, file.bytes);
		try {
			const parsed = parseRangeSpec(scope.spec, await pdfPageCount(tmp));
			if ("error" in parsed) throw new Error(`${file.name}: ${parsed.error}`);
			return { ...file, pdfPages: parsed.pages };
		} finally {
			fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
		}
	}
	if (scope.kind === "slides") {
		const slides = await slideTexts(file.bytes);
		const parsed = parseRangeSpec(scope.spec, slides.length);
		if ("error" in parsed) throw new Error(`${file.name}: ${parsed.error}`);
		const body = parsed.pages.map((n) => `## Slide ${n}\n\n${slides[n - 1]}`).join("\n\n");
		return { name: `${stem} (slides ${scope.spec}).md`, bytes: new TextEncoder().encode(`# ${file.name} — slides ${scope.spec}\n\n${body}\n`) };
	}
	const paras = await paragraphsOf(file.bytes, file.name);
	const sections = sectionsOf(paras);
	const chosen = [...new Set(scope.sections)].filter((i) => sections[i]).sort((a, b) => a - b);
	if (chosen.length === 0) throw new Error(`${file.name}: pick at least one section.`);
	// Overlapping picks (a chapter and its subsection) keep each line once.
	const keep = new Set<number>();
	for (const i of chosen) for (let p = sections[i]!.start; p < sections[i]!.end; p++) keep.add(p);
	const body = [...keep]
		.sort((a, b) => a - b)
		.map((i) => {
			const p = paras[i]!;
			return p.level !== null ? `${"#".repeat(Math.min(6, Math.max(1, p.level + 1)))} ${p.text}` : p.text;
		})
		.join("\n\n");
	return { name: `${stem} (sections).md`, bytes: new TextEncoder().encode(`# ${file.name} — chosen sections\n\n${body}\n`) };
}

export { readPdfPageLimit, writePdfPageLimit } from "../agent/tools/source-limits.ts";
