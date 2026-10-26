"use client";

import { useCallback, useRef, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { usePopoverDismiss } from "@/components/popover-dismiss";
import { cn } from "@/lib/utils";
import {
	PRACTICE_BATCH_SIZES,
	parsePracticeSettings,
	type PracticeFormat,
	type PracticeSettings,
} from "@/src/core";

/**
 * THE PRACTICE FORMAT (owner 2026-10-26): Open-ended (the default —
 * today's practice), MCQ (Single or Batch of 5/10/20), or Mix (the agent
 * interleaves; always single). Picked when the session starts (the home
 * and new-session switch row) and switchable mid-session from the top
 * bar's chip — the next item follows the new choice.
 */

const FORMATS: Array<{ id: PracticeFormat; label: string }> = [
	{ id: "open", label: "Open-ended" },
	{ id: "mcq", label: "MCQ" },
	{ id: "mix", label: "Mix" },
];

/** "Open-ended" · "MCQ" · "MCQ · batch of 10" · "Mix". */
export function practiceFormatLabel(s: PracticeSettings): string {
	if (s.format === "mcq") return s.pacing === "batch" ? `MCQ · batch of ${s.batchSize}` : "MCQ";
	return FORMATS.find((f) => f.id === s.format)!.label;
}

/** The composer's move-on label for this format. */
export function nextItemLabel(s: PracticeSettings): string {
	if (s.format === "mcq") return s.pacing === "batch" ? "Next batch" : "Next question";
	return s.format === "mix" ? "Next" : "Next problem";
}

function Segmented<T extends string | number>({
	options,
	value,
	onChange,
	testid,
}: {
	options: Array<{ id: T; label: string }>;
	value: T;
	onChange: (v: T) => void;
	testid: string;
}) {
	return (
		<div className="flex items-center gap-0.5 rounded-md border border-border/60 bg-background p-0.5" data-testid={testid}>
			{options.map((o) => (
				<button
					key={String(o.id)}
					type="button"
					data-testid={`${testid}-${o.id}`}
					aria-pressed={value === o.id}
					onClick={() => onChange(o.id)}
					className={cn(
						"rounded-sm px-2 py-0.5 text-[11px] uppercase tracking-wider transition-colors",
						value === o.id ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
					)}
				>
					{o.label}
				</button>
			))}
		</div>
	);
}

/** The picker rows: format, then (MCQ only) pacing, then (batch only) size. */
export function PracticeFormatPicker({
	value,
	onChange,
	className,
	label = false,
}: {
	value: PracticeSettings;
	onChange: (next: PracticeSettings) => void;
	className?: string;
	/** Lead with a "Format" label (the above-composer placement). */
	label?: boolean;
}) {
	const set = (patch: Partial<PracticeSettings>) => onChange(parsePracticeSettings({ ...value, ...patch }));
	return (
		<div className={cn("flex flex-wrap items-center gap-1.5", className)} data-testid="practice-format-picker">
			{label && <span className="font-ui text-[11px] uppercase tracking-wider text-muted-foreground">Format</span>}
			<Segmented testid="practice-format" options={FORMATS} value={value.format} onChange={(format) => set({ format })} />
			{value.format === "mcq" && (
				<Segmented
					testid="practice-pacing"
					options={[
						{ id: "single", label: "Single" },
						{ id: "batch", label: "Batch" },
					]}
					value={value.pacing}
					onChange={(pacing) => set({ pacing })}
				/>
			)}
			{value.format === "mcq" && value.pacing === "batch" && (
				<Segmented
					testid="practice-batch-size"
					options={PRACTICE_BATCH_SIZES.map((n) => ({ id: n, label: String(n) }))}
					value={value.batchSize}
					onChange={(batchSize) => set({ batchSize })}
				/>
			)}
		</div>
	);
}

/** The in-session chip: the current format; click → the picker. Each
 *  change writes the record (PUT) — the agent's next item follows it. */
export function PracticeFormatChip({
	chatId,
	value,
	onChange,
}: {
	chatId: string;
	value: PracticeSettings;
	onChange: (next: PracticeSettings) => void;
}) {
	const [open, setOpen] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	const close = useCallback(() => setOpen(false), []);
	usePopoverDismiss(rootRef, open, close);
	const write = (next: PracticeSettings) => {
		const previous = value;
		onChange(next);
		setError(null);
		void fetch(`/api/chats/${encodeURIComponent(chatId)}/practice`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(next),
		})
			.then((r) => {
				if (!r.ok) throw new Error();
			})
			.catch(() => {
				onChange(previous);
				setError("Couldn't save the format.");
			});
	};
	return (
		<div ref={rootRef} className="lh-no-drag relative">
			<button
				type="button"
				data-testid="practice-format-chip"
				aria-expanded={open}
				onClick={() => setOpen(!open)}
				className="flex shrink-0 cursor-pointer items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:border-muted-foreground/50 hover:text-foreground"
			>
				{practiceFormatLabel(value)}
				<ChevronDownIcon className="size-3" aria-hidden />
			</button>
			{open && (
				<div className="absolute top-full right-0 z-50 mt-1 w-max rounded-lg border border-border bg-popover p-2 shadow-md">
					<div className="mb-1.5 font-ui text-[11px] uppercase tracking-wider text-muted-foreground">Practice format</div>
					<PracticeFormatPicker value={value} onChange={write} className="flex-col items-start" />
					<div className="mt-1.5 text-[11px] text-muted-foreground">Applies from the next item.</div>
					{error && <div role="alert" className="mt-1 text-[11px] text-red-400">{error}</div>}
				</div>
			)}
		</div>
	);
}
