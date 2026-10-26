import { scopeKindFor } from "@/src/core";
import { renderPdfPreviewPage, stagedUploadPath } from "@/src/server";

export const dynamic = "force-dynamic";

/** GET /api/uploads/preview?batch=…&stored=…&page=N — PNG of one PDF page
 *  for the in-app scope browser (owner 2026-10-26). */
export async function GET(req: Request) {
	const url = new URL(req.url);
	const staged = stagedUploadPath(url.searchParams.get("batch") ?? "", url.searchParams.get("stored") ?? "");
	if (!staged) return Response.json({ error: "Upload not found." }, { status: 404 });
	if (scopeKindFor(staged.name) !== "pages") {
		return Response.json({ error: "Only PDF pages can be previewed as images." }, { status: 400 });
	}
	const page = Number(url.searchParams.get("page"));
	if (!Number.isInteger(page) || page < 1) {
		return Response.json({ error: "Pass a page number (1, 2, …)." }, { status: 400 });
	}
	try {
		const png = await renderPdfPreviewPage(staged.path, page);
		if (!png) return Response.json({ error: "That page isn't in this file." }, { status: 404 });
		return new Response(Buffer.from(png), {
			headers: {
				"Content-Type": "image/png",
				"Cache-Control": "private, max-age=3600",
			},
		});
	} catch {
		return Response.json({ error: "Couldn't render that page." }, { status: 422 });
	}
}
