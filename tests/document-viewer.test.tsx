/**
 * The in-chat document viewer (owner 2026-10-29): header controls, the
 * document switcher, a text document, and the select → Explain flow.
 */
import React, { act } from "react";
(globalThis as { React?: typeof React }).React = React;
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { DocumentViewer, type ViewerDocument, type ViewerMode } from "../components/document-viewer.tsx";
import type { Passage } from "../src/core/passage.ts";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.document, Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const originalFetch = globalThis.fetch;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} disconnect() {} };

const docs: ViewerDocument[] = [
	{ name: "notes.docx", kind: "text", fileUrl: "/f/notes", textUrl: "/t/notes" },
	{ name: "paper.docx", kind: "text", fileUrl: "/f/paper", textUrl: "/t/paper" },
];

afterEach(() => { globalThis.fetch = originalFetch; });

async function mount(over: Partial<React.ComponentProps<typeof DocumentViewer>> = {}, failure?: string) {
	globalThis.fetch = (async (url: string) =>
		failure
			? Response.json({ error: failure }, { status: 422 })
			: Response.json({ text: `Body of ${String(url)}: force equals mass times acceleration` })) as typeof fetch;
	const host = document.createElement("div"); document.body.append(host);
	const root = createRoot(host);
	const calls: { mode: ViewerMode[]; closed: number; explained: Passage[]; picked: string[] } = { mode: [], closed: 0, explained: [], picked: [] };
	await act(async () => root.render(
		<DocumentViewer
			documents={docs}
			current="notes.docx"
			onSelect={(n) => calls.picked.push(n)}
			mode="side"
			onModeChange={(m) => calls.mode.push(m)}
			onClose={() => { calls.closed += 1; }}
			onExplain={(p) => calls.explained.push(p)}
			{...over}
		/>,
	));
	return { host, root, calls, done: async () => { await act(async () => root.unmount()); host.remove(); } };
}

describe("DocumentViewer", () => {
	it("shows the document's text, a switcher for several documents, and the controls", async () => {
		const { host, calls, done } = await mount();
		assert.match(host.querySelector('[data-testid="document-viewer-text"]')!.textContent!, /Body of \/t\/notes/);
		const select = host.querySelector<HTMLSelectElement>('[data-testid="document-viewer-select"]')!;
		assert.deepEqual([...select.querySelectorAll("option")].map((o) => o.textContent), ["notes.docx", "paper.docx"]);
		await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="document-viewer-mode"]')!.click());
		await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="document-viewer-close"]')!.click());
		assert.deepEqual(calls.mode, ["full"]);
		assert.equal(calls.closed, 1);
		assert.equal(host.querySelector("aside")!.getAttribute("data-mode"), "side");
		await done();
	});

	it("full mode offers to go back beside the chat", async () => {
		const { host, calls, done } = await mount({ mode: "full" });
		assert.equal(host.querySelector("aside")!.getAttribute("data-mode"), "full");
		await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="document-viewer-mode"]')!.click());
		assert.deepEqual(calls.mode, ["side"]);
		await done();
	});

	it("a failed read shows the server's message", async () => {
		const { host, done } = await mount({}, "No readable text in notes.docx.");
		assert.equal(host.querySelector('[data-testid="document-viewer-error"]')!.textContent, "No readable text in notes.docx.");
		await done();
	});

	it("selecting text shows Explain, which hands the passage (with its page) to the chat", async () => {
		const { host, calls, done } = await mount();
		const body = host.querySelector<HTMLElement>('[data-testid="document-viewer-text"]')!;
		body.setAttribute("data-page", "4");
		const textNode = body.firstChild!;
		(window as unknown as { getSelection: () => unknown }).getSelection = () => ({
			isCollapsed: false,
			rangeCount: 1,
			getRangeAt: () => ({
				commonAncestorContainer: textNode,
				startContainer: textNode,
				getBoundingClientRect: () => ({ left: 100, width: 60, top: 200 }),
			}),
			toString: () => "  force equals   mass ",
			removeAllRanges: () => {},
		});
		assert.equal(host.querySelector('[data-testid="document-viewer-explain"]'), null, "nothing selected yet");
		await act(async () => host.querySelector("aside")!.dispatchEvent(new window.Event("mouseup", { bubbles: true })));
		const explain = host.querySelector<HTMLButtonElement>('[data-testid="document-viewer-explain"]')!;
		assert.ok(explain, "the pop-up appears");
		await act(async () => explain.click());
		assert.deepEqual(calls.explained, [{ name: "notes.docx", page: 4, text: "force equals mass" }]);
		assert.equal(host.querySelector('[data-testid="document-viewer-explain"]'), null, "pop-up closes after use");
		await done();
	});
});
