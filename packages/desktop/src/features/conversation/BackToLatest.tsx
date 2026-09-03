/**
 * The way back down, offered only while there is a way back down.
 *
 * A transcript you have scrolled up in has no other route to the newest message than dragging all
 * the way — and while a turn is streaming, "all the way" keeps moving. So a button, floating just
 * above the composer where the last message would be.
 *
 * It is mounted whether or not it is shown. Mounting it on demand would have it appear at full
 * opacity in its final position, which is the same picture as a layout glitch.
 *
 * Arriving and leaving are not mirror images. It rises a little on the way in, because it has come
 * from the bottom of the transcript and that is where it points. On the way out it stays put and
 * dissolves: it goes because you *arrived* at the bottom, and a button that drops away at the end
 * of a scroll reads as one last lurch downwards — the jump the button exists to save you from,
 * performed as its parting gesture.
 *
 * `pointer-events` follow visibility — an invisible button that still swallows clicks over the
 * transcript is worse than no button.
 */

import { ArrowDown } from "lucide-react";

export function BackToLatest({ show, unread, onClick }: { show: boolean; unread: number; onClick: () => void }) {
	return (
		<div
			className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center"
			style={
				show
					? {
							transform: "translateY(0)",
							opacity: 1,
							transition: "opacity var(--ly-t-base) var(--ly-e-out), transform var(--ly-t-base) var(--ly-e-out)",
						}
					: {
							/*
							 * It drops back to its starting position only *after* it has faded.
							 *
							 * The offset has to be here, or there is nothing to rise from next time. But
							 * moving while still visible is the lurch this is avoiding, so the transform
							 * has no duration and a delay as long as the fade: by the time it happens the
							 * button is already invisible, and it is simply waiting where it began.
							 */
							transform: "translateY(6px)",
							opacity: 0,
							transition: "opacity var(--ly-t-quick) var(--ly-e-out), transform 0s var(--ly-t-quick)",
						}
			}
		>
			<button
				type="button"
				tabIndex={show ? 0 : -1}
				aria-hidden={!show}
				/* Stated on the element so a probe can read the count while the button is hidden —
				   asking the label is no good, because a hidden button says nothing either way. */
				data-unread={unread}
				onClick={onClick}
				className={`ly-composer flex h-8 items-center gap-1.5 rounded-full border border-line-soft bg-float px-3.5 text-detail text-ink-muted transition-colors duration-[var(--ly-t-quick)] hover:text-ink ${
					show ? "pointer-events-auto" : ""
				}`}
			>
				{/*
				 * Says "new" only when something actually arrived while you were up here. Otherwise
				 * this is navigation, not a notification, and a dot on it would be crying wolf.
				 */}
				{unread > 0 && <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-accent" />}
				<ArrowDown size={13} strokeWidth={2} />
				{unread > 0 ? "有新内容" : "回到最新"}
			</button>
		</div>
	);
}
