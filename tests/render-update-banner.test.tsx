/**
 * Update-banner render tests (fork notify-only): uses the update-state
 * snapshot; shows upstream notice + Details (never Restart install).
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import * as ReactDOMClient from "react-dom/client";
import { act } from "react";
import { parseHTML } from "linkedom";
import UpdateBanner from "../components/update-banner.tsx";
import type { UpdateState } from "../components/settings/update-settings.tsx";

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

	it("shows the upstream version from the snapshot without installing", async () => {
		let installed = 0;
		(window as { lh?: unknown }).lh = {
			onUpdateStatus: () => () => {},
			getUpdateState: async () => ({ status: "downloaded", version: "0.3.8", revision: 1 }) satisfies UpdateState,
			installUpdate: () => {
				installed += 1;
			},
		};
		const host = document.createElement("div");
		document.body.appendChild(host);
		const root = ReactDOMClient.createRoot(host);
		await act(async () => {
			root.render(<UpdateBanner />);
		});
		assert.ok(host.innerHTML.includes("0.3.8"), "the version renders");
		assert.ok(host.innerHTML.includes("Details"), "details affordance renders");
		assert.ok(!host.innerHTML.includes("Restart"), "no stock install button");
		const button = host.querySelector<HTMLButtonElement>("[data-testid='update-banner-details']");
		assert.ok(button);
		await act(async () => {
			button!.click();
		});
		assert.equal(installed, 1, "Details asks the shell (dialog), never quit-and-installs itself");
		root.unmount();
		host.remove();
	});
});
