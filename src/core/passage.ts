/** A passage the learner highlighted in the document viewer (owner
 *  2026-10-29), sent to the chat as an ordinary message asking for an
 *  explanation. Pure. */

export const MAX_PASSAGE_CHARS = 2000;

export interface Passage {
	/** The source file's name. */
	name: string;
	/** The 1-indexed PDF page it sits on, when the source has pages. */
	page?: number;
	text: string;
}

/** Collapse a browser selection's whitespace; null when nothing is left. */
export function cleanSelection(raw: string): string | null {
	const text = raw.replace(/[ \t ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
	if (!text) return null;
	return text.length > MAX_PASSAGE_CHARS ? `${text.slice(0, MAX_PASSAGE_CHARS).trimEnd()}…` : text;
}

/** The chat message for a highlighted passage: a labelled blockquote. */
export function explainPassageMessage(p: Passage): string {
	const where = p.page ? `"${p.name}" (p. ${p.page})` : `"${p.name}"`;
	const quote = p.text.split("\n").map((line) => `> ${line}`).join("\n");
	return `Explain this passage from ${where}:\n\n${quote}`;
}

export type DocumentKind = "pdf" | "text";

/** Images and notebooks are not read in the viewer. */
const NOT_VIEWABLE = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ipynb"];

/** How the document viewer shows a file, or null when it cannot. */
export function documentKindFor(name: string): DocumentKind | null {
	const lower = name.toLowerCase();
	if (lower.endsWith(".pdf")) return "pdf";
	if (NOT_VIEWABLE.some((ext) => lower.endsWith(ext))) return null;
	return lower.includes(".") ? "text" : null;
}
