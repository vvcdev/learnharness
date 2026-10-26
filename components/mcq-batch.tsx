"use client";

import { useCallback, useMemo, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { AnsweredCard } from "@/components/answered-card";
import { QuestionDockForm } from "@/components/question-dock";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { parseQuizInput, type QuestionAnswerData, type QuizToolInput } from "@/src/core";

/**
 * MCQ BATCHES (practice sessions, owner 2026-10-26): the agent poses N
 * questions in one mcq_batch call. The dock walks them one at a time —
 * Back/Next and the progress dots move freely, any answer can change —
 * and nothing is revealed until Finish. Finishing saves every graded
 * answer as ONE result (silently: the agent reads it with Next); the
 * transcript card then reveals them one by one, ending on the summary.
 */

/** The batch call's questions, each parsed like a quiz (null when any
 *  question is malformed — the dock then shows the quiet fallback). */
export function parseBatchQuestions(input: unknown): QuizToolInput[] | null {
	const questions = (input as { questions?: unknown } | null)?.questions;
	if (!Array.isArray(questions) || questions.length === 0) return null;
	const parsed = questions.map((q) => parseQuizInput(q));
	return parsed.every((q): q is QuizToolInput => q !== undefined) ? parsed : null;
}

export function McqBatchDock({
	toolCallId,
	input,
	expanded,
	onExpand,
	onSubmit,
	onEscape,
	compactionRunning = false,
}: {
	toolCallId: string;
	input: unknown;
	expanded: boolean;
	onExpand: () => void;
	onSubmit: (output: QuestionAnswerData) => void;
	onEscape?: () => void;
	compactionRunning?: boolean;
}) {
	const questions = useMemo(() => parseBatchQuestions(input), [input]);
	const [idx, setIdx] = useState(0);
	const [answers, setAnswers] = useState<(QuestionAnswerData | undefined)[]>([]);
	/* AUTO-SAVE (owner 2026-10-26): each question's form reports its live
	 * answer — a pick is saved the moment it is made, no button. One
	 * stable callback per index so the forms' effects don't refire. */
	const drafts = useMemo(
		() =>
			Array.from({ length: questions?.length ?? 0 }, (_, i) => (answer: QuestionAnswerData | undefined) =>
				setAnswers((prev) => {
					if (prev[i] === answer) return prev;
					const next = [...prev];
					next[i] = answer;
					return next;
				}),
			),
		[questions?.length],
	);
	const advance = useCallback(
		(from: number) => {
			if (!questions) return;
			setIdx(Math.min(from + 1, questions.length - 1));
		},
		[questions],
	);
	if (!questions) {
		return (
			<div data-testid="malformed-question" className="rounded-xl border border-dashed bg-card/60 p-3 text-sm text-muted-foreground">
				This batch arrived malformed — the transcript keeps the retry.
			</div>
		);
	}
	const total = questions.length;
	const done = answers.filter(Boolean).length;
	const allDone = done === total;

	const finish = () => {
		if (!allDone || compactionRunning) return;
		onSubmit({
			kind: "quiz",
			tool: "mcq_batch",
			questionText: `Batch of ${total}`,
			dontKnow: false,
			answers: [],
			batch: answers as QuestionAnswerData[],
			answeredAt: new Date().toISOString(),
		});
	};

	if (!expanded) {
		return (
			<button
				type="button"
				data-testid="mcq-batch-bar"
				onClick={onExpand}
				className="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
			>
				<ChevronRightIcon className="size-4 shrink-0 rotate-90" />
				<span className="font-medium">MCQ batch</span>
				<span className="min-w-0 flex-1 truncate">
					{done} of {total} answered
				</span>
			</button>
		);
	}

	return (
		<div data-testid="mcq-batch-dock" className="dock-variant">
			{/* The walk: Back · dots · Next, and Finish once every one is answered. */}
			<div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
				<button
					type="button"
					aria-label="Previous question"
					disabled={idx === 0}
					onClick={() => setIdx(idx - 1)}
					className="flex size-7 items-center justify-center rounded-[6px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
				>
					<ChevronLeftIcon className="size-4" />
				</button>
				<div className="flex min-w-0 flex-1 flex-wrap items-center justify-center gap-1">
					{questions.map((_, i) => (
						<button
							key={i}
							type="button"
							aria-label={`Question ${i + 1}${answers[i] ? " (answered)" : ""}`}
							aria-current={i === idx}
							onClick={() => setIdx(i)}
							className={cn(
								"size-2.5 rounded-full border transition-colors",
								answers[i] ? "border-primary bg-primary" : "border-muted-foreground/50",
								i === idx && "ring-2 ring-primary/40 ring-offset-1 ring-offset-background",
							)}
						/>
					))}
				</div>
				<button
					type="button"
					aria-label="Next question"
					disabled={idx === total - 1}
					onClick={() => setIdx(idx + 1)}
					className="flex size-7 items-center justify-center rounded-[6px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
				>
					<ChevronRightIcon className="size-4" />
				</button>
				<Button
					type="button"
					data-testid="mcq-batch-finish"
					disabled={!allDone || compactionRunning}
					onClick={finish}
					className="h-8 rounded-[6px] px-3 text-xs font-medium"
				>
					Finish batch
				</Button>
			</div>
			{/* Every question stays MOUNTED (hidden when not current) so its
			    picks, thinking, and images survive moving back and forth. */}
			{questions.map((q, i) => (
				<div key={i} className={i === idx ? undefined : "hidden"}>
					<QuestionDockForm
						toolName="mcq"
						toolCallId={`${toolCallId}#${i}`}
						input={q}
						active={expanded && i === idx}
						dictationClaim={expanded && i === idx}
						onSubmit={() => (i === total - 1 ? finish() : advance(i))}
						onEscape={onEscape}
						compactionRunning={compactionRunning}
						batch={{
							label: `Question ${i + 1} of ${total}`,
							// Picks save themselves; the button (and Enter) moves on —
							// on the last question it finishes the batch.
							submitLabel: i === total - 1 ? "Finish batch" : "Next question",
							enterEnabled: expanded && i === idx,
							onDraft: drafts[i]!,
						}}
					/>
				</div>
			))}
		</div>
	);
}

/** The answered batch in the transcript: the reveal walk, one question at
 *  a time, ending on the summary (score + the misses, each a jump). */
export function McqBatchCard({ answer, input }: { answer: QuestionAnswerData; input: unknown }) {
	const items = answer.batch ?? [];
	const questions = (input as { questions?: unknown[] } | null)?.questions ?? [];
	const [step, setStep] = useState(0);
	if (answer.dismissed || items.length === 0) {
		return (
			<div data-testid="mcq-batch-card" className="my-3 text-sm text-muted-foreground">
				MCQ batch skipped.
			</div>
		);
	}
	const total = items.length;
	const correct = items.filter((a) => a.correct === true).length;
	const missed = items.flatMap((a, i) => (a.correct === true || a.byVoice ? [] : [i]));
	const summary = step >= total;
	return (
		<div data-testid="mcq-batch-card" className="my-3">
			<div className="mb-1 flex items-center gap-2 font-ui text-xs font-medium uppercase tracking-wide text-muted-foreground">
				<span>MCQ batch</span>
				<span className="text-muted-foreground/70">· {summary ? "summary" : `reveal ${step + 1} of ${total}`}</span>
				<span className="ml-auto flex items-center gap-1">
					<button
						type="button"
						aria-label="Previous"
						disabled={step === 0}
						onClick={() => setStep(step - 1)}
						className="flex size-6 items-center justify-center rounded-[6px] hover:bg-accent hover:text-foreground disabled:opacity-30"
					>
						<ChevronLeftIcon className="size-4" />
					</button>
					<button
						type="button"
						aria-label="Next"
						disabled={summary}
						onClick={() => setStep(step + 1)}
						className="flex size-6 items-center justify-center rounded-[6px] hover:bg-accent hover:text-foreground disabled:opacity-30"
					>
						<ChevronRightIcon className="size-4" />
					</button>
				</span>
			</div>
			{summary ? (
				<div data-testid="mcq-batch-summary" className="rounded-xl border border-border bg-card p-4 text-sm">
					<div className="text-base font-medium">
						{correct} / {total} correct
					</div>
					{missed.length > 0 ? (
						<div className="mt-2 flex flex-wrap items-center gap-1.5 text-muted-foreground">
							<span>Missed:</span>
							{missed.map((i) => (
								<button
									key={i}
									type="button"
									onClick={() => setStep(i)}
									className="rounded-sm border border-border px-1.5 py-0.5 text-xs text-foreground hover:bg-accent"
								>
									Q{i + 1}
								</button>
							))}
						</div>
					) : (
						<div className="mt-2 text-muted-foreground">No misses.</div>
					)}
					<div className="mt-3 text-xs text-muted-foreground">Press Enter or Next for the next batch.</div>
				</div>
			) : (
				<AnsweredCard key={step} answer={items[step]!} input={questions[step]} />
			)}
		</div>
	);
}
