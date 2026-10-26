"use client";

import { DumbbellIcon, GraduationCapIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The session's CATEGORY, unmissable (owner, 2026-10-25): every session's
 * top bar carries a colored pill — TEACHING (blue, cap) or PRACTICE
 * (green, dumbbell). Clicking it opens the sidebar on that category's
 * section with this session's row scrolled into view (the sidebar listens
 * for SHOW_SESSION_KIND_EVENT).
 */

export type SessionKind = "teach" | "practice";

export const SHOW_SESSION_KIND_EVENT = "lh:show-session-kind";

export function showSessionKind(kind: SessionKind) {
	window.dispatchEvent(new CustomEvent<SessionKind>(SHOW_SESSION_KIND_EVENT, { detail: kind }));
}

export function SessionKindChip({ kind }: { kind: SessionKind }) {
	const practice = kind === "practice";
	const Icon = practice ? DumbbellIcon : GraduationCapIcon;
	return (
		<button
			type="button"
			data-testid="session-kind-chip"
			data-kind={kind}
			onClick={() => showSessionKind(kind)}
			aria-label={`${practice ? "Practice" : "Teaching"} session: show ${practice ? "practice" : "teaching"} sessions`}
			className={cn(
				"lh-no-drag flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium uppercase tracking-wide transition-colors",
				practice
					? "border-green-500/40 bg-green-500/10 text-green-500 hover:bg-green-500/20"
					: "border-blue-500/40 bg-blue-500/10 text-blue-500 hover:bg-blue-500/20",
			)}
		>
			<Icon className="size-3.5" aria-hidden />
			{practice ? "Practice" : "Teaching"}
		</button>
	);
}
