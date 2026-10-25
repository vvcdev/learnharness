"use client";

import { useEffect, useState } from "react";
import { notifySettingsSaved } from "@/components/settings-signal";

interface ClaudeCodeBody {
	loggedIn: boolean;
	subscription: string | null;
	hint: string | null;
}

export function ClaudeCodeConnection() {
	const [status, setStatus] = useState<ClaudeCodeBody | null>(null);
	const [error, setError] = useState<string | null>(null);

	async function load() {
		try {
			const response = await fetch("/api/claude-code", { cache: "no-store" });
			if (!response.ok) throw new Error("status");
			const body = (await response.json()) as ClaudeCodeBody;
			setStatus(body);
			setError(null);
			if (body.loggedIn) notifySettingsSaved("keys");
		} catch {
			setError("Claude Code status could not be read.");
		}
	}

	useEffect(() => {
		void load();
	}, []);

	const detail = status?.loggedIn
		? `Connected${status.subscription ? ` · ${status.subscription}` : ""}`
		: status?.hint ?? "Checking the Claude Code login…";

	return (
		<div className="flex flex-col gap-1" data-testid="claude-code-connection">
			<div className="flex flex-wrap items-center gap-3">
				<span className="font-ui text-xs text-foreground">Claude Code</span>
				<span className="text-xs text-muted-foreground">{detail}</span>
				<button
					type="button"
					className="cursor-pointer font-ui text-xs text-muted-foreground hover:text-foreground"
					onClick={() => void load()}
				>
					Reload
				</button>
			</div>
			{error && <p role="alert" className="text-xs text-red-400">{error}</p>}
		</div>
	);
}
