/**
 * The session category chip (owner, 2026-10-25): every session's top bar
 * says TEACHING or PRACTICE, colored, and clicking it asks the sidebar to
 * show that section.
 */

import React from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionKindChip, SHOW_SESSION_KIND_EVENT, showSessionKind } from "../components/session-kind-chip.tsx";

describe("SessionKindChip", () => {
	it("teaching: blue pill, TEACHING label", () => {
		const html = renderToStaticMarkup(<SessionKindChip kind="teach" />);
		assert.ok(html.includes('data-kind="teach"'));
		assert.ok(html.includes(">Teaching<") || html.includes("Teaching"));
		assert.ok(html.includes("text-blue-500"));
	});

	it("practice: green pill, PRACTICE label", () => {
		const html = renderToStaticMarkup(<SessionKindChip kind="practice" />);
		assert.ok(html.includes('data-kind="practice"'));
		assert.ok(html.includes("Practice"));
		assert.ok(html.includes("text-green-500"));
	});

	it("the click dispatches the sidebar's show-section event with the kind", () => {
		const seen: unknown[] = [];
		const target = new EventTarget();
		const g = globalThis as unknown as { window?: EventTarget };
		const had = g.window;
		g.window = target;
		target.addEventListener(SHOW_SESSION_KIND_EVENT, (e) => seen.push((e as CustomEvent).detail));
		try {
			showSessionKind("practice");
		} finally {
			g.window = had;
		}
		assert.deepEqual(seen, ["practice"]);
	});
});
