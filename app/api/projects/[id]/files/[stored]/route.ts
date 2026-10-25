import { removeProjectFile } from "@/src/server";

export const dynamic = "force-dynamic";

export async function DELETE(
	_request: Request,
	{ params }: { params: Promise<{ id: string; stored: string }> },
) {
	const { id, stored } = await params;
	const updated = removeProjectFile(id, decodeURIComponent(stored));
	if (!updated.ok) return Response.json({ error: updated.error }, { status: updated.status });
	return Response.json(updated.project);
}
