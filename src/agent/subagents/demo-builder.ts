import { randomUUID } from "node:crypto";
import type { AssistantMessage, Message, Tool, ToolResultMessage, Usage } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { piEngineFor, type PiEngine } from "../models.ts";
import { providerEventObserver } from "../provider-events.ts";
import type { DemoResult } from "../../core/contracts.ts";
import { getHeadless, type DemoInteractResult, type DemoRunResult, type DemoStep, type HeadlessApi } from "./headless.ts";
import { snippetAround, streamOnce, toolText } from "./visual-maker.ts";

/**
 * The demo-builder sub-agent (vision §2 interactive demos + §2.5 "sub-agents
 * verify; they never one-shot"): given a brief it writes a self-contained
 * single-file HTML/JS demo, then TESTS IT HEADLESSLY — error check
 * (run_demo), LOOKING at a screenshot (screenshot_demo), and OPERATING its
 * controls (interact_demo) — iterating until clean before anything reaches
 * the lesson.
 *
 * LOOP SHAPE: hand-rolled like visual-maker (the loop must feed IMAGES back
 * to the model after each screenshot/interaction). The tools are declared
 * without execute; this loop runs them and appends the PNGs as a user
 * message after the tool results.
 *
 * Delivery gate (code-enforced): the delivered html must have a clean
 * run_demo, a screenshot the model saw, and at least one interact_demo pass
 * with no step or page errors. A finish attempt missing any of these is
 * bounced back (the loop runs/shows what it can itself).
 *
 * Failure semantics: `tested: true` means "the verify loop ran"; on failure
 * the result is { title, html: "", tested: true, notes: "FAILED: <reason>" }
 * — the card renders the failure note, no iframe. The job wrapper treats
 * html === "" as failure and marks the job error.
 */

export interface DemoBuilderInput {
	title: string;
	brief: string;
}

export interface DemoBuilderOptions {
	/** Test seam: scripted engine; production uses the demoBuilder role. */
	engine?: PiEngine;
	headless?: HeadlessApi;
	/** Max model rounds (write/test/fix cycles + final answer). Default 16. */
	maxSteps?: number;
	/** Live activity-line callback (updates the job record). */
	onActivity?: (line: string) => void;
	/** Kills the run mid-model-call (2026-09 real-kill abort semantics). */
	abortSignal?: AbortSignal;
	/** Money channel: one call per loop iteration, folded into JobRecord.usage. */
	onUsage?: (usage: Usage) => void;
	/** Debug: raw provider-event recording key (LH_PROVIDER_EVENTS=1). */
	chatId?: string;
}

const INSTRUCTIONS = `You are a demo builder — a specialist sub-agent inside a learning application. You
receive a brief for ONE interactive teaching instrument and deliver a single self-contained HTML document
that runs it. You never see the lesson; the brief is everything you know.

Runtime contract (the document runs in a sandboxed iframe, sandbox="allow-scripts", opaque origin):
- Single file. Vanilla JS + Canvas 2D or SVG. CDN imports (e.g. a plotting or math library) are allowed
  when they genuinely help — but prefer dependency-free; you own the failure if a CDN import fails.
- NO localStorage, sessionStorage, or document.cookie — the sandbox makes them throw.
- The parent sizes the iframe to the document height automatically; just build normal flowing layout.
  Make the demo fill the width and size its own height sensibly.

Build quality:
- The demo must directly serve the brief: every control named in the brief must exist and do the thing.
- Controls need labels and stable ids (so they can be driven); sliders/inputs need current-value readouts.
  A learner should operate it unguided.
- Teach with it: change ONE parameter at a time and show its effect immediately; give a Reset button; where
  the brief invites it, let the learner predict first and then reveal; show the quantity that matters as a
  live number next to the picture. Label axes and units.
- Smooth enough interaction; requestAnimationFrame for animation, not setInterval when it matters.
- Design it for its subject: a deliberate palette (4-6 colors) and type pairing chosen for the topic, one
  memorable element, everything else quiet. No purple gradients, no default Inter-on-white template look,
  no identical rounded cards, no decoration that carries no information. Visible focus states, readable
  contrast, text at 14px or larger, controls large enough to grab.
- Dark-mode neutral: pick a clean light background for the demo area so it reads on any card.

THE HOUSE RULE — never deliver untested, never deliver unseen:
1. write_demo with the complete HTML document (edit_demo for a surgical one-spot fix: old_text must
   appear EXACTLY ONCE).
2. run_demo: loads it headlessly and reports console errors, uncaught errors and failed requests. Optionally
   pass a probe: a JS expression evaluated in the page (e.g. "typeof window.simulate === 'function'").
3. screenshot_demo: LOOK at the page. The image arrives in the next message. Is anything blank, clipped,
   overlapping, unreadable, or off-brief? A canvas that is empty on load is a bug.
4. interact_demo({ steps }): operate the controls like a learner and look at the result. Steps run in
   order; each is one of click {selector}, set_value {selector, value} (sliders, selects, inputs; checkbox
   "true"/"false"), type {selector, text}, drag {selector, to_selector | dx, dy}, wait {ms}. The result is a
   screenshot plus any step or page errors. Change the picture, then check it actually changed and is
   still correct.
5. Fix whatever you find (edit_demo / write_demo) and test again. You are done only when the final document
   ran clean, you LOOKED at it, and you drove at least one control with no errors.

Your final message is 1-3 sentences of NOTES for the teacher (what the demo shows, its controls, what to
try) — NEVER the HTML itself. Never claim success you did not see.`;

