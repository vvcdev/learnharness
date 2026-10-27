import { appendLessonSources, isSwitchMode, MAX_FOCUS_LENGTH, sessionMarkdown, switchOpening, switchTitle, type SwitchMode } from "@/src/core";
import { createChat, getChat, readSettingsRecord, saveLessonSources, stores, titleFromPrompt } from "@/src/server";

export const dynamic = "force-dynamic";

/** Switch modes: a NEW session in the target mode, seeded with this
 *  session's transcript as a source and an opening written for the switch.
 *  The old session is untouched. Returns the new id + the opening prompt
 *  (the client navigates with it as turn 1, like any first message). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const record = getChat(id);
	if (!record) return Response.json({ error: "Not found" }, { status: 404 });
	const body = (await req.json().catch(() => null)) as { mode?: unknown; focus?: unknown } | null;
	if (!isSwitchMode(body?.mode)) return Response.json({ error: "Choose chat, teach, or practice." }, { status: 400 });
	const to: SwitchMode = body.mode;
	const from: SwitchMode = record.kind === "practice" || record.kind === "chat" ? record.kind : "teach";
	if (to === from) return Response.json({ error: "This session is already in that mode." }, { status: 400 });
	const focus = typeof body?.focus === "string" ? body.focus.trim().slice(0, MAX_FOCUS_LENGTH) : "";

	const transcript = sessionMarkdown(record.messages, { title: record.title, anchors: false });
	if (record.messages.length === 0 || transcript.trim().length === 0) {
		return Response.json({ error: "There is nothing in this session to carry over yet." }, { status: 400 });
	}

	const chat = createChat(titleFromPrompt(switchTitle(to, record.title, focus)), to === "teach" ? undefined : to);
	// Per-session model: stamped from the strong slot, as in POST /api/chats.
	const strong = readSettingsRecord()?.models?.strong;
	if (strong?.model) {
		stores.chatStore.saveSettings(chat.id, {
			model: { provider: strong.model.provider, id: strong.model.id },
			thinkingLevel: strong.thinkingLevel,
		});
	}
	const saved = saveLessonSources(chat.id, [
		{ name: `Previous session - ${record.title}.md`, bytes: new TextEncoder().encode(transcript) },
	]);
	if (!saved.ok) return Response.json({ error: saved.error }, { status: saved.status });
	return Response.json({ id: chat.id, prompt: appendLessonSources(switchOpening(to, from, focus), saved.paths) });
}
