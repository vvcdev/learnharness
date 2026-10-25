import { applyProjectToSession, getChat } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!getChat(id)) return Response.json({ error: "Not found" }, { status: 404 });
	const body = (await request.json().catch(() => ({}))) as { projectId?: string };
	const applied = applyProjectToSession(id, body.projectId);
	if (!applied.ok) return Response.json({ error: applied.error }, { status: applied.status });
	return Response.json({
		paths: applied.paths,
		instructions: applied.instructions,
		projectId: applied.projectId,
	});
}
