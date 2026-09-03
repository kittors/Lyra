/**
 * The terminal pane's tabs, drawn in place of its title.
 *
 * Several shells can be running at once — one on a dev server, one for git, one for whatever you
 * are actually doing — and switching between them should not involve arranging panes. So the pane's
 * header carries the strip, the way a terminal emulator does.
 *
 * Every shell, not the current project's: a terminal you started stays reachable when you move to
 * another project or to none at all. See `store/terminals.ts`.
 *
 * The strip is bounded and scrolls. It shares its row with the pane's grip in the centre and the
 * full-screen and close buttons at the right, and those have to stay reachable however many tabs
 * there are — an unbounded strip pushed the last tab underneath the buttons, where it could be
 * seen and not clicked.
 *
 * `no-drag` throughout: this sits in the header, which is what moves the window, and a strip you
 * cannot click because the window slid out from under you is worse than no strip.
 */

import { Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { useApp } from "../store.ts";
import { useTerminals } from "../store/terminals.ts";
import { bridge } from "../services/index.ts";

export function TerminalTabs() {
	const tabs = useTerminals((s) => s.tabs);
	const active = useTerminals((s) => s.active);
	const strip = useRef<HTMLDivElement>(null);

	/*
	 * Fade whichever end has more tabs beyond it, and only that end.
	 *
	 * A permanent fade on both sides dims the first and last tab of a strip that fits, which reads
	 * as those tabs being disabled. Driven from the scroll position so the softness means what it
	 * says: there is more this way.
	 */
	const markEdges = useCallback(() => {
		const el = strip.current;
		if (!el) return;
		const max = el.scrollWidth - el.clientWidth;
		el.style.setProperty("--ly-fade-left", el.scrollLeft > 1 ? "18px" : "0px");
		el.style.setProperty("--ly-fade-right", el.scrollLeft < max - 1 ? "18px" : "0px");
	}, []);

	useEffect(markEdges, [markEdges, tabs.length]);

	/*
	 * Keep the selected tab in view.
	 *
	 * Selecting one is usually a click on a tab already on screen, but not always: opening a new
	 * one selects a tab that has just been added past the right edge, and closing the current one
	 * moves to a neighbour that may be off the left. Either way the strip should be showing what
	 * the pane is showing.
	 */
	useEffect(() => {
		if (!active) return;
		strip.current?.querySelector(`[data-tab="${CSS.escape(active)}"]`)?.scrollIntoView({
			block: "nearest",
			inline: "nearest",
		});
		markEdges();
	}, [active, markEdges]);

	/*
	 * Where a new shell starts: the current project, or home when there is none.
	 *
	 * Read here, at the moment one is asked for, and nowhere else. The strip used to be keyed by
	 * this — and to return `null` when it was empty, so with no project open there was no strip at
	 * all and no way back to a shell that was still running.
	 */
	const openAnother = async () => {
		const opened = await bridge.terminal.open(useApp.getState().workspace?.path ?? "", 80, 24);
		useTerminals.getState().add({ id: opened.id, title: opened.title });
	};

	const close = (id: string) => {
		bridge.terminal.kill(id);
		useTerminals.getState().remove(id);
	};

	return (
		/*
		 * Half the header, less the grip's reach.
		 *
		 * The grip is centred and absolutely positioned, so it does not push anything aside — a
		 * strip free to grow simply ran under it and then under the buttons past that.
		 */
		<div className="no-drag flex min-w-0 max-w-[calc(50%-2.25rem)] items-center gap-0.5">
			<div
				ref={strip}
				onScroll={markEdges}
				className="ly-fade-tail flex min-w-0 items-center gap-0.5 overflow-x-auto"
			>
				{tabs.map((tab) => {
					const current = tab.id === active;
					return (
						<div
							key={tab.id}
							data-tab={tab.id}
							className={`group/tab flex shrink-0 items-center gap-1 rounded-md pr-0.5 pl-2 transition-colors duration-[var(--ly-t-quick)] ${
								current ? "bg-card-hover text-ink" : "text-ink-faint hover:text-ink"
							}`}
						>
							<button
								type="button"
								onClick={() => useTerminals.getState().select(tab.id)}
								className="py-1 text-detail whitespace-nowrap"
							>
								{tab.title}
							</button>
							{/*
							 * The ✕ is only on the tab you are pointing at, or the one you are on.
							 *
							 * Every tab carrying one turned a strip of three into a row of six targets,
							 * and the close buttons read as loudly as the names — on a strip whose whole
							 * job is to let you pick by name.
							 */}
							<button
								type="button"
								aria-label={`关闭 ${tab.title}`}
								onClick={() => close(tab.id)}
								className={`rounded p-0.5 transition-opacity duration-[var(--ly-t-quick)] hover:bg-elevated ${
									current ? "opacity-60 hover:opacity-100" : "opacity-0 group-hover/tab:opacity-60"
								}`}
							>
								<X size={11} strokeWidth={2.2} />
							</button>
						</div>
					);
				})}
			</div>

			{/* Outside the scroller: "open another" must not be the thing that scrolls out of reach. */}
			<button
				type="button"
				aria-label="新建终端"
				data-ly-tip="新建终端"
				onClick={() => void openAnother()}
				className="shrink-0 rounded-md p-1 text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink"
			>
				<Plus size={13} strokeWidth={2} />
			</button>
		</div>
	);
}
