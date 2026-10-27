import { fetchYoutubeSource, stageUploads, YoutubeError } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
	const body = (await req.json().catch(() => null)) as { url?: unknown } | null;
	if (typeof body?.url !== "string" || !body.url.trim()) {
		return Response.json({ error: "Paste a YouTube link." }, { status: 400 });
	}
	let source;
	try {
		source = await fetchYoutubeSource(body.url);
	} catch (error) {
		if (error instanceof YoutubeError) return Response.json({ error: error.message }, { status: error.status });
		return Response.json({ error: "Could not read that video." }, { status: 500 });
	}
	const staged = stageUploads([source]);
	if (!staged.ok) return Response.json({ error: staged.error }, { status: staged.status });
	return Response.json({ ...staged.batch, size: source.bytes.byteLength });
}
