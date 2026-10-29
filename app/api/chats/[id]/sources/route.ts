import { parseSourceScope, scopeNote } from "@/src/core";
import { applySourceScope, claimUploads, getChat, listSessionDocuments, saveLessonSources, writePdfPageLimit } from "@/src/server";

export const dynamic = "force-dynamic";

/** The chat's saved sources the document viewer can open. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!getChat(id)) return Response.json({ error: "Not found" }, { status: 404 });
	return Response.json({ documents: listSessionDocuments(id) });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!getChat(id)) return Response.json({ error: "Not found" }, { status: 404 });
	const contentType = req.headers.get("content-type") ?? "";
	if (contentType.includes("application/json")) {
		const body = (await req.json().catch(() => null)) as {
			claim?: { batchId: string; stored: string; scope?: unknown }[];
		} | null;
		const claim = Array.isArray(body?.claim) ? body.claim : [];
		const claimed = claimUploads(claim);
		if (!claimed.ok) return Response.json({ error: claimed.error }, { status: claimed.status });
		// Limited sources (owner 2026-10-26): slides/sections are cut out
		// before saving; a PDF keeps its file plus a page-limit sidecar.
		const scopes = claim.map((c, i) => parseSourceScope(c.scope, claimed.files[i]?.name ?? ""));
		let files;
		try {
			files = await Promise.all(claimed.files.map((f, i) => (scopes[i] ? applySourceScope(f, scopes[i]!) : f)));
		} catch (err) {
			return Response.json({ error: err instanceof Error ? err.message : "Couldn't limit the file." }, { status: 400 });
		}
		const saved = saveLessonSources(id, files);
		if (!saved.ok) return Response.json({ error: saved.error }, { status: saved.status });
		files.forEach((f, i) => {
			const pages = (f as { pdfPages?: number[] }).pdfPages;
			if (pages) writePdfPageLimit(saved.paths[i]!, pages);
		});
		return Response.json({ paths: saved.paths, notes: scopes.map((sc) => (sc ? scopeNote(sc) : null)) });
	}
	const form = await req.formData();
	const files = form.getAll("file").filter((value): value is File => value instanceof File);
	const saved = saveLessonSources(id, await Promise.all(files.map(async (file) => ({
		name: file.name,
		bytes: new Uint8Array(await file.arrayBuffer()),
	}))));
	if (!saved.ok) return Response.json({ error: saved.error }, { status: saved.status });
	return Response.json({ paths: saved.paths });
}
