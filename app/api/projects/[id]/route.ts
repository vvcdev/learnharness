import { deleteProject, getProject, updateProjectMeta } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const project = getProject(id);
	if (!project) return Response.json({ error: "Not found" }, { status: 404 });
	return Response.json(project);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const body = (await request.json().catch(() => ({}))) as { name?: string; instructions?: string };
	const updated = updateProjectMeta(id, body);
	if (!updated.ok) return Response.json({ error: updated.error }, { status: updated.status });
	return Response.json(updated.project);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const result = deleteProject(id);
	if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
	return Response.json({ ok: true });
}
