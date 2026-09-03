import { ExternalLink, Maximize2, Minimize2, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { IconButton } from "../ui/primitives/IconButton.tsx";
import { useDock } from "../dock/store.ts";
import { useSide } from "../sideStore.ts";

export interface PreviewInfo {
	id: string;
	sessionId: string;
	title: string;
	entry: string;
}

/**
 * The card sizes itself to its page, between these.
 *
 * The floor keeps a page that reports nothing useful from collapsing to a sliver; the ceiling
 * keeps one preview from taking the whole transcript, which is what a full-screen layout would
 * do if asked politely.
 */
const MIN_HEIGHT = 160;
/** Below this, the page has not really told us anything — see where this is used. */
const MEANINGFUL_HEIGHT = 90;
const MAX_HEIGHT = 720;
/** Used while measuring, and if the page never reports anything. */
const DEFAULT_HEIGHT = 440;
/** A page whose height depends on its own height would otherwise resize forever. */
const MAX_ADJUSTMENTS = 8;
/** If the reporter never runs — blocked, broken, or a page with no head — stop waiting. */
const PROBE_TIMEOUT_MS = 1500;
/** How long to keep collecting measurements before committing to one. */
const PROBE_SETTLE_MS = 400;

function previewUrl(preview: PreviewInfo): string {
	return `ly-preview://${preview.sessionId}/${preview.id}/${preview.entry}`;
}

/**
 * A page the agent made, running inside the conversation.
 *
 * The point is that a demo is not a description of a demo: a snake game you can play settles
 * in one second what a fenced code block takes a paragraph to explain, and a layout put up for
 * approval is answered by looking at it. So it renders here, in place, already interactive.
 *
 * It is a piece of the conversation, not an application window sitting in one. There was a title
 * bar here — a name and three buttons across the top, on a card with its own border — and it
 * announced itself twice: the page nearly always opens with its own heading, and the bar repeated
 * it above a strip of chrome that did nothing until you wanted it. Now the page is simply there,
 * and the controls surface on hover the way a message's own actions do.
 *
 * Inside a sandboxed frame with `allow-scripts` and nothing else — no same-origin, so it cannot
 * reach this window; no top-navigation, so it cannot replace the app with something else. It is
 * served from its own `ly-preview://` origin rather than `file://`, which is what keeps it from
 * walking the disk. The agent wrote this code; it is not trusted with anything but its own
 * canvas.
 */
const clamp = (value: number) => Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, value)));

/*
 * A preview is measured once and remembered.
 *
 * Without this, every visit to a conversation re-runs the measurement, and a card that settles at
 * 540 opens at 440 and jumps — which is exactly the kind of movement a transcript should never
 * have. Kept locally rather than in the session record because it describes this window: the same
 * conversation opened at another size would measure differently and should.
 */
const HEIGHT_KEY = "ly-preview-height:";

function recallHeight(preview: PreviewInfo): number | null {
	try {
		const raw = localStorage.getItem(`${HEIGHT_KEY}${preview.sessionId}/${preview.id}`);
		const value = raw === null ? Number.NaN : Number(raw);
		return Number.isFinite(value) ? clamp(value) : null;
	} catch {
		return null;
	}
}

function rememberHeight(preview: PreviewInfo, height: number): void {
	try {
		localStorage.setItem(`${HEIGHT_KEY}${preview.sessionId}/${preview.id}`, String(height));
	} catch {
		// A full or disabled store costs a re-measure, nothing more.
	}
}

