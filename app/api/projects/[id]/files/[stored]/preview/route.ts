import { scopeKindFor } from "@/src/core";
import { projectFilePath, renderPdfPreviewPage } from "@/src/server";

export const dynamic = "force-dynamic";

/** GET /api/projects/[id]/files/[stored]/preview?page=N — PNG of one
 *  PDF page for the in-app scope browser. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; stored: string }> }) {
	const { id, stored } = await params;
	const file = projectFilePath(id, decodeURIComponent(stored));
	if (!file) return Response.json({ error: "Project file not found." }, { status: 404 });
	if (scopeKindFor(file.name) !== "pages") {
		return Response.json({ error: "Only PDF pages can be previewed as images." }, { status: 400 });
	}
	const page = Number(new URL(req.url).searchParams.get("page"));
	if (!Number.isInteger(page) || page < 1) {
		return Response.json({ error: "Pass a page number (1, 2, …)." }, { status: 400 });
	}
	try {
		const png = await renderPdfPreviewPage(file.path, page);
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
