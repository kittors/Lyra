import type { TodoItem } from "@lyra/core";
import { ChevronDown, ListTodo, Pause, Play, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Scroller } from "../ui/scroll/Scroller.tsx";
import { ScrollText } from "../ui/scroll/ScrollText.tsx";
import { Text } from "../ui/primitives/Text.tsx";
import { useApp } from "../store.ts";
import { Mark, lastTurnFailed } from "./task/Mark.tsx";

/**
 * The agent's plan for the work in hand.
 *
 * A long turn is a wall of tool cards, and the one question it never answers is "how much of
 * this is left". The agent already keeps a list — `todo_write` is how it thinks about work with
 * more than a couple of steps — and until now that list was only visible as one tool card among
 * dozens, immediately buried by the next one.
 *
 * Collapsed it is a single line naming what is happening right now, which is the answer most of
 * the time. Opened it is the whole plan, capped and scrolling, because a plan with forty steps
 * must not push the conversation off the screen.
 */
export function TaskList({ placement }: { placement: "floating" | "inline" }) {
	const todos = useApp((s) => s.todos);
	/*
	 * Nothing is working on the current step.
	 *
	 * The list records what the agent was doing, not whether anyone is still doing it. Whether a
	 * step is moving is a fact about the turn, not about the plan: no turn, no motion. This was
	 * originally tied to a detected interruption, which was too narrow — a model that simply
	 * stopped without finishing leaves a perfectly intact log and a step that spins forever.
	 */
	const running = useApp((s) => s.running);
	const paused = !running;
	const abort = useApp((s) => s.abort);
	const send = useApp((s) => s.send);
	const messages = useApp((s) => s.messages);
	/*
	 * The last turn ended badly, so the step it was on did not merely stop — it failed.
	 *
	 * Distinguished because the offer is different: a paused step is carried on with, a failed
	 * one is tried again. The plan itself has no failed state — `todo_write` only knows pending,
	 * in progress and completed — so it comes from how the turn ended.
	 */
	const failed = !running && lastTurnFailed(messages);

	/** What the control on the current step does, which is also what its mark shows. */
	const action = running
		? { icon: Pause, label: "暂停", run: () => void abort() }
		: failed
			? { icon: RotateCw, label: "重试这一步", run: () => void send([{ type: "text", text: "重试刚才失败的那一步。" }]) }
			: { icon: Play, label: "继续", run: () => void send([{ type: "text", text: "继续，从暂停的地方接着做。" }]) };

	const [open, setOpen] = useState(false);
	const body = useRef<HTMLDivElement>(null);
	const [height, setHeight] = useState(0);

	const active = todos.find((todo) => todo.status === "in_progress");
	const done = todos.filter((todo) => todo.status === "completed").length;
	const pending = todos.length - done - (active ? 1 : 0);

	/*
	 * Measured, then animated to that measurement.
	 *
	 * `height: auto` cannot be transitioned, and the usual workaround — animating to a max-height
	 * guess — either clips a long list or spends most of the animation covering empty space, so
	 * the movement finishes early and stops dead. Measuring the content each time the list or the
	 * open state changes keeps the motion honest at any length.
	 */
	useEffect(() => {
		const element = body.current;
		if (!element) return;
		const measure = () => setHeight(element.scrollHeight);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [todos, open]);

	if (todos.length === 0) return null;
	/*
	 * A finished plan puts itself away.
	 *
	 * The list answers "how much is left"; once the answer is "none" it is a card holding a row
	 * of ticks in the corner of a conversation that has moved on. What it recorded is still in
	 * the transcript, on the tool call that wrote it.
	 */
	if (done === todos.length) return null;

	return (
		<div
			className={
				placement === "floating"
					? "ly-glass pointer-events-auto w-full overflow-hidden rounded-[11px] border border-line-soft shadow-lg shadow-black/[0.06]"
					: "ly-enter overflow-hidden rounded-[11px] border border-line-soft bg-card/40"
			}
		>
			<button
				type="button"
				onClick={() => setOpen((value) => !value)}
				aria-expanded={open}
				className="ly-scroll flex h-9 w-full items-center gap-2 px-3 text-left transition-colors hover:bg-card-hover"
			>
				<ListTodo size={13} strokeWidth={1.8} className="shrink-0 text-ink-faint" />
				{/*
				 * What is happening now, not what the list is called.
				 *
				 * Collapsed, this row is the whole feature for most of a turn — a title saying
				 * "任务" would spend that time telling you something you can see.
				 */}
				<ScrollText
					text={
						active
							? paused
								? `已暂停 · ${active.content}`
								: (active.activeForm ?? active.content)
							: todos.length === done
								? "全部完成"
								: "待开始"
					}
					className="ly-fade-tail min-w-0 flex-1 text-label"
				/>
				<Text size="caption" tone="faint" numeric className="shrink-0">
					{done}/{todos.length}
				</Text>
				{/*
				 * Reachable without opening the list.
				 *
				 * Pausing is something you want at the moment you decide it, and going through a
				 * disclosure first is one gesture too many for "stop". Nested inside the toggle's
				 * button, so the click is taken here and does not also expand the list.
				 */}
				{active && (
					// oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a <button> cannot be
					// nested inside the disclosure <button> this sits in; HTML forbids it.
					<span
						role="button"
						tabIndex={0}
						data-ly-tip={action.label}
						data-ly-tip-side="bottom"
						aria-label={action.label}
						onClick={(event) => {
							event.stopPropagation();
							action.run();
						}}
						onKeyDown={(event) => {
							if (event.key !== "Enter" && event.key !== " ") return;
							event.preventDefault();
							event.stopPropagation();
							action.run();
						}}
						className="flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded text-ink-faint transition-colors hover:bg-elevated hover:text-ink"
					>
						<action.icon size={11.5} strokeWidth={2} />
					</span>
				)}
				<ChevronDown
					size={12.5}
					strokeWidth={1.9}
					className={`shrink-0 text-ink-faint transition-transform duration-[var(--ly-t-base)] ${open ? "rotate-180" : ""}`}
				/>
			</button>

			{/*
			 * The list, always mounted so its height is always known.
			 *
			 * Mounting it on open would mean measuring at the moment it becomes visible, which is
			 * one frame too late — the box would jump to its full size and then animate from there.
			 */}
			{/* `ly-freeze` for the same reason as `ToolGroup`: the height follows what fits. */}
			<div
				style={{ height: open ? height : 0 }}
				className="ly-freeze overflow-hidden transition-[height] duration-[var(--ly-t-base)] ease-out"
			>
				<div ref={body} className="border-t border-line-soft">
					<Scroller className="max-h-[min(280px,38vh)]" contentClassName="px-1.5 py-1.5">
						{todos.map((todo, index) => (
							<Row
								key={`${index}-${todo.content}`}
								todo={todo}
								paused={paused}
								failed={failed}
								action={todo.status === "in_progress" ? action : undefined}
							/>
						))}
					</Scroller>
				</div>
			</div>

			{!open && pending > 0 && <span className="sr-only">{pending} 项待处理</span>}
		</div>
	);
}

function Row({
	todo,
	paused,
	failed,
	action,
}: {
	todo: TodoItem;
	paused?: boolean;
	failed?: boolean;
	/** Present on the current step: the mark becomes the button that acts on it. */
	action?: { icon: typeof Pause; label: string; run: () => void };
}) {
	return (
		<div className="ly-scroll group/step flex items-center gap-2 rounded-md px-1.5 py-[5px]">
			{action ? (
				<button
					type="button"
					onClick={action.run}
					data-ly-tip={action.label}
					data-ly-tip-side="right"
					aria-label={action.label}
					className="flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-sm text-ink-faint transition-colors hover:text-ink"
				>
					{/* The state at rest, the offer on hover — one place, one click. */}
					<span className="group-hover/step:hidden">
						<Mark status={todo.status} paused={paused} failed={failed} />
					</span>
					<action.icon size={11} strokeWidth={2} className="hidden group-hover/step:block" />
				</button>
			) : (
				<Mark status={todo.status} paused={paused} failed={failed} />
			)}
			<ScrollText
				text={todo.content}
				className={`ly-fade-tail min-w-0 flex-1 text-detail ${
					todo.status === "completed"
						? "text-ink-faint line-through decoration-line"
						: todo.status === "in_progress"
							? "text-ink"
							: "text-ink-muted"
				}`}
			/>
		</div>
	);
}
