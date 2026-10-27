/** Switching modes (2026-10-27): a session in one mode spawns a NEW session
 *  in another, seeded with this one's transcript as a source and an opening
 *  message written for the direction of the switch. Pure. */

export const SWITCH_MODES = ["chat", "teach", "practice"] as const;
export type SwitchMode = (typeof SWITCH_MODES)[number];

export function isSwitchMode(value: unknown): value is SwitchMode {
	return typeof value === "string" && (SWITCH_MODES as readonly string[]).includes(value);
}

export const MODE_LABELS: Record<SwitchMode, string> = { chat: "Chat", teach: "Teaching", practice: "Practice" };

export const MAX_FOCUS_LENGTH = 500;

/** The new session's title: the focus note, else "<Mode>: <old title>". */
export function switchTitle(to: SwitchMode, fromTitle: string, focus: string): string {
	const note = focus.trim();
	return note || `${MODE_LABELS[to]}: ${fromTitle.trim() || "previous session"}`;
}

/** The opening message (before the sources block is appended). */
export function switchOpening(to: SwitchMode, from: SwitchMode, focus: string): string {
	const note = focus.trim().slice(0, MAX_FOCUS_LENGTH);
	const earlier = `the attached ${MODE_LABELS[from].toLowerCase()} session (its transcript)`;
	const lines: string[] = [];
	if (to === "teach") {
		lines.push(
			`I hit a gap in ${earlier}. Teach it to me properly, from the ground up.`,
			note
				? `The gap: ${note}`
				: "Find the gap from the transcript — where I was confused, guessed, or got something wrong — and teach that. What I already showed I understand, don't re-teach.",
		);
	} else if (to === "practice") {
		lines.push(
			`Give me practice on what ${earlier} covered.`,
			note
				? `Focus on: ${note}`
				: "Choose the parts of it I'm least secure on and pose problems on those. Treat what I already showed I understand as lower priority.",
		);
	} else {
		lines.push(
			`I want to keep asking questions about ${earlier}.`,
			note ? `Start with: ${note}` : "Take it from where it left off; I'll ask next.",
		);
	}
	return lines.join("\n\n");
}
