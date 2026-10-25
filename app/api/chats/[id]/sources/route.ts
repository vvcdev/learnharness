import { claimUploads, getChat, saveLessonSources } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!getChat(id)) return Response.json({ error: "Not found" }, { status: 404 });
	const contentType = req.headers.get("content-type") ?? "";
	if (contentType.includes("application/json")) {
		const body = (await req.json().catch(() => null)) as { claim?: { batchId: string; stored: string }[] } | null;
		const claim = Array.isArray(body?.claim) ? body.claim : [];
		const claimed = claimUploads(claim);
		if (!claimed.ok) return Response.json({ error: claimed.error }, { status: claimed.status });
		const saved = saveLessonSources(id, claimed.files);
		if (!saved.ok) return Response.json({ error: saved.error }, { status: saved.status });
		return Response.json({ paths: saved.paths });
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