/** The wire declarations: this loop owns execution (the screenshot tools
 *  feed images back), so the declarations carry no execute. */
export function createDemoTools(): Record<string, Tool> {
	return {
		write_demo: {
			name: "write_demo",
			description:
				"Write the complete self-contained HTML document for the demo (overwrites any previous version). Follow with run_demo, screenshot_demo and interact_demo.",
			parameters: Type.Object({
				html: Type.String({ description: "The complete HTML document: <!doctype html>…</html>, all JS inline." }),
			}),
		},
		edit_demo: {
			name: "edit_demo",
			description:
				"Replace one exact spot in the current document: old_text must appear EXACTLY ONCE and is replaced by new_text. Call write_demo first. For larger changes, write_demo the whole document.",
			parameters: Type.Object({
				old_text: Type.String({ description: "The exact text to replace — must match exactly once." }),
				new_text: Type.String({ description: "The replacement text." }),
			}),
		},
		run_demo: {
			name: "run_demo",
			description:
				"Headlessly execute the current demo and report console errors, uncaught errors, and failed requests. Optionally pass a probe expression to assert on page state.",
			parameters: Type.Object({
				probe: Type.Optional(
					Type.String({
						description: "Optional JS expression evaluated in the page after settling, e.g. \"document.querySelectorAll('input').length\".",
					}),
				),
			}),
		},
		screenshot_demo: {
			name: "screenshot_demo",
			description: "Load the current demo and show you a screenshot of it for inspection. No arguments.",
			parameters: Type.Object({}),
		},
		interact_demo: {
			name: "interact_demo",
			description:
				"Load the current demo, run interaction steps in order (stops at the first failing step), and show you a screenshot of the result plus any errors.",
			parameters: Type.Object({
				steps: Type.Array(
					Type.Object({
						action: Type.Union(
							[Type.Literal("click"), Type.Literal("set_value"), Type.Literal("drag"), Type.Literal("type"), Type.Literal("wait")],
							{ description: "What to do." },
						),
						selector: Type.Optional(Type.String({ description: "CSS selector of the target element (not for wait)." })),
						value: Type.Optional(Type.String({ description: 'set_value: the value to set ("true"/"false" for checkboxes).' })),
						text: Type.Optional(Type.String({ description: "type: text to type into the element." })),
						to_selector: Type.Optional(Type.String({ description: "drag: element to drop onto." })),
						dx: Type.Optional(Type.Number({ description: "drag: horizontal offset in px when no to_selector." })),
						dy: Type.Optional(Type.Number({ description: "drag: vertical offset in px when no to_selector." })),
						ms: Type.Optional(Type.Number({ description: "wait: milliseconds (max 3000)." })),
					}),
					{ minItems: 1, description: "The steps, in order." },
				),
			}),
		},
	};
}

function summarizeCounts(result: DemoRunResult): string {
	const counts = [
		result.consoleErrors.length > 0 ? `${result.consoleErrors.length} console error${result.consoleErrors.length === 1 ? "" : "s"}` : null,
		result.pageErrors.length > 0 ? `${result.pageErrors.length} page error${result.pageErrors.length === 1 ? "" : "s"}` : null,
		result.failedRequests.length > 0 ? `${result.failedRequests.length} failed request${result.failedRequests.length === 1 ? "" : "s"}` : null,
	].filter(Boolean);
	return counts.length > 0 ? counts.join(", ") : "ok";
}

