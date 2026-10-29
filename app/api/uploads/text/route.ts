import { documentText, stagedUploadPath, viewKindFor } from "@/src/server";

export const dynamic = "force-dynamic";

/** GET /api/uploads/text?batch=…&stored=… — a composer-staged file as plain text. */
export async function GET(req: Request) {
	const url = new URL(req.url);
	const staged = stagedUploadPath(url.searchParams.get("batch") ?? "", url.searchParams.get("stored") ?? "");
	if (!staged) return Response.json({ error: "Upload not found." }, { status: 404 });
	if (viewKindFor(staged.name) !== "text") return Response.json({ error: "Open PDFs as files." }, { status: 400 });
	try {
		return Response.json({ text: await documentText(staged.path) });
	} catch (err) {
		return Response.json({ error: err instanceof Error ? err.message : "Couldn't read that file." }, { status: 422 });
	}
}
