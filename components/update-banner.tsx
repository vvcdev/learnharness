"use client";

/**
 * Upstream-notify banner (fork): shows when the shell reports a newer
 * public release (status "downloaded" = notify only — never installed).
 * Snapshot retrieval covers late loads. Dismissible; Details explains merge.
 */

import { useUpdateState } from "@/components/settings/update-settings.tsx";

export default function UpdateBanner() {
	const { state: ready } = useUpdateState();
	if (ready?.status !== "downloaded") return null;
	return (
		<div
			data-testid="update-banner"
			className="fixed right-4 bottom-4 z-50 flex max-w-sm items-start gap-3 rounded-lg border border-border bg-popover px-4 py-3 shadow-lg"
		>
			<div className="min-w-0 flex-1 text-sm">
				<div className="font-medium">Upstream LearnHarness {ready.version ?? "update"} is out</div>
				<p className="mt-0.5 text-muted-foreground">
					This app will not install it (that would reset your fork). Merge upstream and rebuild when you want it.
				</p>
			</div>
			<button
				type="button"
				data-testid="update-banner-details"
				onClick={() => window.lh?.installUpdate?.()}
				className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent/80"
			>
				Details
			</button>
		</div>
	);
}