function formatRunResult(result: DemoRunResult): string {
	if (result.ok) {
		const probe =
			result.probeResult !== undefined
				? ` Probe result: ${JSON.stringify(result.probeResult) ?? "undefined"}.`
				: "";
		return `PASSED: no console errors, no uncaught errors, no failed requests.${probe} Next: screenshot_demo, then interact_demo.`;
	}
	const sections: string[] = [`FAILED: ${summarizeCounts(result)}.`];
	if (result.consoleErrors.length > 0)
		sections.push(`Console errors:\n${result.consoleErrors.slice(0, 10).map((e) => `- ${e}`).join("\n")}`);
	if (result.pageErrors.length > 0)
		sections.push(`Uncaught errors:\n${result.pageErrors.slice(0, 10).map((e) => `- ${e}`).join("\n")}`);
	if (result.failedRequests.length > 0)
		sections.push(`Failed requests:\n${result.failedRequests.slice(0, 10).map((r) => `- ${r}`).join("\n")}`);
	sections.push("Fix the document (edit_demo / write_demo) and re-test (run_demo).");
	return sections.join("\n");
}

function formatInteractResult(result: DemoInteractResult): string {
	const lines = [result.ok ? "Steps ran with no errors." : "PROBLEMS found.", ...result.stepLog];
	if (result.consoleErrors.length > 0) lines.push(`Console errors:\n${result.consoleErrors.slice(0, 10).map((e) => `- ${e}`).join("\n")}`);
	if (result.pageErrors.length > 0) lines.push(`Uncaught errors:\n${result.pageErrors.slice(0, 10).map((e) => `- ${e}`).join("\n")}`);
	lines.push("The screenshot of the result follows in the next message — check it changed as the brief says.");
	return lines.join("\n");
}

/** Short summary of a run for failure notes. */
function failureSummary(result: DemoRunResult | null): string {
	if (!result) return "never tested";
	const details = [...result.consoleErrors, ...result.pageErrors, ...result.failedRequests].slice(0, 5);
	return details.length > 0 ? `${summarizeCounts(result)} — ${details.join(" | ")}` : summarizeCounts(result);
}

const LOOK_MESSAGE = "Here is what the demo looks like — inspect it critically (blank areas, clipping, overlap, readability, brief fidelity):";
const INTERACT_MESSAGE = "Here is the demo after your interaction steps — did the picture change the way the brief says it should?";

/** Steps the model sent, validated down to DemoStep[] (null = malformed). */
function parseSteps(raw: unknown): DemoStep[] | null {
	if (!Array.isArray(raw) || raw.length === 0) return null;
	const actions = ["click", "set_value", "drag", "type", "wait"];
	const out: DemoStep[] = [];
	for (const item of raw) {
		if (typeof item !== "object" || item === null) return null;
		const step = item as DemoStep;
		if (!actions.includes(step.action)) return null;
		out.push(step);
	}
	return out;
}

