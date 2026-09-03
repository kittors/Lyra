/**
 * The one piece of the window that says a newer version exists, and how far along fetching it is.
 *
 * A dot at the end of the sidebar's bottom row that opens on hover to show what it is about. Two
 * earlier attempts sat in the toolbar: first a grey glyph among the window controls, which went a
 * whole release being read as another window control and reported as "there is no update"; then a
 * chip reading 「新版本 0.3.0」, which fixed that by taking the top-left corner of the window and
 * holding it for something that is not urgent and is not about the document.
 *
 * The dot is what both were reaching for. Coloured, so it is visibly an announcement rather than a
 * control; the size of a full stop, so it costs the window nothing; and the words — the part that
 * made the chip wide — are a hover away.
 *
 * What is new here is that it keeps saying something while a download runs. A ring closes around
 * the dot as the bytes arrive, and it survives the dialog being closed, because the download does:
 * the state lives in the main process and this subscribes to it. Before, closing the dialog had to
 * be *forbidden* mid-download — there would have been nothing left to report to — so a 130MB fetch
 * held the screen for as long as it took.
 *
 * Clicking always opens the dialog, in every phase, including while downloading. Pausing from a
 * 20px circle would be a control small enough to hit by accident on the way to something else, and
 * what it would interrupt is the longest operation in the app.
 *
 * Nothing here takes it off screen. It appears when a newer version exists and leaves when that
 * stops being true, which is to say when the update has been installed. 以后再说 used to hide it
 * for the version in hand, and that was reported as a bug the day it shipped — correctly: the dot
 * is not a notification to be acknowledged, it is where you go to find the update, and a place you
 * go to is not somewhere that can be dismissed. The dialog's second button is now just 关闭.
 */

import { AlertTriangle, ArrowDownToLine, Pause, RefreshCw } from "lucide-react";
import { useState } from "react";

import { useUpdate } from "./store.ts";
import { fractionOf, labelFor, shouldShow, type Phase } from "./view.ts";
import { UpdateDialog } from "../modals/UpdateDialog.tsx";

export function UpdateBadge({ compact = false }: { compact?: boolean }) {
	const { info, phase } = useUpdate();
	const [open, setOpen] = useState(false);

	// Every rule about what shows and what it says lives in `update/view.ts`, where the tests can
	// walk all six phases through all of them at once.
	if (!info || !shouldShow(info)) return null;

	const fraction = fractionOf(phase);
	/*
	 * Sized against its neighbours, not against the row.
	 *
	 * It was the row's full height once — a 34px disc of saturated blue beside a 16px settings
	 * glyph and a 16px outlined `?`, which made the loudest thing in the sidebar a notice about a
	 * version number. Shrinking it to 22 helped and did not settle it, because the weight was never
	 * only the diameter: a filled circle in an accent colour outweighs a hairline outline at any
	 * size, and next to two 16px line glyphs it still read as something that had drifted in from
	 * another application.
	 *
	 * So it is 20px now, and the fill went with it — see `.ly-update-dot`, which is a wash of the
	 * accent behind a glyph drawn in it, the same treatment the `Badge` in settings uses. That is
	 * the register this belongs in: coloured, so it is visibly an announcement rather than a
	 * control, and quiet, because nothing here is urgent.
	 */
	const size = compact ? 22 : 20;
	const glyph = compact ? 12 : 11;

	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				aria-label={labelFor(phase, info.latest)}
				data-phase={phase.at}
				style={{
					height: size,
					// Padding is what keeps width equal to height while closed: half the difference
					// between the circle and the glyph inside it. Anything else is a pill with air in it.
					paddingInline: (size - glyph) / 2,
				}}
				className="ly-update-dot flex shrink-0 items-center rounded-full text-caption font-medium whitespace-nowrap"
			>
				<span className="relative flex shrink-0 items-center justify-center">
					{/*
					 * The ring goes around the *glyph*, not around the button.
					 *
					 * Around the button it only works while the button is a circle, and the button stops
					 * being a circle the moment it is hovered — which is also the moment someone is most
					 * likely to be looking at it. Anchored to the glyph it is correct in both shapes, and
					 * being absolutely positioned it changes no measurement, so nothing moves when a
					 * download starts.
					 */}
					{fraction !== null && (
						<ProgressRing fraction={fraction} spinning={phase.at === "preparing"} inset={(size - 2 - glyph) / 2} />
					)}
					<PhaseGlyph phase={phase} size={glyph} />
				</span>

				{/* Two spans: the outer animates the width, the inner clips what does not fit yet. A grid
				    column from 0fr to 1fr is how you animate to a width nobody measured. */}
				<span className="ly-update-version">
					<span>
						<span className="pl-1.5 tabular-nums">{labelFor(phase, info.latest)}</span>
					</span>
				</span>
			</button>

			{open && <UpdateDialog info={info} phase={phase} onClose={() => setOpen(false)} />}
		</>
	);
}

