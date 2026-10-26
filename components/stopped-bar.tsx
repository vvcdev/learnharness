"use client";

import { PencilIcon, RotateCcwIcon, XIcon } from "lucide-react";
import type { StoppedTurn } from "@/src/core";

/**
 * STOP → EDIT / REGENERATE (owner 2026-10-26): the quiet row under a
 * stopped reply. Regenerate throws the stopped output away and runs the
 * turn again; Edit reopens a typed message (in the composer) or a
 * practice submission (in the practice box) — sending it replaces the
 * original. After Next or a quiz answer only Regenerate applies.
 */
export function StoppedBar({
	stopped,
	editing,
	onRegenerate,
	onEdit,
	onCancel,
}: {
	stopped: StoppedTurn;
	editing: null | "text" | "thinking";
	onRegenerate: () => void;
	onEdit: () => void;
	onCancel: () => void;
}) {
	const button =
		"flex cursor-pointer items-center gap-1 rounded-sm px-1.5 py-0.5 transition-colors hover:bg-accent hover:text-foreground";
	return (
		<div
			data-testid="stopped-bar"
			className="my-3 flex items-center gap-2 font-ui text-xs font-medium uppercase tracking-wide text-muted-foreground"
		>
			{editing ? (
				<>
					<span>Editing — {editing === "text" ? "send" : "submit"} to replace your last {editing === "text" ? "message" : "thinking"}</span>
					<button type="button" data-testid="stopped-cancel" onClick={onCancel} className={button}>
						<XIcon className="size-3.5" aria-hidden />
						Cancel
					</button>
				</>
			) : (
				<>
					<span>Stopped</span>
					<button type="button" data-testid="stopped-regenerate" onClick={onRegenerate} className={button}>
						<RotateCcwIcon className="size-3.5" aria-hidden />
						Regenerate
					</button>
					{stopped.editable && (
						<button type="button" data-testid="stopped-edit" onClick={onEdit} className={button}>
							<PencilIcon className="size-3.5" aria-hidden />
							Edit
						</button>
					)}
				</>
			)}
		</div>
	);
}
