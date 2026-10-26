import { applyProjectFilesToSession, applyProjectToSession, getChat } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!getChat(id)) return Response.json({ error: "Not found" }, { status: 404 });
	const body = (await request.json().catch(() => ({}))) as {
		projectId?: string;
		files?: Array<{ stored: string; scope?: unknown }>;
	};
	// @-mentioned files (owner 2026-10-26): only those, with their limits.
	if (Array.isArray(body.files) && body.files.length > 0 && body.projectId) {
		const picked = await applyProjectFilesToSession(id, body.projectId, body.files.filter((f) => typeof f?.stored === "string"));
		if (!picked.ok) return Response.json({ error: picked.error }, { status: picked.status });
		return Response.json({ paths: picked.paths, notes: picked.notes, instructions: picked.instructions, projectId: picked.projectId });
	}
	const applied = applyProjectToSession(id, body.projectId);
	if (!applied.ok) return Response.json({ error: applied.error }, { status: applied.status });
	return Response.json({
		paths: applied.paths,
		instructions: applied.instructions,
		projectId: applied.projectId,
	});
}
