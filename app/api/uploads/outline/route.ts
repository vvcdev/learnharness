import { sourceOutline, stagedUploadPath } from "@/src/server";

export const dynamic = "force-dynamic";

/** GET /api/uploads/outline?batch=…&stored=… — a staged file's pages,
 *  slides, or sections (owner 2026-10-26): what its chip's scope picker
 *  offers before the file is claimed into a session. */
export async function GET(req: Request) {
	const url = new URL(req.url);
	const staged = stagedUploadPath(url.searchParams.get("batch") ?? "", url.searchParams.get("stored") ?? "");
	if (!staged) return Response.json({ error: "Upload not found." }, { status: 404 });
	try {
		return Response.json(await sourceOutline(staged.path, staged.name));
	} catch {
		return Response.json({ error: "Couldn't read this file's pages or sections." }, { status: 422 });
	}
}
