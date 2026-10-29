import * as fs from "node:fs";
import { getChat, sessionDocumentPath, viewKindFor } from "@/src/server";

export const dynamic = "force-dynamic";

/** GET /api/chats/:id/sources/file?name=… — a saved PDF's bytes for the
 *  document viewer (the learner's own file; a page limit only narrows what
 *  the agent reads). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!getChat(id)) return Response.json({ error: "Not found" }, { status: 404 });
	const name = new URL(req.url).searchParams.get("name") ?? "";
	const file = sessionDocumentPath(id, name);
	if (!file) return Response.json({ error: "File not found." }, { status: 404 });
	if (viewKindFor(name) !== "pdf") return Response.json({ error: "Only PDFs are served as files." }, { status: 400 });
	return new Response(fs.readFileSync(file), { headers: { "Content-Type": "application/pdf", "Cache-Control": "private, max-age=60" } });
}
