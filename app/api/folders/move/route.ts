import { placeSessions } from "@/src/core";
import { getChat, updateFolders } from "@/src/server";

export const dynamic = "force-dynamic";

/** File sessions into a folder (`folderId: null` = back to the top level). */
export async function POST(req: Request) {
	const body = (await req.json().catch(() => null)) as { chatIds?: unknown; folderId?: unknown } | null;
	const chatIds = Array.isArray(body?.chatIds) ? body.chatIds.filter((x): x is string => typeof x === "string") : [];
	if (chatIds.length === 0) return Response.json({ error: "Choose at least one session." }, { status: 400 });
	if (body?.folderId !== null && typeof body?.folderId !== "string") {
		return Response.json({ error: "folderId must be a folder id or null." }, { status: 400 });
	}
	const live = chatIds.filter((id) => getChat(id));
	const result = updateFolders((s) => placeSessions(s, live, body!.folderId as string | null));
	if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
	return Response.json({ moved: live.length, ...result.state });
}
