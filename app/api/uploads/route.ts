import { stageUploads } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
	const form = await req.formData();
	const files = form.getAll("file").filter((value): value is File => value instanceof File);
	const staged = stageUploads(await Promise.all(files.map(async (file) => ({
		name: file.name,
		bytes: new Uint8Array(await file.arrayBuffer()),
	}))));
	if (!staged.ok) return Response.json({ error: staged.error }, { status: staged.status });
	return Response.json(staged.batch);
}