export function PreviewCard({ preview }: { preview: PreviewInfo }) {
	const [nonce, setNonce] = useState(0);
	const [tall, setTall] = useState(false);
	const [ready, setReady] = useState(false);
	/** The page wants more room than a card in a transcript is allowed to take. */
	const [overflowing, setOverflowing] = useState(false);
	const frame = useRef<HTMLIFrameElement>(null);
	// Straight from the last time this preview was measured, so the first frame is already right.
	const [measured, setMeasured] = useState<number | null>(() => recallHeight(preview));
	/*
	 * Measurement state outlives a render, and has to.
	 *
	 * It used to live in the effect, which meant any re-render of the transcript restarted it —
	 * and since the frame is reused across those renders, the page had already loaded and would
	 * never report again. The measurement then timed out and every preview came back the same
	 * default height.
	 */
	const survey = useRef({ settled: false, tallest: 0, adjustments: 0, timer: null as ReturnType<typeof setTimeout> | null });
	const openPane = useDock((s) => s.open);
	const openPreview = useSide((s) => s.openPreview);

	/*
	 * Grow to the page, within reason.
	 *
	 * The height comes from the page itself (see `withHeightReporter` in the main process), which
	 * means it can move in response to being resized — a layout written against the viewport
	 * reports whatever it was just given, and taking that at face value would walk the card down
	 * the screen one message at a time. Three things stop that: the value is clamped, tiny
	 * differences are ignored, and there is a hard cap on how many times one preview may resize.
	 * A page whose height genuinely depends on its height settles at the cap rather than running.
	 */
	useEffect(() => {
		const state = survey.current;
		function commit(height: number) {
			state.settled = true;
			setMeasured(height);
			rememberHeight(preview, height);
		}
		function note(asked: number) {
			if (asked > MAX_HEIGHT + 8) setOverflowing(true);
		}
		function onMessage(event: MessageEvent) {
			// Identified by the window it came from — a sandboxed frame has no origin to check.
			if (event.source !== frame.current?.contentWindow) return;
			const asked = (event.data as { __dwPreviewHeight?: unknown })?.__dwPreviewHeight;
			if (typeof asked !== "number" || !Number.isFinite(asked)) return;

			if (!state.settled) {
				/*
				 * Keep listening for a moment before deciding.
				 *
				 * The first number out of a page is almost never its final size — it arrives while
				 * stylesheets are still landing, web fonts have not swapped and entrance animations
				 * are mid-flight, and it describes a document that has not finished becoming
				 * itself. Every report in this window describes the same content, so the largest of
				 * them is the one that saw all of it.
				 */
				state.tallest = Math.max(state.tallest, asked);
				note(asked);
				state.timer ??= setTimeout(() => {
					/*
					 * Too small to be a measurement of anything.
					 *
					 * A page built entirely out of percentages has no height of its own to report,
					 * and what comes back is the sum of a few collapsed boxes. Better to give it
					 * the default and let it fill that than to squeeze it into its own collapse.
					 */
					commit(state.tallest < MEANINGFUL_HEIGHT ? DEFAULT_HEIGHT : clamp(state.tallest));
				}, PROBE_SETTLE_MS);
				return;
			}
			/*
			 * After that, the page may only ask for more.
			 *
			 * It is now being measured at its own height, so "I need exactly what I was given" is
			 * the answer every elastic layout returns, and honouring it would just be the card
			 * agreeing with itself. Growth is different: content that overflows the settled height
			 * is content that would otherwise be cut off — a detail panel opening, a list loading.
			 */
			note(asked);
			setMeasured((current) => {
				const next = clamp(asked);
				if (current === null || next <= current + 8 || state.adjustments >= MAX_ADJUSTMENTS) return current;
				state.adjustments++;
				rememberHeight(preview, next);
				return next;
			});
		}
		window.addEventListener("message", onMessage);
		// Nothing arrived, so nothing is coming; settle on something sensible rather than waiting.
		const giveUp = setTimeout(() => {
			if (!state.settled) commit(DEFAULT_HEIGHT);
		}, PROBE_TIMEOUT_MS);
		return () => {
			window.removeEventListener("message", onMessage);
			clearTimeout(giveUp);
		};
	}, [preview]);

	// Asking for more space is a decision the page does not get to overrule.
	const height = tall ? MAX_HEIGHT : (measured ?? DEFAULT_HEIGHT);
	// Held back until it has been measured, so the probe height is never a frame anyone sees.
	const visible = ready && measured !== null;

	return (
		<div
			style={{ height }}
			/*
			 * No animation while measuring.
			 *
			 * The probe works by observing the page at a deliberately small height, and an animated
			 * height is not at that height yet — it is somewhere on the way there. The page loaded
			 * mid-transition and reported the height it happened to see, which was the old one.
			 */
			className={`ly-enter relative my-2.5 overflow-hidden rounded-[12px] border border-line-soft ${
				measured === null ? "" : "transition-[height] duration-[var(--ly-t-slow)]"
			}`}
		>
			{/*
			 * The frame fades in over the card's own colour rather than appearing on white.
			 *
			 * Every preview starts as a blank document, and a blank document is white — which on a
			 * dark theme is a flash bright enough to be the most noticeable thing about the whole
			 * feature. Holding it back until the page has painted costs nothing and removes it.
			 */}
			<div className="h-full w-full bg-card">
				<iframe
					ref={frame}
					key={nonce}
					/*
					 * `#ly-inline` tells the page it is in the transcript rather than the panel, and
					 * a fragment does it without touching the request — same URL, same file, one
					 * fetch. The injected stylesheet keys off it to stop the page scrolling here.
					 */
					src={`${previewUrl(preview)}#ly-inline`}
					title={preview.title}
					sandbox="allow-scripts allow-pointer-lock allow-forms allow-modals"
					onLoad={() => setReady(true)}
					className={`block h-full w-full transition-opacity duration-[var(--ly-t-base)] ${visible ? "opacity-100" : "opacity-0"}`}
				/>
			</div>

			{/*
			 * Floating over the page, faint until you go for them.
			 *
			 * Elsewhere in the app controls like these stay hidden until the pointer is on what they
			 * act on. Not here: the page fills the card, so nearly every position the pointer can
			 * take is inside a cross-process frame, and whether that hover reaches this document is
			 * not something that could be established either way. Rather than stake the only way to
			 * rerun or reopen a preview on it, they stay — quiet enough to read as part of the page,
			 * and solid the moment the pointer arrives, which is a hover this document does own.
			 */}
			{/*
			 * Say so when there is more below.
			 *
			 * The page does not scroll inside the card — that is what stops it swallowing the wheel
			 * and jittering against its own edge — so a page taller than the ceiling is simply cut
			 * off, and silently cutting content off is worse than the scrollbar ever was. The panel
			 * is where a page this size belongs anyway.
			 */}
			{overflowing && !tall && (
				<button
					type="button"
					onClick={() => {
						openPreview(preview);
						openPane("browser");
					}}
					className="absolute inset-x-0 bottom-0 flex h-14 items-end justify-center bg-gradient-to-t from-card via-card/80 to-transparent pb-2"
				>
					{/* Solid, not frosted: this card scrolls inside the transcript, and a masked scroller
					    is a backdrop root — the blur would never arrive. See `.ly-glass-solid`. */}
					<span className="ly-glass-solid rounded-full px-2.5 py-1 text-detail text-ink-muted transition-colors hover:text-ink">
						内容更长 · 在侧栏中查看
					</span>
				</button>
			)}

			{/* Solid for the same reason as above — and this one sits over an arbitrary rendered page,
			    where a translucent strip with nothing blurred behind it is the least readable of all. */}
			<div className="ly-glass-solid absolute top-2 right-2 flex items-center gap-0.5 rounded-lg p-0.5 opacity-45 transition-opacity duration-[var(--ly-t-quick)] hover:opacity-100 has-[:focus-visible]:opacity-100">
				{/*
				 * Taller, because the frame cannot ask for a size.
				 *
				 * A page laid out against the viewport — which is most games and most dashboards —
				 * reports exactly the height it was given, so there is nothing to measure and grow
				 * to. The default suits a diagram or a form; anything built to fill a screen gets
				 * cropped at the bottom, and this is the one click that fixes it.
				 */}
				<IconButton
					icon={tall ? <Minimize2 size={12} strokeWidth={1.9} /> : <Maximize2 size={12} strokeWidth={1.9} />}
					label={tall ? "自适应高度" : "放到最大"}
					size="sm"
					tipSide="top"
					onClick={() => setTall((value) => !value)}
				/>
				<IconButton
					icon={<RotateCw size={12} strokeWidth={1.9} />}
					label="重新运行"
					size="sm"
					tipSide="top"
					onClick={() => {
						// A fresh run may draw something a different size, so measure it again.
						survey.current = { settled: false, tallest: 0, adjustments: 0, timer: null };
						setOverflowing(false);
						setReady(false);
						setMeasured(null);
						setNonce((value) => value + 1);
					}}
				/>
				<IconButton
					icon={<ExternalLink size={12} strokeWidth={1.9} />}
					label="在侧栏中打开"
					size="sm"
					tipSide="top"
					onClick={() => {
						openPreview(preview);
						openPane("browser");
					}}
				/>
			</div>
		</div>
	);
}
