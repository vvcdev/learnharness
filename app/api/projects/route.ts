import { claimUploads, createProject, listProjects } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json(listProjects());
}

export async function POST(request: Request) {
	const contentType = request.headers.get("content-type") ?? "";
	if (contentType.includes("application/json")) {
		const body = (await request.json().catch(() => null)) as {
			name?: string;
			instructions?: string;
			claim?: { batchId: string; stored: string }[];
		} | null;
		const claimed = body?.claim?.length
			? claimUploads(body.claim)
			: { ok: true as const, files: [] };
		if (!claimed.ok) return Response.json({ error: claimed.error }, { status: claimed.status });
		const created = createProject({
			name: String(body?.name ?? ""),
			instructions: String(body?.instructions ?? ""),
			files: claimed.files,
		});
		if (!created.ok) return Response.json({ error: created.error }, { status: created.status });
		return Response.json(created.project);
	}
	const form = await request.formData();
	const name = String(form.get("name") ?? "");
	const instructions = String(form.get("instructions") ?? "");
	const files = form.getAll("file").filter((value): value is File => value instanceof File);
	const created = createProject({
		name,
		instructions,
		files: await Promise.all(files.map(async (file) => ({
			name: file.name,
			bytes: new Uint8Array(await file.arrayBuffer()),
		}))),
	});
	if (!created.ok) return Response.json({ error: created.error }, { status: created.status });
	return Response.json(created.project);
}
