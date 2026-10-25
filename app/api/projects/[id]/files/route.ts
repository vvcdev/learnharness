import { addProjectFiles } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const form = await request.formData();
	const files = form.getAll("file").filter((value): value is File => value instanceof File);
	const updated = addProjectFiles(id, await Promise.all(files.map(async (file) => ({
		name: file.name,
		bytes: new Uint8Array(await file.arrayBuffer()),
	}))));
	if (!updated.ok) return Response.json({ error: updated.error }, { status: updated.status });
	return Response.json(updated.project);
}
