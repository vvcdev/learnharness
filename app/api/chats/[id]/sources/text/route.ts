import { documentText, getChat, sessionDocumentPath, viewKindFor } from "@/src/server";

export const dynamic = "force-dynamic";

/** GET /api/chats/:id/sources/text?name=… — a saved source as plain text
 *  (Word/PowerPoint/Excel extracted) for the document viewer. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!getChat(id)) return Response.json({ error: "Not found" }, { status: 404 });
	const name = new URL(req.url).searchParams.get("name") ?? "";
	const file = sessionDocumentPath(id, name);
	if (!file) return Response.json({ error: "File not found." }, { status: 404 });
	if (viewKindFor(name) !== "text") return Response.json({ error: "Open PDFs as files." }, { status: 400 });
	try {
		return Response.json({ text: await documentText(file) });
	} catch (err) {
		return Response.json({ error: err instanceof Error ? err.message : "Couldn't read that file." }, { status: 422 });
	}
}
