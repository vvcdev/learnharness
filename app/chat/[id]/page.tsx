import { notFound } from "next/navigation";
import { Chat } from "@/components/chat";
import { parseImageRefs, practiceSettingsOf, slotsConfigured } from "@/src/core";

function parseOpeningImages(raw: string | undefined) {
	if (!raw) return undefined;
	try {
		return parseImageRefs(JSON.parse(raw));
	} catch {
		return undefined;
	}
}
import { compactionInFlight, getChat, isTurnRunning, readSettingsRecord } from "@/src/server";

export const dynamic = "force-dynamic";

export default async function ChatPage({
	params,
	searchParams,
}: {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ prompt?: string; spoken?: string; seconds?: string; images?: string }>;
}) {
	const [{ id }, { prompt, spoken, seconds, images }] = await Promise.all([params, searchParams]);
	const chat = getChat(id);
	if (!chat) notFound();
	// The persistent setup CTA's seed (BYOK, owner 2026-09-22): slotsConfigured
	// over the settings record, server-read — the same gate home/new read. The
	// server's 503 stays the truth; this only decides whether the pill rides.
	const record = readSettingsRecord();
	return (
		<Chat
			key={chat.id}
			chatId={chat.id}
			title={chat.title}
			kind={chat.kind ?? "teach"}
			initialPractice={practiceSettingsOf(chat)}
			// Wave D: the record IS native agent history — the client view is
				// derived app-side (core/view.ts projectView; GET serves the same
				// native messages).
				initialMessages={chat.messages}
			initialConfigured={slotsConfigured(record?.models)}
			initialPrompt={prompt}
			// A voice opening (voice-everywhere wave, owner 2026-10-25): the
			// transcript rides the first send as its hidden spoken part.
			initialVoice={spoken?.trim() ? { spoken, seconds: Number(seconds) || 0 } : undefined}
			// Images pasted on the home / new-session box (owner 2026-10-26):
			// uploaded into this session before the redirect; refs only.
			initialImages={parseOpeningImages(images)}
			// A teacher turn that outlived its client: the remounted view must
			// attach (busy shimmer + poll), never resurrect the stale record.
			initiallyInFlight={isTurnRunning(chat.id)}
			initiallyCompacting={compactionInFlight(chat.id)}
		/>
	);
}
