import { getChat, saveChatImages } from "@/src/server";

export const dynamic = "force-dynamic";

/** POST /api/chats/[id]/images — the show-your-work image upload (owner
 *  2026-10-26): multipart `file` fields, already downscaled by the
 *  client; answers the refs the next send carries. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!getChat(id)) return Response.json({ error: "Not found" }, { status: 404 });
	const form = await req.formData();
	const files = form.getAll("file").filter((value): value is File => value instanceof File);
	const saved = saveChatImages(
		id,
		await Promise.all(files.map(async (file) => ({
			name: file.name,
			mimeType: file.type,
			bytes: new Uint8Array(await file.arrayBuffer()),
		}))),
	);
	if (!saved.ok) return Response.json({ error: saved.error }, { status: saved.status });
	return Response.json({ images: saved.images });
}
