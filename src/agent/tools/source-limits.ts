import * as fs from "node:fs";
import * as path from "node:path";

/**
 * A PDF source's page limit (owner 2026-10-26): written beside the saved
 * file when the learner limits it to chosen pages; the pdf reader and the
 * read tool consult it so nothing outside those pages is ever served.
 * The sidecar lives at <session dir>/.scopes/<file>.json.
 */

/** Where a saved PDF's page limit lives: <session dir>/.scopes/<file>.json. */
function sidecarPath(filePath: string): string {
	return path.join(path.dirname(filePath), ".scopes", `${path.basename(filePath)}.json`);
}

export function writePdfPageLimit(filePath: string, pages: number[]): void {
	fs.mkdirSync(path.dirname(sidecarPath(filePath)), { recursive: true });
	fs.writeFileSync(sidecarPath(filePath), JSON.stringify({ pages }));
}

/** The pages a PDF is limited to, or null (no limit). */
export function readPdfPageLimit(filePath: string): Set<number> | null {
	try {
		const raw = JSON.parse(fs.readFileSync(sidecarPath(path.resolve(filePath)), "utf-8")) as { pages?: unknown };
		return Array.isArray(raw.pages) ? new Set(raw.pages.filter((n): n is number => Number.isInteger(n))) : null;
	} catch {
		return null;
	}
}
