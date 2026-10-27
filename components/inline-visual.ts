import { buildDemoSrcDoc } from "@/components/artifacts/demo-card";

/**
 * Inline visuals (2026-10-27): a ```visual fence in a reply
 * renders in place — instantly, no background job — in the same sandboxed
 * frame the demos use (allow-scripts only, opaque origin), themed with the
 * app's own palette. The pure pieces live here so tests cover them without
 * a DOM; the component lives in md-blocks.tsx beside the other fences.
 */

export type InlineVisualKind = "html" | "svg";

/** Which fences render as a visual: ONLY the ```visual fence (its body is
 *  an <svg> or HTML). Plain ```html / ```svg stay code blocks, so a lesson
 *  that shows markup as text is never turned into a live frame. */
export function inlineVisualKind(language: string, source: string): InlineVisualKind | null {
	if (language.toLowerCase() !== "visual") return null;
	const body = source.trim();
	if (!/<[a-z!]/i.test(body)) return null;
	return /^<svg[\s>]/i.test(body) ? "svg" : "html";
}

/** The palette variables a visual may use — names the prompt teaches. */
export interface VisualTheme {
	bg: string;
	fg: string;
	muted: string;
	panel: string;
	border: string;
	accent: string;
	accent2: string;
	good: string;
	bad: string;
	font: string;
	mono: string;
}

export const DEFAULT_VISUAL_THEME: VisualTheme = {
	bg: "#141414",
	fg: "#e6e6e6",
	muted: "#8d8d8d",
	panel: "#1c1c1c",
	border: "#434343",
	accent: "#6ea8fe",
	accent2: "#f0a35e",
	good: "#5fbf8a",
	bad: "#e07a7a",
	font: "'Source Sans 3', ui-sans-serif, system-ui, sans-serif",
	mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
};

/** The app's live palette (appearance overrides win); defaults off-DOM. */
export function readVisualTheme(): VisualTheme {
	if (typeof document === "undefined") return DEFAULT_VISUAL_THEME;
	const css = getComputedStyle(document.documentElement);
	const get = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
	const d = DEFAULT_VISUAL_THEME;
	return {
		...d,
		bg: get("--background", d.bg),
		fg: get("--foreground", d.fg),
		muted: get("--muted-foreground", d.muted),
		panel: get("--card", d.panel),
		border: get("--border", d.border),
	};
}

const CSP =
	"default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; " +
	"script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; connect-src 'none'";

function themeCss(t: VisualTheme): string {
	return (
		`:root{color-scheme:dark;--bg:${t.bg};--fg:${t.fg};--muted:${t.muted};--panel:${t.panel};--border:${t.border};` +
		`--accent:${t.accent};--accent-2:${t.accent2};--good:${t.good};--bad:${t.bad};--font:${t.font};--mono:${t.mono}}` +
		`*{box-sizing:border-box}html,body{margin:0;background:transparent;color:var(--fg);font:16px/1.45 var(--font)}` +
		`body{padding:12px}svg{display:block;max-width:100%;height:auto;margin:0 auto}` +
		`svg text{font-family:var(--font)}button,input,select{font:inherit;color:inherit}` +
		`button{background:var(--panel);border:1px solid var(--border);border-radius:6px;padding:4px 10px;cursor:pointer}` +
		`input[type=range]{accent-color:var(--accent);width:100%}`
	);
}

/** The full srcdoc: CSP + theme first, the model's markup, the size/error
 *  bridge last. A complete document keeps its own head; fragments and bare
 *  SVGs are wrapped. */
export function buildInlineVisualSrcDoc(source: string, kind: InlineVisualKind, theme: VisualTheme = DEFAULT_VISUAL_THEME): string {
	const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><style>${themeCss(theme)}</style>`;
	let doc: string;
	if (kind === "html" && /<!doctype|<html[\s>]/i.test(source)) {
		if (/<head[^>]*>/i.test(source)) doc = source.replace(/<head[^>]*>/i, (m) => `${m}${head}`);
		else if (/<html[^>]*>/i.test(source)) doc = source.replace(/<html[^>]*>/i, (m) => `${m}<head>${head}</head>`);
		else doc = `<!doctype html><html><head>${head}</head><body>${source}</body></html>`;
	} else {
		doc = `<!doctype html><html><head>${head}</head><body>${source}</body></html>`;
	}
	return buildDemoSrcDoc(doc);
}
