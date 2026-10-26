/**
 * Update-banner render tests (fork notify-only): hidden without a push;
 * shows upstream version + Got it dismiss; never calls installUpdate.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import * as ReactDOMClient from "react-dom/client";
import { flushSync } from "react-dom";
import { parseHTML } from "linkedom";
import UpdateBanner from "../components/update-banner.tsx";

const dom = parseHTML("<html><body></body></html>");
(globalThis as Record<string, unknown>).window = dom.window;
(globalThis as Record<string, unknown>).document = dom.document;

describe("update banner (fork notify)", () => {
	afterEach(() => {
		delete (window as { lh?: unknown }).lh;
	});

	it("renders nothing with no bridge (browser / SSR)", () => {
		const html = renderToStaticMarkup(<UpdateBanner />);
		assert.equal(html, "");
	});

	it("renders nothing when the bridge exists but no status has arrived", () => {
		(window as { lh?: unknown }).lh = {
			onUpdateStatus: () => () => {},
			installUpdate: () => {},
		};
		const html = renderToStaticMarkup(<UpdateBanner />);
		assert.equal(html, "");
	});

	it("shows the upstream version and dismisses without installing", async () => {
		let pushed: ((s: { status: string; version: string | null }) => void) | null = null;
		let installed = 0;
		(window as { lh?: unknown }).lh = {
			onUpdateStatus: (cb: (s: { status: string; version: string | null }) => void) => {
				pushed = cb;
				return () => {};
			},
			installUpdate: () => {
				installed += 1;
			},
		};
		const host = document.createElement("div");
		document.body.appendChild(host);
		const root = ReactDOMClient.createRoot(host);
		flushSync(() => root.render(<UpdateBanner />));
		assert.equal(host.innerHTML, "", "hidden before the push");

		await new Promise((r) => setTimeout(r, 0));
		flushSync(() => pushed?.({ status: "available", version: "0.3.8" }));
		assert.ok(host.innerHTML.includes("0.3.8"), "the version renders");
		assert.ok(host.innerHTML.includes("Got it"), "dismiss affordance renders");
		assert.ok(!host.innerHTML.includes("Restart"), "no stock install button");

		const button = host.querySelector<HTMLButtonElement>("[data-testid='update-banner'] button");
		assert.ok(button, "dismiss button exists");
		flushSync(() => button!.click());
		assert.equal(host.querySelector("[data-testid='update-banner']"), null, "dismissed");
		assert.equal(installed, 0, "dismiss never installs a stock update");
		root.unmount();
		host.remove();
	});
});
