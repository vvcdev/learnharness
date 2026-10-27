import { deleteChatSession, type ChatDeleteMode } from "@/src/server";

export const dynamic = "force-dynamic";

/** Delete several sessions at once (multi-select). Each goes through the
 *  same per-session deletion as the single route, so its safety checks hold:
 *  a session with a running turn or running jobs is SKIPPED and reported,
 *  never force-deleted. `mode` applies to every session. */
export async function POST(req: Request) {
	const body = (await req.json().catch(() => null)) as { ids?: unknown; mode?: unknown } | null;
	const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.filter((x): x is string => typeof x === "string"))] : [];
	if (ids.length === 0) return Response.json({ error: "Choose at least one session." }, { status: 400 });
	if (ids.length > 200) return Response.json({ error: "Choose 200 sessions or fewer at a time." }, { status: 400 });
	const mode = body?.mode;
	if (mode !== "preserve-graph" && mode !== "delete-nodes") {
		return Response.json({ error: 'mode must be "preserve-graph" or "delete-nodes"' }, { status: 400 });
	}
	const deleted: string[] = [];
	const failed: { id: string; code: string; error: string }[] = [];
	let graphRevision = 0;
	// Sequential on purpose: each deletion is a synchronous purge behind a
	// possible extraction wind-down; parallel purges would fight over the ledgers.
	for (const id of ids) {
		const outcome = await deleteChatSession(id, mode as ChatDeleteMode);
		if (outcome.ok) {
			deleted.push(id);
			graphRevision = outcome.graphRevision;
		} else if (outcome.code !== "not_found") {
			failed.push({ id, code: outcome.code, error: outcome.error });
		} else {
			deleted.push(id); // already gone — the goal state
		}
	}
	return Response.json({ deleted, failed, graphRevision });
}
