import { chatImageMimeType, readChatImage } from "@/src/server";

export const dynamic = "force-dynamic";

/** GET /api/chats/[id]/images/[image] — one stored image (thumbnails and
 *  the lightbox). Ids are immutable, so the browser may cache forever. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; image: string }> }) {
	const { id, image } = await params;
	const mimeType = chatImageMimeType(image);
	const bytes = mimeType ? readChatImage(id, image) : null;
	if (!bytes || !mimeType) return new Response("Not found", { status: 404 });
	return new Response(bytes as BodyInit, {
		headers: { "Content-Type": mimeType, "Cache-Control": "private, max-age=31536000, immutable" },
	});
}
