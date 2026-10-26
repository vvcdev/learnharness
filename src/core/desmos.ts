/**
 * DESMOS GRAPHS (owner 2026-10-26): every agent can drop an interactive
 * Desmos graphing calculator into the conversation — expressions in
 * Desmos LaTeX, optional viewport. The schema + validation live here
 * (pure, browser-safe): the tool validates at call time, the card parses
 * the persisted call to render it.
 */

import { Type, type Static } from "typebox";

export const MAX_DESMOS_EXPRESSIONS = 30;

export const desmosInputObject = Type.Object({
	title: Type.Optional(Type.String({ description: "A short caption shown above the graph." })),
	expressions: Type.Array(
		Type.Object({
			latex: Type.String({
				description:
					"One Desmos expression in Desmos LaTeX, e.g. y=x^2, f(x)=\\sin(x), a=2 (a slider), (1,2) (a point), " +
					"y<2x+1 (a region), r=\\theta (polar).",
			}),
			color: Type.Optional(Type.String({ description: "Optional hex color, e.g. #c74440." })),
			hidden: Type.Optional(Type.Boolean({ description: "Optional: start with this expression hidden." })),
		}),
		{ minItems: 1, maxItems: MAX_DESMOS_EXPRESSIONS, description: "REQUIRED — the expressions, in display order." },
	),
	bounds: Type.Optional(
		Type.Object(
			{
				left: Type.Number(),
				right: Type.Number(),
				bottom: Type.Number(),
				top: Type.Number(),
			},
			{ description: "Optional viewport (math coordinates); omit to let Desmos fit the default view." },
		),
	),
});

export type DesmosInput = Static<typeof desmosInputObject>;

/** Authoring problems (empty = the graph renders). */
export function desmosInputProblems(input: DesmosInput): string[] {
	const problems: string[] = [];
	input.expressions.forEach((e, i) => {
		if (!e.latex.trim()) problems.push(`expressions[${i}].latex is empty`);
		if (e.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(e.color)) problems.push(`expressions[${i}].color must be a hex color like #2d70b3`);
	});
	const b = input.bounds;
	if (b) {
		if (![b.left, b.right, b.bottom, b.top].every(Number.isFinite)) problems.push("bounds must be finite numbers");
		else if (!(b.left < b.right && b.bottom < b.top)) problems.push("bounds need left < right and bottom < top");
	}
	return problems;
}

/** The display parse of a persisted call (null when unusable). */
export function parseDesmosInput(raw: unknown): DesmosInput | null {
	if (!raw || typeof raw !== "object") return null;
	const exprs = (raw as { expressions?: unknown }).expressions;
	if (!Array.isArray(exprs) || exprs.length === 0) return null;
	const expressions = exprs
		.filter((e): e is { latex: string; color?: unknown; hidden?: unknown } => !!e && typeof (e as { latex?: unknown }).latex === "string")
		.slice(0, MAX_DESMOS_EXPRESSIONS)
		.map((e) => ({
			latex: e.latex,
			...(typeof e.color === "string" && /^#[0-9a-fA-F]{6}$/.test(e.color) ? { color: e.color } : {}),
			...(e.hidden === true ? { hidden: true } : {}),
		}));
	if (expressions.length === 0) return null;
	const title = (raw as { title?: unknown }).title;
	const b = (raw as { bounds?: Record<string, unknown> }).bounds;
	const bounds =
		b && [b.left, b.right, b.bottom, b.top].every((n) => typeof n === "number" && Number.isFinite(n)) &&
		(b.left as number) < (b.right as number) &&
		(b.bottom as number) < (b.top as number)
			? { left: b.left as number, right: b.right as number, bottom: b.bottom as number, top: b.top as number }
			: undefined;
	return { expressions, ...(typeof title === "string" && title.trim() ? { title } : {}), ...(bounds ? { bounds } : {}) };
}
