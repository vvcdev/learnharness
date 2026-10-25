import { setActiveProject } from "@/src/server";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
	const body = (await request.json().catch(() => ({}))) as { id?: string | null };
	const id = body.id === null || body.id === undefined || body.id === "" ? null : body.id;
	const result = setActiveProject(id);
	if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
	return Response.json({ activeId: result.activeId });
}
