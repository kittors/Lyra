/**
 * "It is working", as one line.
 *
 * The shell of the running indicator, without the main session's meter. Both conversations wait on
 * a model and both should say so in the same voice — the side chat had a spinner and the words
 * 「思考中…」 while the main transcript had an orb and a phrase, which made the panel look like a
 * different application rather than the same one in a narrower column.
 *
 * What it does not do is count. Elapsed time and tokens belong to the main session's turn, and
 * `RunningIndicator` composes them onto this; the side chat passes nothing and gets the orb and the
 * phrase, which is all it has to say.
 */

import type { ReactNode } from "react";
import { ThinkingOrb } from "thinking-orbs";
import type { ComponentProps } from "react";

export function ThinkingLine({
	mood,
	phrase,
	children,
}: {
	mood: ComponentProps<typeof ThinkingOrb>["state"];
	/** The word for what it is doing. Followed by an ellipsis and a separator when anything follows. */
	phrase?: string;
	/** The meter, for the caller that has one. */
	children?: ReactNode;
}) {
	return (
		<div
			role="status"
			aria-live="polite"
			className="ly-enter mb-2.5 flex min-w-0 max-w-full items-center gap-2 overflow-hidden text-detail text-ink-muted whitespace-nowrap"
		>
			{/*
			 * `aria-hidden`, because the line already says what is happening in words — a screen
			 * reader announcing the orb's own label before "Hunting…" is the same fact twice.
			 *
			 * `20` rather than a scaled-down 64: the two sizes are separate designs in that library,
			 * each with its own dot count and speed, and this one is drawn to sit in a line of text.
			 */}
			<ThinkingOrb aria-hidden state={mood} size={20} className="shrink-0" />
			{phrase && (
				<>
					{/* Keyed on the words so one fades in as the other goes, rather than swapping in place. */}
					<span key={phrase} className="ly-fade-in">
						{phrase}…
					</span>
					{children && <span className="text-ink-faint">·</span>}
				</>
			)}
			{children}
		</div>
	);
}
