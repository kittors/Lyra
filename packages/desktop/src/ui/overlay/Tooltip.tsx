import { cloneElement } from "react";

/**
 * The app's tooltip, as a wrapper for JSX that reads better than an attribute.
 *
 * It only tags its child — the bubble itself is drawn by the single document-level listener in
 * `tooltip.ts`. Both spellings therefore behave identically, which matters because the find
 * panel's buttons are built by CodeMirror and can only be reached by attribute.
 *
 * Replaces the browser's `title`: that one cannot be styled, waits about a second and a half,
 * ignores the app's font and theme, and on macOS renders as a system panel that looks like it
 * belongs to another program entirely.
 */
export function Tooltip({
	label,
	children,
	side = "bottom",
}: {
	label: string;
	children: React.ReactElement;
	side?: "top" | "bottom";
}) {
	return cloneElement(children, { "data-ly-tip": label, "data-ly-tip-side": side } as Record<string, string>);
}