export async function runDemoBuilder(input: DemoBuilderInput, opts: DemoBuilderOptions = {}): Promise<DemoResult> {
	const headless = opts.headless ?? getHeadless();
	const title = input.title.trim() || "Interactive demo";
	const brief = input.brief.trim() || "(no brief)";
	const maxRounds = opts.maxSteps ?? 16;
	const notes = (text: string) => (text.trim() ? text.trim() : undefined);
	const fail = (reason: string): DemoResult => ({ title, html: "", tested: true, notes: `FAILED: ${reason}` });

	const reason = headless.unavailableReason();
	if (reason) return fail(reason);

	const toolDeclarations = Object.values(createDemoTools());
	const engine = opts.engine ?? piEngineFor("demoBuilder");
	const sessionId = randomUUID();
	const prompt = [
		`Demo title: ${title}`,
		`Brief (all you know about the lesson — this comes from the teacher, verbatim):`,
		brief,
		"",
		"Build the demo, run it, look at it, operate its controls, iterate until it is right, then finish with your notes.",
	].join("\n");

	let messages: Message[] = [{ role: "user", content: prompt, timestamp: Date.now() }];
	let html: string | null = null;
	// What each check has seen: the html string it covered (null = never).
	let cleanRunHtml: string | null = null;
	let lastRun: DemoRunResult | null = null;
	let lookedHtml: string | null = null;
	let interactedHtml: string | null = null;
	let finalText = "";

	const image = (png: Buffer) => ({ type: "image" as const, data: png.toString("base64"), mimeType: "image/png" });
	const delivered = () =>
		html !== null && cleanRunHtml === html && lookedHtml === html && interactedHtml === html;

	try {
		for (let round = 0; round < maxRounds; round++) {
			const result = await streamOnce(
				engine,
				INSTRUCTIONS,
				messages,
				toolDeclarations,
				sessionId,
				engine.level,
				opts.abortSignal,
				opts.chatId ? providerEventObserver(opts.chatId, "job:demoBuilder") : undefined,
			);
			opts.onUsage?.(result.usage);
			messages = [...messages, result];

			const toolCalls = result.content.filter((c): c is Extract<typeof c, { type: "toolCall" }> => c.type === "toolCall");
			if (toolCalls.length === 0) {
				finalText = result.content
					.filter((c): c is { type: "text"; text: string } => c.type === "text")
					.map((c) => c.text)
					.join("")
					.trim();
				if (!html) return fail(`the builder never wrote a demo.${finalText ? ` (${finalText.slice(0, 300)})` : ""}`);
				if (delivered()) return { title, html, tested: true, notes: notes(finalText) };

				// Delivery gate: run/show whatever the model skipped, then bounce
				// the finish back so it reacts to what the checks found.
				const bounce: string[] = ["You finished before the demo was fully verified."];
				const images: Array<ReturnType<typeof image>> = [];
				if (cleanRunHtml !== html) {
					opts.onActivity?.("final verification");
					try {
						lastRun = await headless.runDemo(html);
					} catch (err) {
						return fail(`final verification crashed — ${err instanceof Error ? err.message : String(err)}`);
					}
					if (lastRun.ok) cleanRunHtml = html;
					bounce.push(lastRun.ok ? "run_demo (run by the harness): PASSED." : formatRunResult(lastRun));
				}
				if (lookedHtml !== html) {
					try {
						images.push(image(await headless.screenshotDemo(html)));
						lookedHtml = html;
						bounce.push("The screenshot of the current demo follows — you had not looked at it.");
					} catch (err) {
						return fail(`the final screenshot failed — ${err instanceof Error ? err.message : String(err)}`);
					}
				}
				if (interactedHtml !== html) {
					bounce.push("You have not yet driven the controls: call interact_demo with at least one step that changes the demo, and check the result.");
				}
				bounce.push("If everything is correct, reply with just your notes; otherwise fix and test again.");
				messages = [
					...messages,
					{
						role: "user",
						content: [{ type: "text", text: bounce.join("\n") }, ...images],
						timestamp: Date.now(),
					},
				];
				continue;
			}

			const toolResults: ToolResultMessage[] = [];
			const images: Array<{ text: string; png: Buffer }> = [];
			for (const call of toolCalls) {
				const args = call.arguments as Record<string, unknown>;
				if (call.name === "write_demo") {
					const doc = args.html;
					if (typeof doc !== "string" || doc.trim().length === 0) {
						toolResults.push(toolText(call.id, call.name, "ERROR: empty document — write the full HTML in the `html` field."));
						continue;
					}
					html = doc;
					opts.onActivity?.(`write_demo: ${(doc.length / 1024).toFixed(1)} KB`);
					toolResults.push(toolText(call.id, call.name, `Saved (${doc.length} bytes). Now test it: run_demo, screenshot_demo, interact_demo.`));
				} else if (call.name === "edit_demo") {
					if (!html) {
						toolResults.push(toolText(call.id, call.name, "ERROR: nothing to edit — call write_demo first."));
						continue;
					}
					const { old_text, new_text } = args;
					if (typeof old_text !== "string" || typeof new_text !== "string" || !old_text) {
						toolResults.push(toolText(call.id, call.name, "ERROR: expected old_text (non-empty) and new_text strings."));
						continue;
					}
					const occurrences = html.split(old_text).length - 1;
					if (occurrences === 0) {
						toolResults.push(toolText(call.id, call.name, `ERROR: old_text not found. Closest line for reference:\n${snippetAround(html, old_text)}`));
						continue;
					}
					if (occurrences > 1) {
						toolResults.push(toolText(call.id, call.name, `ERROR: old_text appears ${occurrences} times — it must match EXACTLY ONCE. Include more surrounding context to make it unique.`));
						continue;
					}
					html = html.replace(old_text, () => new_text);
					opts.onActivity?.("edit_demo: applied");
					toolResults.push(toolText(call.id, call.name, "OK — replaced 1 occurrence. Re-test the edited demo."));
				} else if (call.name === "run_demo") {
					if (!html) {
						toolResults.push(toolText(call.id, call.name, "ERROR: nothing to run — call write_demo first."));
						continue;
					}
					try {
						const probe = typeof args.probe === "string" && args.probe ? args.probe : undefined;
						const run = await headless.runDemo(html, probe ? { probe } : undefined);
						lastRun = run;
						if (run.ok) cleanRunHtml = html;
						opts.onActivity?.(run.ok ? "run_demo: clean" : `run_demo: ${summarizeCounts(run)}`);
						toolResults.push(toolText(call.id, call.name, formatRunResult(run)));
					} catch (err) {
						opts.onActivity?.("run_demo: browser error");
						toolResults.push(toolText(call.id, call.name, `ERROR: HEADLESS ERROR (retrying may help): ${err instanceof Error ? err.message : String(err)}`));
					}
				} else if (call.name === "screenshot_demo") {
					if (!html) {
						toolResults.push(toolText(call.id, call.name, "ERROR: nothing to screenshot — call write_demo first."));
						continue;
					}
					try {
						images.push({ text: LOOK_MESSAGE, png: await headless.screenshotDemo(html) });
						lookedHtml = html;
						opts.onActivity?.("screenshot_demo: inspecting");
						toolResults.push(toolText(call.id, call.name, "Screenshot taken — the image follows in the next message. Look at it."));
					} catch (err) {
						opts.onActivity?.("screenshot_demo: browser error");
						toolResults.push(toolText(call.id, call.name, `ERROR: screenshot failed (retrying may help): ${err instanceof Error ? err.message : String(err)}`));
					}
				} else if (call.name === "interact_demo") {
					if (!html) {
						toolResults.push(toolText(call.id, call.name, "ERROR: nothing to interact with — call write_demo first."));
						continue;
					}
					const steps = parseSteps(args.steps);
					if (!steps) {
						toolResults.push(toolText(call.id, call.name, "ERROR: expected a non-empty `steps` array of {action: click|set_value|drag|type|wait, selector, …}."));
						continue;
					}
					try {
						const run = await headless.interactDemo(html, steps);
						images.push({ text: INTERACT_MESSAGE, png: run.png });
						lookedHtml = html;
						// Only real operation counts: a wait-only script touches nothing.
						if (run.ok && steps.some((s) => s.action !== "wait")) interactedHtml = html;
						opts.onActivity?.(run.ok ? "interact_demo: clean" : "interact_demo: problems");
						toolResults.push(toolText(call.id, call.name, formatInteractResult(run)));
					} catch (err) {
						opts.onActivity?.("interact_demo: browser error");
						toolResults.push(toolText(call.id, call.name, `ERROR: interaction failed (retrying may help): ${err instanceof Error ? err.message : String(err)}`));
					}
				} else {
					toolResults.push(toolText(call.id, call.name, `ERROR: unknown tool "${call.name}". Use write_demo, edit_demo, run_demo, screenshot_demo, or interact_demo.`));
				}
			}
			// Message order: assistant tool-calls → tool results → images.
			messages = [...messages, ...toolResults];
			if (images.length > 0) {
				messages = [
					...messages,
					{
						role: "user",
						content: images.flatMap((i) => [{ type: "text" as const, text: i.text }, image(i.png)]),
						timestamp: Date.now(),
					},
				];
			}
		}
	} catch (err) {
		return fail(`the builder crashed — ${err instanceof Error ? err.message : String(err)}`);
	}

	// Round limit: deliver nothing that has not passed the whole gate.
	if (html && delivered()) {
		return { title, html, tested: true, notes: notes(finalText) ?? "Round limit reached — delivering the last verified demo." };
	}
	if (!html) return fail(`round limit (${maxRounds}) reached before the builder wrote a demo.`);
	const missing = [
		cleanRunHtml !== html ? `a clean run (${failureSummary(lastRun)})` : null,
		lookedHtml !== html ? "a look at the screenshot" : null,
		interactedHtml !== html ? "a clean interact_demo pass" : null,
	].filter(Boolean);
	return fail(`the demo never passed verification — missing ${missing.join(", ")} (round limit ${maxRounds}).`);
}
