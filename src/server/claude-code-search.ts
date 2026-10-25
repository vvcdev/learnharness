/**
 * Web search through the Claude Code CLI already signed in on this machine.
 * The CLI's own WebSearch tool does the lookup. No Tavily or Brave key.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SearchHit, SearchProvider } from "../core/search.ts";

const SCHEMA = JSON.stringify({
	type: "object",
	properties: {
		results: {
			type: "array",
			items: {
				type: "object",
				properties: {
					title: { type: "string" },
					url: { type: "string" },
					snippet: { type: "string" },
				},
				required: ["title", "url", "snippet"],
			},
		},
	},
	required: ["results"],
});

export function claudeBinary(): string {
	const home = os.homedir();
	const candidates = [
		process.env.CLAUDE_BIN,
		path.join(home, ".npm-global/bin/claude"),
		path.join(home, ".local/bin/claude"),
		"/opt/homebrew/bin/claude",
		"/usr/local/bin/claude",
	].filter((candidate): candidate is string => Boolean(candidate));
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	return "claude";
}

function asHits(value: unknown): SearchHit[] | null {
	const results = (value as { results?: unknown } | null)?.results;
	if (!Array.isArray(results)) return null;
	return results.flatMap((row) => {
		if (!row || typeof row !== "object") return [];
		const hit = row as { title?: unknown; url?: unknown; snippet?: unknown };
		if (typeof hit.url !== "string" || hit.url.length === 0) return [];
		return [{
			title: typeof hit.title === "string" && hit.title ? hit.title : hit.url,
			url: hit.url,
			snippet: typeof hit.snippet === "string" ? hit.snippet.replace(/\n/g, " ").slice(0, 500) : "",
		}];
	});
}

function tryParse(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/** Pull result rows out of a `claude -p --output-format json` payload. */
export function parseClaudeSearchOutput(stdout: string): SearchHit[] {
	const trimmed = stdout.trim();
	const payload = tryParse(trimmed);
	if (!payload || typeof payload !== "object") {
		throw new Error("Claude Code search returned unreadable output");
	}
	const record = payload as { is_error?: boolean; result?: unknown; structured_output?: unknown };
	if (record.is_error) {
		const message = typeof record.result === "string" ? record.result : "Claude Code search failed";
		throw new Error(message.slice(0, 300));
	}
	const structured = record.structured_output
		?? (typeof record.result === "string" ? tryParse(record.result) : record.result);
	const hits = asHits(structured);
	if (!hits) throw new Error("Claude Code search did not return results");
	return hits;
}

function runClaudeSearch(query: string, count: number): Promise<SearchHit[]> {
	const limit = Math.min(Math.max(count, 1), 10);
	const prompt = [
		"Use WebSearch for this query. Return only the structured results.",
		`Query: ${query}`,
		`Return at most ${limit} results.`,
		"Each snippet is one or two sentences from the page.",
	].join("\n");
	return new Promise((resolve, reject) => {
		const child = spawn(claudeBinary(), [
			"-p", prompt,
			"--tools", "WebSearch",
			"--allowedTools", "WebSearch",
			"--permission-prompts", "none",
			"--output-format", "json",
			"--json-schema", SCHEMA,
			"--no-session-persistence",
			"--safe-mode",
		], {
			cwd: os.tmpdir(),
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error("Claude Code search timed out"));
		}, 90_000);
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => { stdout += chunk; });
		child.stderr.on("data", (chunk: string) => { stderr += chunk; });
		child.on("error", (err: Error) => {
			clearTimeout(timer);
			reject(new Error(`Claude Code search could not start: ${err.message}`));
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			if (code !== 0 && stdout.trim().length === 0) {
				reject(new Error(`Claude Code search failed${stderr ? `: ${stderr.slice(0, 200)}` : ""}`));
				return;
			}
			try {
				resolve(parseClaudeSearchOutput(stdout));
			} catch (err) {
				reject(err);
			}
		});
	});
}

export function claudeCodeSearchProvider(): SearchProvider {
	return {
		id: "claude-code",
		search: runClaudeSearch,
	};
}
