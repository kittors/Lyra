import { translate } from "../../i18n/translate.ts";
import { useLayoutEffect, useRef, useState } from "react";
import { questionWindow, type questionsIn } from "./question-navigation.ts";
import { markdownExcerpt } from "../../lib/markdown/excerpt.ts";

export function QuestionNav({ questions, viewport, edge, onSelect }: {
	questions: ReturnType<typeof questionsIn>;
	viewport: React.RefObject<HTMLDivElement | null>;
	/** Sit against the very edge, for a column too narrow to indent it — see `NARROW_COLUMN`. */
	edge?: boolean;
	onSelect: (index: number) => void;
}) {
	const [active, setActive] = useState<number | null>(null);
	const [hovered, setHovered] = useState<number | null>(null);
	const [dismissed, setDismissed] = useState(false);
	const [clickedWidths, setClickedWidths] = useState<ReadonlyMap<number, number> | null>(null);
	const focusTarget = useRef<number | null>(null);
	const [center, setCenter] = useState(questions.length - 1);
	const [preview, setPreview] = useState<{ text: string; answer: string; slot: number } | null>(null);
	const nav = useRef<HTMLElement>(null);
	const rail = useRef<HTMLDivElement>(null);
	const engaged = useRef(false);
	const position = Math.max(0, questions.findIndex((q) => q.index === active));
	useLayoutEffect(() => { if (!engaged.current) setCenter(position); }, [position]);
	useLayoutEffect(() => {
		const el = viewport.current;
		if (!el) return;
		let frame = 0;
		const measure = () => {
			frame = 0;
			const top = el.getBoundingClientRect().top + 60;
			const rows = el.querySelectorAll<HTMLElement>("[data-question-index]");
			let current: number | null = null;
			for (const row of rows) {
				if (row.getBoundingClientRect().top > top && current !== null) break;
				current = Number(row.dataset.questionIndex);
			}
			setActive(current);
		};
		const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
		measure();
		el.addEventListener("scroll", schedule, { passive: true });
		const observer = new MutationObserver(schedule);
		observer.observe(el, { childList: true, subtree: true });
		const resize = new ResizeObserver(schedule);
		if (el.firstElementChild) resize.observe(el.firstElementChild);
		return () => {
			el.removeEventListener("scroll", schedule);
			observer.disconnect(); resize.disconnect(); cancelAnimationFrame(frame);
		};
	}, [viewport, questions.length]);
	useLayoutEffect(() => {
		const element = rail.current;
		if (!element) return;
		let delta = 0;
		const wheel = (event: WheelEvent) => {
			event.preventDefault();
			delta += event.deltaY;
			if (Math.abs(delta) < 24) return;
			engaged.current = true;
			setHovered(null);
			setClickedWidths(null);
			const steps = Math.sign(delta) * 3;
			delta = 0;
			setCenter((value) => Math.max(0, Math.min(questions.length - 1, value + steps)));
		};
		element.addEventListener("wheel", wheel, { passive: false });
		return () => element.removeEventListener("wheel", wheel);
	}, [questions.length]);
	const window = questionWindow(questions.length, center);
	useLayoutEffect(() => {
		if (focusTarget.current === null) return;
		nav.current?.querySelector<HTMLButtonElement>(`[data-position="${focusTarget.current}"]`)?.focus({ preventScroll: true });
		focusTarget.current = null;
	});
	const show = (position: number) => {
		engaged.current = true;
		setDismissed(false);
		setClickedWidths(null);
		setHovered(position);
		setPreview({ ...questions[position], slot: position - window.start });
	};
	const select = (position: number, focus = false) => {
		const next = Math.max(0, Math.min(questions.length - 1, position));
		engaged.current = true;
		setDismissed(true);
		// Keep the same targets under a stationary pointer throughout a click.
		if (focus) {
			setClickedWidths(null);
			if (next < window.start || next >= window.end) setCenter(next);
			setHovered(next);
			focusTarget.current = next;
		} else {
			// Stop an in-flight hover expansion at its painted width, without snapping to its end.
			const widths = new Map<number, number>();
			for (const mark of rail.current?.querySelectorAll<HTMLButtonElement>("[data-position]") ?? []) {
				const line = mark.querySelector("span");
				if (line) widths.set(Number(mark.dataset.position), line.getBoundingClientRect().width);
			}
			setClickedWidths(widths);
		}
		onSelect(questions[next].index);
	};
	/*
	 * Against the very edge when the column is narrow.
	 *
	 * The rail is 28px wide and the transcript pads 48px on the left to clear it, against 16px on
	 * the right — a 32px difference nobody notices in a wide column and nobody can miss in a 380px
	 * one, where it is a twelfth of the width and the reading column is visibly shoved to the right
	 * of its own pane. Giving the rail the first 4px instead lets the column sit in symmetric 28px
	 * margins, which is what `Conversation` pads to at that width.
	 */
	return (
		<nav ref={nav} className={`ly-question-nav absolute inset-y-3 z-20 flex w-7 items-center ${edge ? "left-0" : "left-3"}`} aria-label="用户问题导航">
			<div ref={rail} role="toolbar" tabIndex={-1} aria-label={translate("questionNav.pick")} className="ly-question-rail relative w-full"
			onMouseLeave={() => { engaged.current = false; setHovered(null); setClickedWidths(null); setCenter(position); }}
			onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) { engaged.current = false; setHovered(null); setClickedWidths(null); setCenter(position); } }}
				onKeyDown={(event) => {
				const current = hovered ?? center;
				const next = event.key === "Home" ? 0 : event.key === "End" ? questions.length - 1 : event.key === "ArrowUp" ? current - 1 : event.key === "ArrowDown" ? current + 1 : null;
				if (next !== null) { event.preventDefault(); select(next, true); }
			}}>
				{questions.slice(window.start, window.end).map((question, slot) => {
					const at = window.start + slot;
					const distance = hovered === null ? 5 : Math.abs(at - hovered);
					return <button key={question.index} type="button" data-position={at} className="ly-question-mark rounded-sm flex h-3 w-7 items-center pl-1.5"
						aria-label={translate("questionNav.goTo", { n: at + 1, text: question.text })} aria-current={active === question.index ? "location" : undefined}
						onMouseEnter={() => show(at)} onFocus={() => { if (focusTarget.current !== at) show(at); }} onClick={() => select(at)}>
						<span style={{ width: clickedWidths?.get(at) ?? (distance < 4 ? 24 - distance * 5 : hovered === null && active === question.index ? 12 : 6), transition: dismissed ? "none" : undefined }} className={`block h-[2px] rounded-full transition-[width,background-color,opacity] duration-[var(--ly-t-quick)] ${distance === 0 ? "bg-ink" : active === question.index ? "bg-ink-muted" : "bg-ink-faint/40"}`} />
					</button>;
				})}
				{preview && <div className="ly-question-preview pointer-events-none absolute left-9 w-[min(320px,calc(100cqw-60px))] rounded-xl border border-line bg-float p-3 text-label shadow-lg" role="tooltip" inert aria-hidden={hovered === null || dismissed} data-open={hovered !== null && !dismissed} data-dismissed={dismissed} style={{ top: Math.max(-24, Math.min((window.end - window.start) * 12 - 80, preview.slot * 12 - 24)) }}>
					<p className="line-clamp-2 break-words font-medium text-ink">{preview.text}</p>
					{preview.answer && <p className="ly-question-excerpt mt-1 line-clamp-3 break-words leading-relaxed text-ink-muted">{markdownExcerpt(preview.answer)}</p>}
				</div>}
			</div>
		</nav>
	);
}
