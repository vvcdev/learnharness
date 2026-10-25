import type { Api, AssistantMessage, Model, SimpleStreamOptions, StreamFunction, TranscriptContext } from "@earendil-works/pi-ai";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { transformMessages } from "@earendil-works/pi-ai/api/transform-messages";
import { claudeCodeAccessToken, CLAUDE_CODE_PROVIDER } from "./claude-code-auth.ts";

const SUFFIX = " No API-key fallback was used.";

export function claudeCodeError(message: string): string {
	if (message.includes(SUFFIX.trim())) return message;
	if (/not signed in|auth login|keychain/i.test(message)) return `Claude Code is not signed in. Run claude auth login in Terminal, then try again.${SUFFIX}`;
	if (/refresh|401|expired/i.test(message)) return `Claude Code login could not be refreshed. Run claude auth login in Terminal.${SUFFIX}`;
	if (/429|limit|quota/i.test(message)) return `Claude Code usage limit reached. Check your Claude plan and try again later.${SUFFIX}`;
	if (/cancel|abort|closed|disconnect/i.test(message)) return `Claude Code request cancelled.${SUFFIX}`;
	return `Claude Code request failed. Check that claude auth status says you are logged in, then retry.${SUFFIX}`;
}

/** Own turns are sent as Anthropic turns so thinking signatures stay valid.
 * Other providers keep the identity they were saved with. */
export function claudeCodeHistory(context: TranscriptContext, logical: Model<Api>): TranscriptContext {
	const messages = transformMessages(context.messages, logical);
	return {
		...context,
		messages: messages.map((message) => message.role === "assistant" && message.provider === CLAUDE_CODE_PROVIDER ? { ...message, provider: "anthropic" } : message),
	};
}

function empty(model: Model<Api>): AssistantMessage {
	return {
		role: "assistant",
		api: model.api,
		provider: CLAUDE_CODE_PROVIDER,
		model: model.id,
		content: [],
		stopReason: "error",
		timestamp: Date.now(),
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	};
}

function withoutAuth(headers: SimpleStreamOptions["headers"]): SimpleStreamOptions["headers"] {
	if (!headers) return headers;
	const next: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		if (value == null) continue;
		if (["authorization", "x-api-key", "api-key"].includes(key.toLowerCase())) continue;
		next[key] = value;
	}
	return next;
}

/** Anthropic's Messages API, authenticated with the Claude Code login.
 * The teacher, quizzes, and tools stay LearnHarness's. `native` is the
 * matching Anthropic catalog model; `dispatch` is that provider's stream. */
export function claudeCodeStream(native: Model<Api>, dispatch: StreamFunction<Api, SimpleStreamOptions>): StreamFunction<Api, SimpleStreamOptions> {
	return (logicalModel, context, options) => {
		const output = new AssistantMessageEventStream();
		void (async () => {
			let partial = empty(logicalModel);
			let terminal = false;
			try {
				if (logicalModel.provider !== CLAUDE_CODE_PROVIDER || native.id !== logicalModel.id) throw new Error("catalog");
				const token = await claudeCodeAccessToken();
				const source = dispatch(native, claudeCodeHistory(context, logicalModel), {
					...options,
					apiKey: token,
					maxRetries: 0,
					headers: withoutAuth(options?.headers),
				});
				for await (const event of source) {
					const message = "partial" in event ? event.partial : event.type === "done" ? event.message : event.error;
					partial = { ...message, provider: CLAUDE_CODE_PROVIDER };
					if (event.type === "error") throw new Error(event.error.errorMessage ?? "Claude Code stream failed");
					if (event.type === "done") {
						if (!terminal) {
							terminal = true;
							output.push({ ...event, message: partial });
						}
					} else if (!terminal) output.push({ ...event, partial });
				}
				if (!terminal) throw new Error("Claude Code stream ended without a response");
			} catch (error) {
				if (terminal) return;
				partial = {
					...partial,
					stopReason: options?.signal?.aborted ? "aborted" : "error",
					errorMessage: claudeCodeError(error instanceof Error ? error.message : ""),
				};
				output.push({ type: "error", reason: partial.stopReason === "aborted" ? "aborted" : "error", error: partial });
			} finally {
				output.end();
			}
		})();
		return output;
	};
}
