import { deleteFolder, moveFolder, renameFolder } from "@/src/core";
import { updateFolders } from "@/src/server";

export const dynamic = "force-dynamic";

/** Rename a folder and/or move it under another (`parentId: null` = top). */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const body = (await req.json().catch(() => null)) as { name?: unknown; parentId?: unknown } | null;
	if (!body || (body.name === undefined && body.parentId === undefined)) {
		return Response.json({ error: "Send a name or a parentId." }, { status: 400 });
	}
	if (body.parentId !== undefined && body.parentId !== null && typeof body.parentId !== "string") {
		return Response.json({ error: "parentId must be a folder id or null." }, { status: 400 });
	}
	const result = updateFolders((s) => {
		let next = { ok: true as const, state: s } as ReturnType<typeof renameFolder>;
		if (body.name !== undefined) next = renameFolder(s, id, body.name);
		if (next.ok && body.parentId !== undefined) next = moveFolder(next.state, id, body.parentId as string | null);
		return next;
	});
	if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
	return Response.json(result.state);
}

/** Delete a folder. Its sessions and subfolders move up a level — nothing
 *  inside is ever deleted. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const result = updateFolders((s) => deleteFolder(s, id));
	if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
	return Response.json(result.state);
}
