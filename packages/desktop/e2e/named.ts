/**
 * Match a control by the name a person would use.
 *
 * After the icon-button pass, many faces have no visible word — the name lives on
 * `aria-label` / `data-ly-tip`. Tests that still read `textContent` time out on a
 * button that is there and labelled. This expression is injected into the page.
 */

export type NamedMode = "exact" | "starts" | "stripCount";

/** A JS predicate for `evaluate` strings. `el` is the element identifier in that page. */
export function named(text: string, mode: NamedMode = "exact", el = "e"): string {
	const needle = JSON.stringify(text);
	const visible = mode === "stripCount"
		? `(${el}.textContent||"").trim().replace(/\\s*\\d+$/, "")`
		: `(${el}.textContent||"").trim()`;
	const aria = `(${el}.getAttribute("aria-label")||"").trim()`;
	const tip = `(${el}.dataset.lyTip||"").trim()`;
	if (mode === "starts") {
		return `(${visible}.startsWith(${needle})||${aria}.startsWith(${needle})||${tip}.startsWith(${needle}))`;
	}
	return `(${visible}===${needle}||${aria}===${needle}||${tip}===${needle})`;
}
