import { parsePracticeSettings } from "@/src/core";
import { getChat, stores } from "@/src/server";

/** PUT /api/chats/[id]/practice — switch a practice session's format
 *  (owner 2026-10-26): replace-whole, validated; the next item the agent
 *  poses follows it (the practice tools read the record per turn). */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const chat = getChat(id);
	if (!chat) return Response.json({ error: "Not found" }, { status: 404 });
	if (chat.kind !== "practice") return Response.json({ error: "Not a practice session" }, { status: 400 });
	const body = await req.json().catch(() => null);
	const practice = parsePracticeSettings(body);
	stores.chatStore.savePractice(id, practice);
	return Response.json({ practice });
}
