"use client";

/**
 * Upstream-notify banner (fork): the shell checks the public LearnHarness
 * feed and pushes {status:"available", version} — never downloads or
 * installs into this .app (that would wipe Projects / custom wiring).
 * Real updates are a git merge + rebuild. Dismissible.
 */

import { useEffect, useState } from "react";

type UpdateStatus = { status: string; version: string | null };

export default function UpdateBanner() {
	const [notice, setNotice] = useState<UpdateStatus | null>(null);

	useEffect(() => {
		return window.lh?.onUpdateStatus?.((s) => {
			if (s?.status === "available" || s?.status === "downloaded") setNotice(s);
		});
	}, []);

	if (!notice) return null;
	return (
		<div
			data-testid="update-banner"
			className="fixed right-4 bottom-4 z-50 flex max-w-sm items-start gap-3 rounded-lg border border-border bg-popover px-4 py-3 shadow-lg"
		>
			<div className="min-w-0 flex-1 text-sm">
				<div className="font-medium">Upstream LearnHarness {notice.version ?? "update"} is out</div>
				<p className="mt-0.5 text-muted-foreground">
					This app will not install it (that would reset your fork). Merge upstream and rebuild when you want it.
				</p>
			</div>
			<button
				type="button"
				aria-label="Dismiss"
				onClick={() => setNotice(null)}
				className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent/80"
			>
				Got it
			</button>
		</div>
	);
}
