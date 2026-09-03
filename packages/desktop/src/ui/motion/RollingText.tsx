import { useState } from "react";

/**
 * The box holding the value — the thing that rolls, and the thing that overflows.
 *
 * Exported because a parent that truncates has to be able to find it: the wrapper's own width is
 * bounded by its parent, so the wrapper never overflows, and anything measuring "is this being
 * cut" has to ask the box inside. `ComposerShell` does exactly that.
 */
export const ROLL_VALUE = "ly-roll-value";

/**
 * A value replacing a value, wherever that happens.
 *
 * Text that changes in place — the effort level in the composer, the model you just picked, the
 * permission mode, 展开显示 turning into 收起 — was swapped outright everywhere except the two
 * places that had remembered to write `key={value}` and `ly-roll` by hand. Swapped outright, the
 * eye gets no signal that anything happened beyond the glyphs being different: on a control you
 * are dragging that reads as a rendering artefact, and on one you just clicked it reads as the
 * click having done nothing.
 *
 * The motion is `.ly-roll` in styles.css — downward, always, so a run of changes reads as one
 * thing being turned rather than as text flickering. This component is what makes reaching for it
 * a matter of using the right element rather than of remembering a two-part idiom.
 *
 * For labels, not for readings. A number that ticks — a token count, a timer, a percentage — is
 * changing continuously rather than being replaced, and rolling every tick turns a quiet gauge
 * into something moving in the corner of your eye for the length of a turn. Those hold still with
 * `tabular-nums` instead.
 */
export function RollingText({
	children,
	className = "",
	rollKey,
}: {
	children: string | number;
	/** Lands on the outer element, which is `inline` by default — give it `block` where it needs to be. */
	className?: string;
	/** Overrides what counts as "a different value", for text carrying a part that always changes. */
	rollKey?: string | number;
}) {
	const value = rollKey ?? children;
	const rolls = useRolled(value);

	return (
		<span className={className}>
			{/*
			 * `inline-block`, because `transform` does nothing to an inline box — the roll would be a
			 * bare fade, which is what the two hand-written versions of this were getting. `max-w-full`
			 * so it stays inside a parent that truncates rather than pushing through it.
			 *
			 * `ly-roll-value` is the handle a truncating parent needs. Staying inside that parent is
			 * not the same as being elided by it: an inline-block is an atomic box, `text-overflow`
			 * does not apply to one, and `overflow: hidden` simply cuts it — which is why a model name
			 * too long for the composer ended mid-glyph with no ellipsis. See the rule in styles.css.
			 */}
			<span key={value} className={`${ROLL_VALUE} inline-block max-w-full ${rolls ? "ly-roll" : ""}`}>
				{children}
			</span>
		</span>
	);
}

/**
 * Whether this value has ever been replaced — false on the first paint, true from the first
 * change onwards.
 *
 * Two things depend on getting this right, and they pull in opposite directions.
 *
 * The first paint must not animate. Rolling on mount means every label in a menu drops into place
 * as the menu opens, on top of the menu's own entrance — two motions in different directions,
 * which reads as the panel being assembled in front of you.
 *
 * But the class must not come and go either, and this is the subtler one: adding `animation` to an
 * element *starts* that animation. A flag that went back to false on the next unrelated render
 * would re-add the class on the render after that, and every label in the composer would roll
 * whenever any one of them changed. So it latches: once true, always true, and from then on the
 * animation is driven purely by the remount that a changed `key` causes.
 *
 * Adjusting state during render is the supported way to derive it from a prop that changed —
 * React discards this pass and re-runs the component immediately, so the class and the new key
 * land in the same commit and the element mounts already animating.
 */
export function useRolled(value: string | number): boolean {
	const [seen, setSeen] = useState(value);
	const [rolls, setRolls] = useState(false);

	if (seen !== value) {
		setSeen(value);
		setRolls(true);
	}

	return rolls;
}
