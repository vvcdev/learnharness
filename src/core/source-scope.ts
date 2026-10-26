/**
 * SOURCE SCOPES (owner 2026-10-26): limit an attached file to chosen
 * PDF pages, PowerPoint slides, or Word/Markdown sections. A HARD limit —
 * slides and sections are cut out at attach time (the session stores only
 * them, as Markdown); a PDF keeps its file but the pdf tools only ever
 * return the chosen pages. The agent sees the limit in the source list
 * and fills gaps from its own knowledge, asking the learner when it can't.
 * Pure, browser-safe.
 */

export type SourceScope =
	| { kind: "pages"; spec: string }
	| { kind: "slides"; spec: string }
	/** Indices into the file's section outline, plus their titles (display). */
	| { kind: "sections"; sections: number[]; titles: string[] };

export type ScopeKind = SourceScope["kind"];

/** Which kind of limit a file supports (null: always used whole). */
export function scopeKindFor(fileName: string): ScopeKind | null {
	const ext = fileName.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
	if (ext === ".pdf") return "pages";
	if (ext === ".pptx") return "slides";
	if (ext === ".docx" || ext === ".md" || ext === ".markdown") return "sections";
	return null;
}

/** Validate a scope off a request (shape only — ranges are checked
 *  against the file when it is cut). Null: no limit / wrong kind. */
export function parseSourceScope(value: unknown, fileName: string): SourceScope | null {
	if (!value || typeof value !== "object") return null;
	const v = value as Record<string, unknown>;
	const kind = scopeKindFor(fileName);
	if (v.kind !== kind) return null;
	if ((kind === "pages" || kind === "slides") && typeof v.spec === "string" && v.spec.trim()) {
		return { kind, spec: v.spec.trim().slice(0, 200) };
	}
	if (kind === "sections" && Array.isArray(v.sections) && Array.isArray(v.titles)) {
		const sections = v.sections.filter((n): n is number => Number.isInteger(n) && n >= 0).slice(0, 200);
		const titles = v.titles.filter((t): t is string => typeof t === "string").map((t) => t.slice(0, 120)).slice(0, 200);
		return sections.length > 0 ? { kind, sections, titles } : null;
	}
	return null;
}

/** A file's outline, for the chip's picker. */
export type SourceOutline =
	| { kind: "pages"; count: number }
	| { kind: "slides"; count: number; titles: string[] }
	| { kind: "sections"; sections: Array<{ level: number; title: string }> }
	| { kind: "none" };

/** Parse "3-7, 12" against 1..max — strict: every token must be a page
 *  or an ascending range inside the file. Returns the sorted numbers or
 *  the reason it can't. */
export function parseRangeSpec(spec: string, max: number): { pages: number[] } | { error: string } {
	const pages = new Set<number>();
	const tokens = spec.split(",").map((t) => t.trim()).filter(Boolean);
	if (tokens.length === 0) return { error: "Enter pages like 3-7, 12." };
	for (const token of tokens) {
		const m = token.match(/^(\d+)\s*(?:[-–]\s*(\d+))?$/);
		if (!m) return { error: `"${token}" isn't a page or range.` };
		const start = Number(m[1]);
		const end = m[2] === undefined ? start : Number(m[2]);
		if (start < 1 || end > max || start > end) return { error: `${token} is outside 1–${max}.` };
		for (let p = start; p <= end; p++) pages.add(p);
	}
	return { pages: [...pages].sort((a, b) => a - b) };
}

/** "3–7, 12" from a page list (runs collapsed). */
export function formatPages(pages: readonly number[]): string {
	const out: string[] = [];
	for (let i = 0; i < pages.length; i++) {
		let j = i;
		while (j + 1 < pages.length && pages[j + 1] === pages[j]! + 1) j++;
		out.push(j > i ? `${pages[i]}–${pages[j]}` : `${pages[i]}`);
		i = j;
	}
	return out.join(", ");
}

/** The chip's short label: "p. 3–7, 12" · "slides 1–4" · "2 sections". */
export function scopeChipLabel(scope: SourceScope): string {
	if (scope.kind === "pages") return `p. ${scope.spec}`;
	if (scope.kind === "slides") return `slides ${scope.spec}`;
	return scope.sections.length === 1 ? scope.titles[0] ?? "1 section" : `${scope.sections.length} sections`;
}

/** The phrase the agent reads beside a limited source. */
export const SCOPED_SOURCE_MARK = "LIMITED TO";

export function scopeNote(scope: SourceScope): string {
	const plural = /[,\-–]/.test("spec" in scope ? scope.spec : "");
	if (scope.kind === "pages") return `${SCOPED_SOURCE_MARK} ${plural ? "pages" : "page"} ${scope.spec} — no other page of this file is available`;
	if (scope.kind === "slides") return `${SCOPED_SOURCE_MARK} ${plural ? "slides" : "slide"} ${scope.spec} (extracted as text) — no other slide is available`;
	return `${SCOPED_SOURCE_MARK} the sections ${scope.titles.map((t) => `"${t}"`).join(", ")} (extracted as text) — nothing else in the document is available`;
}

/** The instruction that rides any source list with a limited file. */
export const SCOPED_SOURCES_GUIDANCE =
	"Some sources are limited to chosen pages, slides, or sections. Work ONLY from those parts: every explanation, question, and problem must come from that content, never from the rest of the file. If something in them can't be understood without context they don't contain, fill the gap from your own knowledge and say that you did; if you can't, ask the learner.";
