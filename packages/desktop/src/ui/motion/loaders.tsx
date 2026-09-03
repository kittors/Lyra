/**
 * The mark that says a conversation is busy, for the sidebar.
 *
 * Sized for a list rather than for a line of text: a row here is one mark among many and the
 * question is *which* conversation is working, so it stays inside the space of a character and has
 * to survive being 11px. The transcript asks a different question — what kind of work is this —
 * and answers it with an orb that changes shape per activity; see `RunningIndicator`.
 *
 * From SpinKit (tobiasahlin). Its numbers are worth copying rather than reinventing: every
 * animation there is on a sine curve, and the good ones layer two periods that do not divide into
 * each other, which is what stops a loop from looking like one. An earlier attempt at this was
 * written from scratch with `linear` and evenly spaced geometry, and read as mechanical for
 * precisely that reason.
 *
 * The motion is in `styles.css` — see the Loading section. It walks the palette itself, because
 * the colour is carrying meaning here rather than matching a surround.
 */

/**
 * A pulse leaving a still centre, walking through the palette as it goes.
 *
 * For the sidebar. Nothing rotates and nothing travels, which is what makes it bearable at the
 * edge of vision — there may be several rows working at once, and a column of spinners all coming
 * round at their own rates is a column that will not let you read anything else.
 *
 * The colour walk (accent → info → violet, 2.4s) is what says how long it has been going: a glance
 * says alive, a second look says *still* alive, without anything speeding up or getting louder.
 */
export function BreatheLoader({ size = 14, className = "" }: { size?: number; className?: string }) {
	return (
		<span aria-hidden className={`ly-breathe shrink-0 ${className}`} style={{ width: size, height: size }}>
			{/* Two rings half a period apart, so one is always on its way out; `b` is the core. */}
			<i />
			<i />
			<b />
		</span>
	);
}

/**
 * A faint track with a short arc travelling round it.
 *
 * For a button or a 13px slot that needs to say "working" without borrowing a refresh icon.
 * Stroke weights were picked at 14px: thinner than 3.4 and the arc vanishes into the track.
 */
export function Spinner({ size = 14, className = "" }: { size?: number; className?: string }) {
	const circumference = 2 * Math.PI * 9;
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className={`ly-spin shrink-0 ${className}`}>
			<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3.4" className="text-ink-faint/25" />
			<circle
				cx="12"
				cy="12"
				r="9"
				fill="none"
				stroke="currentColor"
				strokeWidth="3.4"
				strokeLinecap="round"
				strokeDasharray={`${circumference * 0.3} ${circumference}`}
				className="text-ink-muted"
			/>
		</svg>
	);
}
