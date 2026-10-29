import * as fs from "node:fs";
import * as path from "node:path";
import { extractOfficeText, isOfficeSourceExtension } from "../agent/tools/office-text.ts";
import { readPdfPageLimit } from "../agent/tools/source-limits.ts";
import { documentKindFor, type DocumentKind } from "../core/passage.ts";
import { sessionSourcesDir } from "./session-sources.ts";

/**
 * What the in-chat document viewer reads (owner 2026-10-29): a chat's saved
 * sources, or a file staged in the composer, shown as a PDF (bytes) or as
 * plain text (Word/PowerPoint/Excel extracted, text/Markdown as is).
 */

export type ViewKind = DocumentKind;

export interface SessionDocument {
	name: string;
	kind: ViewKind;
	size: number;
	/** A PDF limited to chosen pages (1-indexed) — the viewer shows only these. */
	pages?: number[];
}

export const viewKindFor = documentKindFor;

/** The chat's saved sources the viewer can open. Dot entries are bookkeeping. */
export function listSessionDocuments(chatId: string, root?: string): SessionDocument[] {
	const dir = sessionSourcesDir(chatId, root);
	if (!fs.existsSync(dir)) return [];
	const out: SessionDocument[] = [];
	for (const name of fs.readdirSync(dir).sort()) {
		if (name.startsWith(".")) continue;
		const kind = viewKindFor(name);
		const full = path.join(dir, name);
		if (!kind || !fs.statSync(full).isFile()) continue;
		const pages = kind === "pdf" ? readPdfPageLimit(full) : null;
		out.push({ name, kind, size: fs.statSync(full).size, ...(pages ? { pages: [...pages].sort((a, b) => a - b) } : {}) });
	}
	return out;
}

/** A saved source's path, only if it is listed (no path traversal). */
export function sessionDocumentPath(chatId: string, name: string, root?: string): string | null {
	if (!name || name !== path.basename(name) || name.startsWith(".")) return null;
	const full = path.join(sessionSourcesDir(chatId, root), name);
	return fs.existsSync(full) && fs.statSync(full).isFile() ? full : null;
}

/** The viewer's text for one file. */
export async function documentText(filePath: string): Promise<string> {
	const bytes = fs.readFileSync(filePath);
	const ext = path.extname(filePath).toLowerCase();
	if (isOfficeSourceExtension(ext)) return extractOfficeText(bytes, path.basename(filePath));
	return Buffer.from(bytes).toString("utf-8");
}

/** The PDF page numbers the viewer may show (all pages when unlimited). */
export function pdfPageLimitFor(filePath: string): number[] | null {
	const pages = readPdfPageLimit(filePath);
	return pages ? [...pages].sort((a, b) => a - b) : null;
}
