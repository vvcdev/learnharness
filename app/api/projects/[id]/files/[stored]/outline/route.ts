import { projectFilePath, sourceOutline } from "@/src/server";

export const dynamic = "force-dynamic";

/** GET /api/projects/[id]/files/[stored]/outline — a project file's pages,
 *  slides, or sections (owner 2026-10-26): what an @-mentioned file's
 *  scope picker offers. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; stored: string }> }) {
	const { id, stored } = await params;
	const file = projectFilePath(id, decodeURIComponent(stored));
	if (!file) return Response.json({ error: "Project file not found." }, { status: 404 });
	try {
		return Response.json(await sourceOutline(file.path, file.name));
	} catch {
		return Response.json({ error: "Couldn't read this file's pages or sections." }, { status: 422 });
	}
}
