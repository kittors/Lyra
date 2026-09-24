import { useI18n } from "../../i18n/index.ts";
import type { TodoItem } from "@lyra/core";
import { ChevronDown, ListTodo, Pause, Play, RotateCw } from "lucide-react";
import { useState } from "react";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import { Text } from "../../ui/primitives/Text.tsx";
import { useApp } from "../../store/index.ts";
import { useScopedMessages, useScopedRunning, useScopedSessionId, useScopedStopped, useScopedTodos } from "../../app/session-scope.tsx";
import { carryOnPrompt } from "../../store/derive.ts";
import { Mark, lastTurnFailed } from "./Mark.tsx";
import { isUserPaused, taskListHeadline } from "./task-list-state.ts";
import { useDelayedOffer } from "./hover-offer.ts";

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
	const { t } = useI18n();
	const todos = useScopedTodos();
	/*
	 * Nothing is working on the current step.
	 *
	 * The list records what the agent was doing, not whether anyone is still doing it. Whether a
	 * step is moving is a fact about the turn, not about the plan: no turn, no motion. This was
	 * originally tied to a detected interruption, which was too narrow — a model that simply
	 * stopped without finishing leaves a perfectly intact log and a step that spins forever.
	 */
	const running = useScopedRunning();
	const stopped = useScopedStopped();
	const paused = isUserPaused(running, stopped);
	const sessionId = useScopedSessionId();
	const abort = useApp((s) => s.abort);
	const send = useApp((s) => s.send);
	const messages = useScopedMessages();
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
		? { icon: Pause, label: t("taskList.pause"), run: () => void abort(sessionId ?? undefined) }
		: failed
			? {
						icon: RotateCw,
						label: t("taskList.retryStep"),
						run: () => void send([{ type: "text", text: t("taskList.retryStepDetail") }], { synthetic: true, sessionId: sessionId ?? undefined }),
					}
			: {
						icon: Play,
						label: t("taskList.resume"),
						run: () => void send([{ type: "text", text: carryOnPrompt(null, todos.filter((todo) => todo.status !== "completed").length) ?? t("taskList.resumeDetail") }], { synthetic: true, carryOn: true, sessionId: sessionId ?? undefined }),
					};

	const [open, setOpen] = useState(false);

	const active = todos.find((todo) => todo.status === "in_progress");
	const done = todos.filter((todo) => todo.status === "completed").length;
	const pending = todos.length - done - (active ? 1 : 0);

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
			// 认它不靠样式：这张卡片什么时候在、什么时候该消失，是 `e2e/revert-empties-session-probe.ts` 要量的东西。
			data-ly-task-list={placement}
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
						{
							paused: t("taskList.pausedAt", { step: active?.content ?? "" }),
							step: active?.activeForm ?? active?.content ?? "",
							// 名字，不是进行时：这一步停在这里，没有谁正在做它。
							stalled: t("taskList.stalledAt", { step: active?.content ?? "" }),
							allDone: t("taskList.allDone"),
							notStarted: t("taskList.notStarted"),
						}[taskListHeadline({ running, stopped, active, done, total: todos.length })]
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
			 * CSS grid transition via ly-reveal avoids ResizeObserver layout thrashing and reflows.
			 */}
			<div
				className="ly-reveal"
				data-open={open}
				aria-hidden={!open}
			>
				<div className="border-t border-line-soft">
					<Scroller className="max-h-[min(280px,38vh)]" contentClassName="px-1.5 py-1.5" overscroll={placement === "inline" ? "auto" : "contain"}>
						{todos.map((todo, index) => (
							<Row
								key={`${index}-${todo.content}`}
								todo={todo}
								paused={paused}
								failed={failed}
								idle={!running && !paused && !failed}
								action={todo.status === "in_progress" ? action : undefined}
							/>
						))}
					</Scroller>
				</div>
			</div>

			{!open && pending > 0 && <span className="sr-only">{t("taskList.pending", { n: pending })}</span>}
		</div>
	);
}

function Row({
	todo,
	paused,
	failed,
	idle,
	action,
}: {
	todo: TodoItem;
	paused?: boolean;
	failed?: boolean;
	idle?: boolean;
	/** Present on the current step: the mark becomes the button that acts on it. */
	action?: { icon: typeof Pause; label: string; run: () => void };
}) {
	const offer = useDelayedOffer(Boolean(action));
	return (
		<div
			className="ly-scroll group/step flex items-center gap-2 rounded-md px-1.5 py-[5px]"
			onMouseEnter={offer.enter}
			onMouseLeave={offer.leave}
		>
			{action ? (
				<button
					type="button"
					onClick={action.run}
					data-ly-tip={offer.show ? action.label : undefined}
					data-ly-tip-side="right"
					aria-label={action.label}
					data-ly-step-offer={offer.show ? "on" : "off"}
					className="flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-sm text-ink-faint transition-colors hover:text-ink"
				>
					{/* The state at rest; the offer only after a settled hover. */}
					{offer.show ? <action.icon size={11} strokeWidth={2} /> : <Mark status={todo.status} paused={paused} failed={failed} idle={idle} />}
				</button>
			) : (
				<Mark status={todo.status} paused={paused} failed={failed} idle={idle} />
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
