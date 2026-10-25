import { createProject, listProjects } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json(listProjects());
}

export async function POST(request: Request) {
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
