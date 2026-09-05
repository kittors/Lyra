/**
 * That work has been delegated, said above the composer.
 *
 * Delegation was invisible: the parent dispatched a sub-agent, the transcript said 「派发子任务 2 个」
 * in the same grey as everything else, and for the next two minutes nothing on screen distinguished
 * "reading forty files on your behalf" from "stuck". The point of a sub-agent is that its context
 * stays out of the parent's — which is also what makes it opaque, so it needs somewhere of its own
 * to be seen.
 *
 * Above the composer because that is where the answer to "what is happening right now" belongs, and
 * because it is the one place in the window that is on screen in every layout. It appears only when
 * there is something to say and takes a single line when it does.
 */

import { Bot, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useApp } from "../../store/index.ts";
import { figuresOf, rosterOrder, rosterTotal, useSubAgents } from "../../store/subAgents.ts";
import { elapsedSince, figuresWord, statusWord } from "./format.ts";
import { bridge } from "../../services/index.ts";

export function SubAgentBar({ onOpen }: { onOpen: () => void }) {
	const agents = useSubAgents((s) => s.agents);
	const running = agents.filter((one) => one.status === "running").length;
	/*
	 * The bar opens the pane when work is delegated, not only when clicked.
	 *
	 * Written with the pane and never called from anywhere: the hook below was exported for a
	 * caller that did not exist, so for a month the first dispatch of a run surfaced nothing but
	 * this line. Hooked here because this is the component that is always mounted while a
	 * conversation is, and the one whose whole job is announcing delegated work.
	 */
	useAnnounceSubAgents(onOpen);
	/*
	 * A clock, so 「已运行 2m 14s」 is true rather than true-when-last-rendered.
	 *
	 * Only while something is running: a roster of finished sub-agents says nothing that changes
	 * on its own, and a timer left going is a re-render a second for a line nobody is reading.
	 */
	const [, setNow] = useState(0);
	useEffect(() => {
		if (running === 0) return;
		const timer = window.setInterval(() => setNow((n) => n + 1), 1000);
		return () => window.clearInterval(timer);
	}, [running]);

	if (agents.length === 0) return null;

	const ordered = rosterOrder(agents);
	/*
	 * The whole roster on the tip, which is the question this line raises.
	 *
	 * 「3 个子任务」 immediately asks "which three, and are they moving?" — and the answer is short
	 * enough to give in full. Running ones first, each with what it was asked to do and how long it
	 * has been at it; the rest with how they ended.
	 */
	const total = figuresWord(rosterTotal(agents));
	const tip = [
		...ordered.map((one) => {
			const state = one.status === "running" ? `运行中 · ${elapsedSince(one.startedAt)}` : statusWord(one.status);
			const activity = one.status === "running" && one.lastActivity ? ` · ${one.lastActivity}` : "";
			const spent = figuresWord(figuresOf(one));
			return `${one.description}（${one.agent}）— ${state}${activity}${spent ? ` · ${spent}` : ""}`;
		}),
		// The bill for the whole batch, on the line everyone sees while it runs — the brake.
		...(total ? [`本次编排合计 ${total}`] : []),
	].join("\n");

	return (
		<div className="ly-enter group/bar mb-1.5 flex w-full items-center justify-between rounded-lg bg-card/60 px-2 py-0.5 border border-line-soft transition-colors hover:bg-card">
			<button
				type="button"
				onClick={onOpen}
				data-ly-tip={tip}
				data-ly-subagent-bar
				aria-label={`子 Agent ${agents.length} 个，${running} 个运行中`}
				className="flex min-w-0 flex-1 items-center gap-2 py-1 text-detail text-ink-muted transition-colors duration-[var(--ly-t-quick)] hover:text-ink"
			>
				<Bot size={13} strokeWidth={1.8} className={`shrink-0 ${running > 0 ? "text-accent" : "text-ink-faint"}`} />
				{/*
				 * What is happening, not how many rows there are.
				 *
				 * With one running, its own description is more use than a count of one; with several,
				 * the count is the only thing that fits and the tip has the rest.
				 */}
				<span className="min-w-0 flex-1 truncate text-left">{headline(ordered, running)}</span>
				{running > 0 && (
					<span className="shrink-0 text-caption text-ink-faint tabular-nums">
						{elapsedSince(Math.min(...ordered.filter((one) => one.status === "running").map((one) => one.startedAt)))}
					</span>
				)}
				{total && (
					<span data-sub-total className="shrink-0 text-caption text-ink-faint tabular-nums">
						{total}
					</span>
				)}
			</button>
			{/*
			 * Put the record away, once you are done reading it.
			 *
			 * Only the finished ones: clearing a list is not a way to stop work, and a running sub-agent
			 * that vanished from here would still be running with nothing able to reach it. With
			 * something still going the button simply is not offered — the line has not finished being
			 * useful yet.
			 */}
			{running === 0 && (
				<button
					type="button"
					data-ly-tip="清掉这些记录"
					aria-label="清掉已结束的子 Agent 记录"
					onClick={() => {
						const id = useApp.getState().activeSessionId;
						if (id) void bridge.subAgents.dismissFinished(id);
						useSubAgents.getState().clear();
					}}
					className="shrink-0 rounded-md p-1 text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink"
				>
					<X size={12} strokeWidth={2} />
				</button>
			)}
		</div>
	);
}

function headline(ordered: ReturnType<typeof rosterOrder>, running: number): string {
	if (running === 0) return `${ordered.length} 个子 Agent 已结束`;
	if (running === 1) {
		const one = ordered.find((each) => each.status === "running");
		return one ? `${one.description}` : "子 Agent 运行中";
	}
	return `${running} 个子 Agent 运行中`;
}

/**
 * Open the pane when work is delegated, once per batch.
 *
 * Not on every roster change — that fires on every tool call of every sub-agent, and a pane that
 * re-opened itself after being closed would be unusable. The first dispatch of a run is worth
 * surfacing; after that the bar is enough.
 */
function useAnnounceSubAgents(open: () => void): void {
	const agents = useSubAgents((s) => s.agents);
	const seen = useRef(0);
	const session = useApp((s) => s.activeSessionId);

	useEffect(() => {
		seen.current = 0;
	}, [session]);

	useEffect(() => {
		const running = agents.filter((one) => one.status === "running").length;
		if (running > seen.current) open();
		seen.current = running;
	}, [agents, open]);
}
