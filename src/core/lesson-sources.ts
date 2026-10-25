/** Files a learner attaches to one lesson. The teacher reads the saved
 * paths with the tools it already has. Nothing here touches the graph. */

export const LESSON_SOURCE_EXTENSIONS = [".pdf", ".txt", ".md", ".markdown", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"] as const;

export const LESSON_SOURCE_ACCEPT = LESSON_SOURCE_EXTENSIONS.join(",");

export const MAX_LESSON_SOURCES = 8;

export const MAX_LESSON_SOURCE_BYTES = 25 * 1024 * 1024;

const EXTENSIONS = new Set<string>(LESSON_SOURCE_EXTENSIONS);

/** The lowercased extension, or null when this name is not a lesson source. */
export function lessonSourceExtension(name: string): string | null {
	const base = name.split(/[/\\]/).pop() ?? "";
	const dot = base.lastIndexOf(".");
	if (dot <= 0) return null;
	const ext = base.slice(dot).toLowerCase();
	return EXTENSIONS.has(ext) ? ext : null;
}

/** Why this file cannot be attached, or null when it can. `already` is how
 * many sources the lesson already holds before this one. */
export function lessonSourceError(name: string, bytes: number, already: number): string | null {
	if (already >= MAX_LESSON_SOURCES) return `A lesson can hold ${MAX_LESSON_SOURCES} sources.`;
	if (!lessonSourceExtension(name)) return "Attach a PDF, text, Markdown, or image file.";
	if (!Number.isFinite(bytes) || bytes <= 0) return "That file is empty.";
	if (bytes > MAX_LESSON_SOURCE_BYTES) return "Each source must be 25 MB or smaller.";
	return null;
}

/** The learner's words plus the saved paths the teacher should read. */
export function appendLessonSources(text: string, paths: readonly string[]): string {
	const opening = text.trim() || (paths.length > 0 ? "Teach me from these sources." : "");
	if (paths.length === 0) return opening;
	const lines = paths.map((p) => `- ${p}`).join("\n");
	return `${opening}\n\nSources for this lesson. Read them and teach from them. Use the pdf tool for PDFs and the read tool for everything else:\n${lines}`;
}
