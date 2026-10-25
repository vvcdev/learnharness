import { addProjectFiles, claimUploads } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const contentType = request.headers.get("content-type") ?? "";
	if (contentType.includes("application/json")) {
		const body = (await request.json().catch(() => null)) as { claim?: { batchId: string; stored: string }[] } | null;
		const claim = Array.isArray(body?.claim) ? body.claim : [];
		const claimed = claimUploads(claim);
		if (!claimed.ok) return Response.json({ error: claimed.error }, { status: claimed.status });
		const updated = addProjectFiles(id, claimed.files);
		if (!updated.ok) return Response.json({ error: updated.error }, { status: updated.status });
		return Response.json(updated.project);
	}
	const form = await request.formData();
	const files = form.getAll("file").filter((value): value is File => value instanceof File);
	const updated = addProjectFiles(id, await Promise.all(files.map(async (file) => ({
		name: file.name,
		bytes: new Uint8Array(await file.arrayBuffer()),
	}))));
	if (!updated.ok) return Response.json({ error: updated.error }, { status: updated.status });
	return Response.json(updated.project);
}
