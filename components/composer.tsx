"use client";

import type { ReactNode } from "react";
import { ArrowRightIcon, CornerDownLeftIcon, SquareIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { VoiceNotesBox, type VoiceNotes } from "@/components/voice-notes";
import { ImageDraftStrip, imageDropHandlers, type ImageDraft } from "@/components/learner-images";

/**
 * The chat composer — content row ONLY (the persistent rounded shell lives in
 * the chat view's overlay, so the shell can later morph chat → question
 * without remounting).
 *
 * Corner-radius math (concentric with the shell): shell rounded-2xl (16px) −
 * row padding p-1.5 (6px) = button rounded-[10px] = 25% of the 40px button.
 */
/** What one Enter press does, in precedence order: stop a busy stream,
 *  otherwise send the message, otherwise — practice sessions only — fire
 *  the next-problem signal while the between-problems pause is live
 *  (owner round 16: Enter on an EMPTY composer is the go-ahead; typing
 *  anything makes Enter a send again). Pure so the static-render harness
 *  can pin the decision (key events can't be simulated in
 *  renderToStaticMarkup). */
export function enterAction(state: {
	busy: boolean;
	canSend: boolean;
	/** The between-problems pause is live: practice session, nothing
	 *  active, no turn/compaction in flight (the caller's fold). */
	nextProblem?: boolean;
}): "stop" | "send" | "next" | "none" {
	// Composer steering (owner arc 2026-10-03): while a turn runs, typed
	// text makes Enter a STEER (the queue-and-redirect send); Enter with
	// an empty composer stays the stop shortcut. The button itself keeps
	// the square — Stop stays one click away at all times.
	if (state.busy) return state.canSend ? "send" : "stop";
	if (state.canSend) return "send";
	if (state.nextProblem) return "next";
	return "none";
}

export function Composer({
	busy,
	value,
	onChange,
	onSend,
	onStop,
	canSend,
	autoFocus,
	inputRef,
	onEscape,
	placeholder = "Ask, answer, or steer the lesson…",
	nextProblem = false,
	nextLabel = "Next problem",
	onNext,
	attachments,
	voice,
	images,
}: {
	busy: boolean;
	value: string;
	onChange: (v: string) => void;
	onSend: () => void;
	onStop: () => void;
	canSend: boolean;
	autoFocus?: boolean;
	/** The page's handle to the textarea — the dictation-end focus (owner,
	 *  2026-10-01): a run ending hands the cursor to the bare composer. */
	inputRef?: React.RefObject<HTMLTextAreaElement | null>;
	/** Escape while a dictation runs stops it (STT wave, 2026-09-17). No-op
	 *  when absent — Esc otherwise means nothing in the composer. */
	onEscape?: () => void;
	/** The textarea's placeholder (owner refinement round, 2026-09-24):
	 *  active sessions read "Ask, answer, or steer the lesson…"; the fresh
	 *  new-session page asks the graph view's opening question instead. */
	placeholder?: string;
	/** The practice pause is live (owner round 16): Enter on the empty
	 *  composer fires the next-problem signal instead of doing nothing —
	 *  the keyboard-first move-on. */
	nextProblem?: boolean;
	/** The move-on button's words (practice formats, owner 2026-10-26). */
	nextLabel?: string;
	/** The signal's dispatcher (send({type:"next"})) — the chip and the
	 *  empty-Enter share it. */
	onNext?: () => void;
	/** Lesson file picker: chips above the row, paperclip in the text row. */
	attachments?: (row: (attach: ReactNode) => ReactNode) => ReactNode;
	/** The voice box (voice-everywhere wave, owner 2026-10-25): dictation
	 *  becomes hidden voice notes riding the send — never text here. */
	voice?: { value: VoiceNotes; onClear: () => void };
	/** Show-your-work images (owner 2026-10-26): the paperclip routes
	 *  picked images here; paste and drop land here too. */
	images?: ImageDraft;
}) {
	const act = () => {
		const action = enterAction({ busy, canSend, nextProblem });
		if (action === "stop") onStop();
		else if (action === "send") onSend();
		else if (action === "next") onNext?.();
	};

	const sendButton =
		nextProblem && !busy && !canSend ? (
			<button
				type="submit"
				data-testid="next-problem-button"
				aria-label={nextLabel}
				className="flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-[10px] bg-green-600 px-4 font-ui text-xs font-medium uppercase tracking-wide text-white transition-colors hover:bg-green-500"
			>
				{nextLabel}
				<ArrowRightIcon className="size-4" />
			</button>
		) : (
			<button
				type="submit"
				aria-label={busy && !canSend ? "Stop" : "Send"}
				disabled={!busy && !canSend}
				className={cn(
					"flex size-10 shrink-0 items-center justify-center rounded-[10px] transition-colors",
					busy && !canSend
						? "bg-secondary text-foreground hover:bg-accent"
						: "bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40",
				)}
			>
				{busy && !canSend ? <SquareIcon className="size-4" /> : <CornerDownLeftIcon className="size-5" />}
			</button>
		);

	const fields = (attach?: ReactNode) => (
		<div className="flex items-end gap-1.5">
			{attach}
			<textarea
				ref={inputRef}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Escape" && onEscape) {
						e.preventDefault();
						e.stopPropagation();
						onEscape();
						return;
					}
					if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
						e.preventDefault();
						act();
					}
				}}
				placeholder={placeholder}
				autoFocus={autoFocus}
				rows={1}
				className="field-sizing-content lh-input max-h-48 min-h-10 flex-1 resize-none bg-transparent px-1 py-2.5 outline-none placeholder:text-muted-foreground"
			/>
			{sendButton}
		</div>
	);

	return (
		<form
			data-testid="composer"
			className="flex flex-col p-1.5"
			onSubmit={(e) => {
				e.preventDefault();
				act();
			}}
			{...(images ? imageDropHandlers(images) : {})}
		>
			{images && <ImageDraftStrip draft={images} className="px-1.5 pb-1.5" />}
			{attachments ? attachments(fields) : fields()}
			{voice && <VoiceNotesBox value={voice.value} onClear={voice.onClear} className="mt-1.5" />}
		</form>
	);
}
