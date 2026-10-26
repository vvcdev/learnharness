"use client";

import { useCallback, useRef, useState } from "react";
import { MicIcon, XIcon } from "lucide-react";
import { toggleDictation, useDictationActive } from "@/components/dictation";
import { cn } from "@/lib/utils";

/**
 * The voice box (voice-notes wave, owner 2026-10-25): spoken thinking
 * that is NEVER shown as text. Every thinking surface (quiz "Your
 * thinking", "Thinking while reading", the practice dock) pairs its
 * typing box with this separate box; while one is mounted, dictation
 * (⌘D, the Dictate bar, the box's own mic) lands here as a voice note
 * instead of in the text. The box shows only the count + total length
 * and an × that discards them; the transcript rides the submission as
 * its own spoken channel (the tutor reads it, the learner never does).
 */

export interface VoiceNotes {
	notes: string[];
	seconds: number;
}

export const EMPTY_VOICE_NOTES: VoiceNotes = { notes: [], seconds: 0 };

/** Append one run's transcript (empty runs still count their time). */
export function addVoiceNote(v: VoiceNotes, text: string, seconds: number): VoiceNotes {
	const t = text.trim();
	return { notes: t ? [...v.notes, t] : v.notes, seconds: v.seconds + seconds };
}

/** The joined transcript for the submission — undefined when nothing was said. */
export function voiceText(v: VoiceNotes): string | undefined {
	return v.notes.join(" ").trim() || undefined;
}

/** 41 → "0:41", 125 → "2:05". */
export function formatVoiceDuration(seconds: number): string {
	const s = Math.max(0, Math.round(seconds));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** A voice opening's query tail for /chat/<id>?prompt=… (voice-everywhere
 *  wave, owner 2026-10-25): the chat page hands it to the first send. */
export function voiceOpeningQuery(v: VoiceNotes): string {
	const spoken = voiceText(v);
	return spoken ? `&spoken=${encodeURIComponent(spoken)}&seconds=${Math.round(v.seconds)}` : "";
}

/** State + a ref mirror (the "nothing gets lost" law: a submit resuming
 *  after `await finishDictation()` reads the ref, never a stale closure). */
export function useVoiceNotes() {
	const [value, setValue] = useState<VoiceNotes>(EMPTY_VOICE_NOTES);
	const ref = useRef<VoiceNotes>(EMPTY_VOICE_NOTES);
	const add = useCallback((text: string, seconds: number) => {
		ref.current = addVoiceNote(ref.current, text, seconds);
		setValue(ref.current);
	}, []);
	const clear = useCallback(() => {
		ref.current = EMPTY_VOICE_NOTES;
		setValue(EMPTY_VOICE_NOTES);
	}, []);
	return { value, ref, add, clear };
}

export function VoiceNotesBox({
	value,
	onClear,
	canRecord = true,
	className,
}: {
	value: VoiceNotes;
	onClear: () => void;
	/** False when another box holds the dictation claim: no mic here. */
	canRecord?: boolean;
	className?: string;
}) {
	const recording = useDictationActive() && canRecord;
	const count = value.notes.length;
	return (
		<div
			data-testid="voice-notes"
			className={cn("flex h-9 items-center gap-2 rounded-[10px] border border-border/70 bg-background/60 px-1 text-xs text-muted-foreground", className)}
		>
			{canRecord ? (
			<button
				type="button"
				data-testid="voice-notes-mic"
				aria-label={recording ? "Stop voice note" : "Record a voice note"}
				onClick={toggleDictation}
				className={cn(
					"flex size-7 shrink-0 items-center justify-center rounded-[6px] transition-colors",
					recording ? "bg-destructive/10 text-destructive" : "hover:bg-muted hover:text-foreground",
				)}
			>
				<MicIcon className={cn("size-3.5", recording && "animate-pulse")} />
			</button>
			) : (
				<MicIcon className="mx-1.5 size-3.5 shrink-0 opacity-50" aria-hidden />
			)}
			<span className="min-w-0 flex-1 truncate" data-testid="voice-notes-summary">
				{recording
					? "Recording…"
					: count > 0
						? `${count} voice ${count === 1 ? "note" : "notes"} · ${formatVoiceDuration(value.seconds)}`
						: "Think out loud"}
			</span>
			{count > 0 && !recording && (
				<button
					type="button"
					data-testid="voice-notes-clear"
					aria-label="Discard voice notes"
					onClick={onClear}
					className="flex size-7 shrink-0 items-center justify-center rounded-[6px] transition-colors hover:bg-muted hover:text-foreground"
				>
					<XIcon className="size-3.5" />
				</button>
			)}
		</div>
	);
}

/** The transcript's voice bubble (voice-everywhere wave, owner
 *  2026-10-25): a sent voice message renders as this line — never its
 *  words. `seconds` is null where the length didn't survive transport. */
export function VoiceMessageLine({ seconds }: { seconds: number | null }) {
	return (
		<div data-testid="voice-message" className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
			<MicIcon className="size-3.5 shrink-0" />
			{seconds == null ? "Voice message" : `Voice message · ${formatVoiceDuration(seconds)}`}
		</div>
	);
}
