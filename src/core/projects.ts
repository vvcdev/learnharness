/** Saved project packs: a named set of copied files + standing instructions
 *  that a lesson can use as context. Browser-safe types and prompt helpers. */

import { appendLessonSources } from "./lesson-sources.ts";

export const MAX_PROJECT_NAME = 80;
export const MAX_PROJECT_INSTRUCTIONS = 20_000;

export interface ProjectSummary {
	id: string;
	name: string;
	fileCount: number;
	updatedAt: number;
}

export interface ProjectFileMeta {
	/** Display / original basename. */
	name: string;
	/** Filename on disk under the pack's files/ folder. */
	stored: string;
}

export interface ProjectDetail extends ProjectSummary {
	instructions: string;
	files: ProjectFileMeta[];
}

/** Why this name cannot be saved, or null when it can. */
export function projectNameError(name: string): string | null {
	const trimmed = name.trim();
	if (!trimmed) return "Name this project.";
	if (trimmed.length > MAX_PROJECT_NAME) return `Keep the name under ${MAX_PROJECT_NAME} characters.`;
	return null;
}

/** Why these instructions cannot be saved, or null when they can. */
export function projectInstructionsError(instructions: string): string | null {
	if (instructions.length > MAX_PROJECT_INSTRUCTIONS) {
		return `Keep instructions under ${MAX_PROJECT_INSTRUCTIONS.toLocaleString()} characters.`;
	}
	return null;
}

/** Opening text plus standing instructions and saved file paths. */
export function appendProjectContext(
	text: string,
	instructions: string,
	paths: readonly string[],
): string {
	const instr = instructions.trim();
	let opening = text.trim();
	if (instr) {
		const block = `Project instructions:\n${instr}`;
		opening = opening ? `${opening}\n\n${block}` : block;
	}
	if (paths.length === 0) {
		return opening || (instr ? "Teach me from this project." : "");
	}
	return appendLessonSources(opening || "Teach me from this project.", paths);
}
