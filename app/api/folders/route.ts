import { createFolder, pruneSessions } from "@/src/core";
import { listChats, readFolders, updateFolders } from "@/src/server";

export const dynamic = "force-dynamic";

/** The session folders: every folder plus which session sits in which.
 *  Placements for sessions that no longer exist are dropped on the way out. */
export async function GET() {
	const state = pruneSessions(readFolders(), new Set(listChats().map((c) => c.id)));
	return Response.json(state);
}

export async function POST(req: Request) {
	const body = (await req.json().catch(() => null)) as { name?: unknown; parentId?: unknown } | null;
	const parentId = typeof body?.parentId === "string" ? body.parentId : null;
	const id = `fld_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
	const result = updateFolders((s) => createFolder(s, body?.name, parentId, id, new Date().toISOString()));
	if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
	return Response.json({ id, ...result.state });
}