/** The glyph in the middle: what pressing it is about, not what it will do. */
function PhaseGlyph({ phase, size }: { phase: Phase; size: number }) {
	if (phase.at === "failed") return <AlertTriangle size={size} strokeWidth={2.4} className="shrink-0" />;
	if (phase.at === "ready") return <RefreshCw size={size} strokeWidth={2.6} className="shrink-0" />;
	// Paused shows the state it is in, which is the thing the eye is scanning for — a download that
	// is not moving looks identical to one that is, without it.
	if (phase.at === "paused")
		return <Pause size={size - 1} strokeWidth={2.6} className="shrink-0" fill="currentColor" />;
	return <ArrowDownToLine size={size + 1} strokeWidth={2.4} className="shrink-0" />;
}

/**
 * A ring that closes as the download arrives.
 *
 * The version before this one made the whole badge a conic gradient, on the reasoning that the disc
 * was already a circle so it may as well be the dial. That is true of a disc and false of this
 * control: hovering turns it into a pill, and a conic gradient on a pill is a coloured wedge fired
 * out of the middle of the word — it looked like a rendering fault, because in every sense that
 * matters it was one.
 *
 * So: an SVG ring, positioned against the glyph rather than the button, which is round in both
 * shapes. `inset` is how far outside the glyph it sits, computed by the caller so the ring lands
 * just inside the closed circle's edge.
 *
 * Rotated so zero is at the top, which is where a clock starts and therefore where everyone looks
 * for the beginning of a circle.
 */
function ProgressRing({ fraction, spinning, inset }: { fraction: number; spinning: boolean; inset: number }) {
	const radius = 10;
	const circumference = 2 * Math.PI * radius;

	return (
		<svg
			aria-hidden
			// Named, because the glyph in the middle is an SVG too — `.ly-update-dot svg` matches the
			// warning triangle of a *failed* download just as happily, which is how a check for "the
			// ring is drawn" came to pass in the one phase that has no ring.
			data-ring
			viewBox="0 0 24 24"
			style={{ inset: -inset }}
			className={`absolute -rotate-90 ${spinning ? "ly-spin" : ""}`}
		>
			{/* The track, so an arc at 8% is visibly one eighth of something rather than a lone tick. */}
			<circle cx="12" cy="12" r={radius} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.32" />
			<circle
				cx="12"
				cy="12"
				r={radius}
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeDasharray={circumference}
				/*
				 * A visible minimum, because the first seconds of a 135MB download round to 0% and an arc
				 * of literally nothing is indistinguishable from a download that never started — the one
				 * thing the ring exists to rule out. `spinning` has no percentage to show at all, so it
				 * is a quarter-turn chasing its own tail.
				 */
				strokeDashoffset={circumference * (1 - Math.max(spinning ? 0.25 : 0.07, fraction))}
				className="transition-[stroke-dashoffset] duration-300 ease-out"
			/>
		</svg>
	);
}
