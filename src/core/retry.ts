/**
 * STOP → EDIT / REGENERATE (owner 2026-10-26): after the learner stops a
 * reply, the stopped output can be thrown away and the turn re-run —
 * as-is (Regenerate) or from an edited input (Edit). The model never sees
 * the abandoned attempt: both cut the record back to the learner's input
 * (Regenerate keeps it, Edit replaces it) before the new turn runs.
 * Pure, browser-safe — the client trims its local view the same way the
 * server trims the record.
 */

import type { AssistantMessage, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import { splitVoiceContent } from "./contracts/chat.ts";
import type { ImageRef } from "./images.ts";
import type { LhMarkerMessage, LhMessage } from "./native-messages.ts";
import { isPracticeMcqTool, QUESTION_TOOLS } from "./pending.ts";

/** A stopped turn: where its input sits, and what Edit can reopen. */
export interface StoppedTurn {
	/** The record index of the learner input the stopped turn answered. */
	inputIndex: number;
	/** "text": a typed chat message; "thinking": a practice submission;
	 *  null: Regenerate only (Next, a quiz answer, a delivery). */
	editable: "text" | "thinking" | null;
	text: string;
	images?: ImageRef[];
	/** thinking only: the problem the submission targeted. */
	problemCallId?: string;
}

function role(m: LhMessage): string | undefined {
	return (m as { role?: string }).role;
}

/** Is this message a turn's INPUT (what a reply answers)? */
function isTurnInput(m: LhMessage): boolean {
	const r = role(m);
	if (r === "user") return true;
	if (r === "custom") {
		const t = (m as LhMarkerMessage).customType;
		return t !== "plan-block" && t !== "problem-dismissed" && t !== "compaction" && t !== "graph-context";
	}
	if (r === "toolResult") {
		// A learner's answer (the question call's real result) — the
		// question placeholders never persist.
		return (QUESTION_TOOLS as readonly string[]).includes((m as ToolResultMessage).toolName);
	}
	return false;
}

/** The stopped turn at the record's end, or null. A turn counts as
 *  stopped when its last reply was aborted, or when the learner's input
 *  got no reply at all (stopped before the first token). Silent MCQ
 *  answers and dismissals end the record by design — never "stopped". */
export function stoppedTurnOf(messages: readonly LhMessage[]): StoppedTurn | null {
	const last = messages[messages.length - 1];
	if (!last) return null;
	let i = messages.length - 1;
	if (role(last) === "assistant" || (role(last) === "toolResult" && !isTurnInput(last))) {
		// The newest assistant message must be the aborted one.
		let a = i;
		while (a >= 0 && role(messages[a]!) !== "assistant") a--;
		if (a < 0 || (messages[a] as AssistantMessage).stopReason !== "aborted") return null;
		if (messages.slice(a + 1).some(isTurnInput)) return null;
		i = a - 1;
		while (i >= 0 && !isTurnInput(messages[i]!)) i--;
		if (i < 0) return null;
	} else {
		// No reply at all: a typed message, a thinking submission, Next, or
		// a teaching answer (silent MCQ answers and dismissals are pauses).
		const r = role(last);
		const marker = r === "custom" ? (last as LhMarkerMessage).customType : null;
		const answer =
			r === "toolResult" &&
			isTurnInput(last) &&
			!isPracticeMcqTool((last as ToolResultMessage).toolName) &&
			((last as ToolResultMessage).details as { dismissed?: boolean } | null)?.dismissed !== true;
		if (r !== "user" && marker !== "practice-thinking" && marker !== "practice-next" && !answer) return null;
	}
	const input = messages[i]!;
	if (role(input) === "user") {
		const content = (input as UserMessage).content;
		const raw = typeof content === "string" ? content : content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n");
		const images = (input as { images?: ImageRef[] }).images;
		return { inputIndex: i, editable: "text", text: splitVoiceContent(raw).text, ...(images ? { images } : {}) };
	}
	if (role(input) === "custom" && (input as LhMarkerMessage).customType === "practice-thinking") {
		const d = (input as LhMarkerMessage).details as { problemCallId: string; text?: string; images?: ImageRef[] };
		return {
			inputIndex: i,
			editable: "thinking",
			text: d.text ?? "",
			problemCallId: d.problemCallId,
			...(d.images ? { images: d.images } : {}),
		};
	}
	return { inputIndex: i, editable: null, text: "" };
}

/** The record a retry runs on: through the input (regenerate) or up to
 *  it (edit — the new input replaces it). Null when nothing is stopped
 *  or the input cannot be edited. */
export function retryBase(messages: readonly LhMessage[], mode: "regenerate" | "edit"): LhMessage[] | null {
	const stopped = stoppedTurnOf(messages);
	if (!stopped) return null;
	if (mode === "edit" && !stopped.editable) return null;
	return messages.slice(0, mode === "edit" ? stopped.inputIndex : stopped.inputIndex + 1);
}
