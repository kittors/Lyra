import { createElement } from "react";

/**
 * The app's type scale, as a component.
 *
 * The steps themselves live in `styles.css`, where each carries its own leading and tracking and
 * is derived from the one size the user sets. This file only says which step goes with which
 * weight — and that pairing is the part that was missing.
 *
 * Hierarchy here used to be carried by size alone, across steps half a pixel apart: 12.5 for a
 * row, 12 for the line under it, 11.5 for the one under that. Half a pixel is not a difference
 * anybody sees. It does not read as three levels; it reads as one level typeset carelessly.
 *
 * So each step is paired with a weight once, below. A heading is bigger *and* heavier, a caption
 * smaller *and* fainter, and the levels separate on two axes at once instead of on a fraction of
 * one. `weight` is still there to override, for the cases where a row needs emphasis without
 * changing size — but the default should be right often enough that it is rarely reached for.
 */
const SIZES = {
	/** Page titles — one per screen. */
	display: "text-display",
	/** The heading of a screen's major division. */
	heading: "text-heading",
	/** Section and card headings. */
	title: "text-title",
	/** Prose: messages, descriptions, anything read a sentence at a time. */
	body: "text-body",
	/** Controls, rows, table cells — the app's working size. */
	label: "text-label",
	/** Secondary detail sitting under a label. */
	detail: "text-detail",
	/** Timestamps, counts, badges. */
	caption: "text-caption",
} as const;

const TONES = {
	default: "text-ink",
	muted: "text-ink-muted",
	faint: "text-ink-faint",
	danger: "text-danger",
	accent: "text-accent",
} as const;

const WEIGHTS = {
	normal: "",
	medium: "font-medium",
	semibold: "font-semibold",
} as const;

/**
 * What each step weighs when nobody says otherwise.
 *
 * Headings take the weight because size alone stops separating things once the gaps are small;
 * running text does not, because bold prose is harder to read, not more important.
 */
const DEFAULT_WEIGHT: Record<keyof typeof SIZES, keyof typeof WEIGHTS> = {
	display: "semibold",
	heading: "semibold",
	title: "medium",
	body: "normal",
	label: "normal",
	detail: "normal",
	caption: "normal",
};

export function Text({
	size = "label",
	tone = "default",
	weight,
	as = "span",
	mono = false,
	numeric = false,
	className = "",
	children,
	...rest
}: {
	size?: keyof typeof SIZES;
	tone?: keyof typeof TONES;
	/** Overrides the weight this step is normally set in. */
	weight?: keyof typeof WEIGHTS;
	/** The element to render. `span` by default so it can sit inside a sentence. */
	as?: "span" | "p" | "div" | "h1" | "h2" | "h3" | "label" | "code";
	/** The code face, for identifiers and paths quoted inside prose. */
	mono?: boolean;
	/**
	 * Fixed-width digits.
	 *
	 * For numbers that change in place — token counts, timers, diff stats. Proportional digits
	 * make the text shuffle sideways on every tick, which reads as flicker.
	 */
	numeric?: boolean;
	className?: string;
	children?: React.ReactNode;
} & React.HTMLAttributes<HTMLElement>) {
	return createElement(
		as,
		{
			...rest,
			className: [
				SIZES[size],
				TONES[tone],
				WEIGHTS[weight ?? DEFAULT_WEIGHT[size]],
				mono ? "font-mono" : "",
				numeric ? "tabular-nums" : "",
				className,
			]
				.filter(Boolean)
				.join(" "),
		},
		children,
	);
}
