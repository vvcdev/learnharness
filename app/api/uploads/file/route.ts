import * as fs from "node:fs";
import { stagedUploadPath, viewKindFor } from "@/src/server";

export const dynamic = "force-dynamic";

/** GET /api/uploads/file?batch=…&stored=… — a composer-staged PDF's bytes,
 *  so the document viewer can open it before it is sent. */
export async function GET(req: Request) {
	const url = new URL(req.url);
	const staged = stagedUploadPath(url.searchParams.get("batch") ?? "", url.searchParams.get("stored") ?? "");
	if (!staged) return Response.json({ error: "Upload not found." }, { status: 404 });
	if (viewKindFor(staged.name) !== "pdf") return Response.json({ error: "Only PDFs are served as files." }, { status: 400 });
	return new Response(fs.readFileSync(staged.path), { headers: { "Content-Type": "application/pdf", "Cache-Control": "private, max-age=60" } });
}
