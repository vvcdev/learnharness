import { parseHTML } from "linkedom";

// Imported BEFORE any component module: components pick useLayoutEffect vs
// useEffect once, at load, from `typeof window`.
export const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window, document: dom.document, HTMLElement: dom.window.HTMLElement,
	IS_REACT_ACT_ENVIRONMENT: true,
});
