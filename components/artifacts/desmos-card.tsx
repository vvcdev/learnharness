"use client";

import { useEffect, useRef, useState } from "react";
import { parseDesmosInput, type ArtifactPartProps } from "@/src/core";

/**
 * The Desmos graph card (owner 2026-10-26): an interactive graphing
 * calculator built from the desmos call's arguments — the learner can
 * pan, zoom, edit, and drag sliders. The API script loads once per page
 * (Desmos's public key — a personal app). Desmos's own light theme
 * (owner 2026-10-26).
 */

const DESMOS_SRC = "https://www.desmos.com/api/v1.11/calculator.js?apiKey=dcb31709b452b1cf9dc26972add0fda6";

interface DesmosCalculator {
	setExpression(e: { id: string; latex: string; color?: string; hidden?: boolean }): void;
	setMathBounds(b: { left: number; right: number; bottom: number; top: number }): void;
	destroy(): void;
}
interface DesmosApi {
	GraphingCalculator(el: HTMLElement, opts: Record<string, unknown>): DesmosCalculator;
}

let loading: Promise<DesmosApi> | null = null;
function loadDesmos(): Promise<DesmosApi> {
	const existing = (window as { Desmos?: DesmosApi }).Desmos;
	if (existing) return Promise.resolve(existing);
	loading ??= new Promise<DesmosApi>((resolve, reject) => {
		const script = document.createElement("script");
		script.src = DESMOS_SRC;
		script.async = true;
		script.onload = () => {
			const api = (window as { Desmos?: DesmosApi }).Desmos;
			if (api) resolve(api);
			else reject(new Error("Desmos did not load"));
		};
		script.onerror = () => {
			loading = null;
			reject(new Error("Desmos did not load"));
		};
		document.head.appendChild(script);
	});
	return loading;
}

export function DesmosCard({ part }: ArtifactPartProps) {
	const input = parseDesmosInput(part.input);
	const ref = useRef<HTMLDivElement>(null);
	const [error, setError] = useState<string | null>(null);
	const settled = part.state === "output-available";
	// One render per settled call — the arguments never change after that.
	const key = settled ? JSON.stringify(input) : null;

	useEffect(() => {
		if (!key || !ref.current) return;
		const graph = JSON.parse(key) as NonNullable<typeof input>;
		let calc: DesmosCalculator | null = null;
		let cancelled = false;
		loadDesmos()
			.then((Desmos) => {
				if (cancelled || !ref.current) return;
				calc = Desmos.GraphingCalculator(ref.current, {
					invertedColors: false,
					keypad: false,
					settingsMenu: false,
					border: false,
				});
				graph.expressions.forEach((e, i) => calc!.setExpression({ id: `e${i}`, ...e }));
				if (graph.bounds) calc.setMathBounds(graph.bounds);
			})
			.catch(() => setError("Couldn't load Desmos — check your internet connection."));
		return () => {
			cancelled = true;
			calc?.destroy();
		};
	}, [key]);

	if (!settled) return null;
	if (!input) {
		return <div className="my-3 text-sm text-muted-foreground">This graph arrived malformed.</div>;
	}
	return (
		<div data-testid="desmos-card" className="my-3 overflow-hidden rounded-xl border border-border bg-card">
			{input.title && (
				<div className="border-b border-border/60 px-3 py-2 font-ui text-xs font-medium uppercase tracking-wide text-muted-foreground">
					{input.title}
				</div>
			)}
			{error ? (
				<div className="p-4 text-sm text-muted-foreground">{error}</div>
			) : (
				<div ref={ref} className="h-[380px] w-full bg-white" />
			)}
		</div>
	);
}
