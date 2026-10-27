"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRightIcon } from "lucide-react";
import { MAX_FOCUS_LENGTH, MODE_LABELS, SWITCH_MODES, type SwitchMode } from "@/src/core";
import { usePopoverDismiss } from "@/components/popover-dismiss";
import { cn } from "@/lib/utils";

/**
 * Switch modes (2026-10-27): from any session, start the same material in
 * another mode — chat → teach on a gap, teach → practice for extra reps.
 * Picks a mode, takes an optional focus note, then opens a NEW session in
 * that mode seeded with this one's transcript (POST /api/chats/:id/switch).
 * The current session stays as it is.
 */
export function SessionModeSwitch({ chatId, kind }: { chatId: string; kind: SwitchMode }) {
	const router = useRouter();
	const rootRef = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false);
	const [target, setTarget] = useState<SwitchMode | null>(null);
	const [focus, setFocus] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const close = () => {
		setOpen(false);
		setTarget(null);
		setFocus("");
		setError(null);
	};
	usePopoverDismiss(rootRef, open, close);

	const start = async () => {
		if (!target || busy) return;
		setBusy(true);
		setError(null);
		try {
			const response = await fetch(`/api/chats/${encodeURIComponent(chatId)}/switch`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ mode: target, focus }),
			});
			const payload = (await response.json().catch(() => ({}))) as { id?: string; prompt?: string; error?: string };
			if (!response.ok || !payload.id || !payload.prompt) {
				setError(payload.error || "Could not switch modes.");
				setBusy(false);
				return;
			}
			router.push(`/chat/${payload.id}?prompt=${encodeURIComponent(payload.prompt)}`);
		} catch {
			setError("Could not reach the app. Try again.");
			setBusy(false);
		}
	};

	return (
		<div ref={rootRef} className="relative">
			<button
				type="button"
				data-testid="mode-switch"
				aria-label="Switch mode"
				aria-expanded={open}
				onClick={() => (open ? close() : setOpen(true))}
				className="lh-no-drag flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-border/80 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:border-border hover:text-foreground"
			>
				<ArrowLeftRightIcon className="size-3.5" aria-hidden />
				Switch
			</button>
			{open && (
				<div
					data-testid="mode-switch-panel"
					className="absolute right-0 top-full z-30 mt-1.5 flex w-72 flex-col gap-2 rounded-lg border bg-popover p-2 text-popover-foreground shadow-md"
				>
					<p className="px-1 text-[11px] uppercase tracking-wider text-muted-foreground">Continue this in…</p>
					<div className="flex gap-1.5">
						{SWITCH_MODES.filter((mode) => mode !== kind).map((mode) => (
							<button
								key={mode}
								type="button"
								data-testid={`mode-switch-${mode}`}
								onClick={() => setTarget(mode)}
								className={cn(
									"flex-1 rounded-md border px-2 py-1.5 text-xs transition-colors hover:bg-accent",
									target === mode && "border-primary bg-accent",
								)}
							>
								{MODE_LABELS[mode]}
							</button>
						))}
					</div>
					{target && (
						<form
							className="flex flex-col gap-1.5"
							onSubmit={(event) => {
								event.preventDefault();
								void start();
							}}
						>
							<input
								autoFocus
								value={focus}
								maxLength={MAX_FOCUS_LENGTH}
								onChange={(event) => setFocus(event.target.value)}
								placeholder={target === "teach" ? "Which gap? (optional)" : "What should it focus on? (optional)"}
								aria-label="Focus note"
								className="lh-input rounded-md border bg-background px-2 py-1 text-xs outline-none focus:border-ring"
							/>
							<button
								type="submit"
								disabled={busy}
								data-testid="mode-switch-start"
								className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-40"
							>
								{busy ? "Starting…" : `Start ${MODE_LABELS[target].toLowerCase()}`}
							</button>
						</form>
					)}
					{error && <p role="alert" className="px-1 text-xs text-red-400">{error}</p>}
				</div>
			)}
		</div>
	);
}
