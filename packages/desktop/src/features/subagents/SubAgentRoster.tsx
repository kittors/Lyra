/**
 * Which sub-agents there are, and what each has cost — the strip above the transcript.
 *
 * Two shapes for one roster. While everything was dispatched by the main conversation the rows
 * are peers, and a tab strip is the right thing: choosing between three parallel searches *is*
 * the title. Once a sub-agent has dispatched sub-agents of its own, peers are the wrong reading —
 * the question becomes "who asked for this, and what did the whole errand cost?" — and the strip
 * becomes an indented list, each root carrying its branch's total.
 *
 * Cost is on every row because it is the brake on orchestration. Fanning out eight sub-agents is
 * free from the parent's side, since none of their context comes back; this is where the bill for
 * it shows, and 「本次编排 $2.40」 is what makes someone ask whether all eight were needed.
 */

import type { ReactNode, RefObject } from "react";
import { useEffect, useRef } from "react";

import type { SubAgentSummary } from "@lyra/core";
import { rosterNested, rosterRows, rosterTotal, type RosterNode } from "../../store/subAgents.ts";
import { figuresWord, ranFor, statusTone, statusWord } from "./format.ts";

export interface SubAgentRosterProps {
	/** In roster order: running first, then by start. */
	agents: SubAgentSummary[];
	current: string | null;
	onFocus: (id: string) => void;
	/** Rendered after each row — the panel puts its close button here. */
	trailing?: (agent: SubAgentSummary) => ReactNode;
}

type Shape = SubAgentRosterProps & { hostRef: RefObject<HTMLDivElement | null> };

export function SubAgentRoster(props: SubAgentRosterProps) {
	const { current } = props;
	const host = useRef<HTMLDivElement>(null);

	// Keep the open one in view: the pane can be focused from the bar, which may scroll it in
	// from either end.
	useEffect(() => {
		if (!current) return;
		for (const row of host.current?.querySelectorAll<HTMLElement>("[data-sub-tab]") ?? []) {
			if (row.dataset.subTab === current) row.scrollIntoView?.({ block: "nearest", inline: "nearest" });
		}
	}, [current]);

	if (rosterNested(props.agents)) return <Tree {...props} hostRef={host} />;
	// One sub-agent needs no chooser; its header says everything the strip would.
	if (props.agents.length < 2) return null;
	return <Strip {...props} hostRef={host} />;
}

const TOTAL_TIP = "本次编排的合计：所有子 Agent 用掉的 token 与估算费用";

function Strip({ agents, current, onFocus, trailing, hostRef }: Shape) {
	const total = figuresWord(rosterTotal(agents));
	return (
		<div className="flex h-7 shrink-0 items-center border-b border-line">
			<div
				ref={hostRef}
				role="tablist"
				aria-label="子 Agent"
				className="ly-fade-tail flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-1"
			>
				{agents.map((one) => {
					const active = one.id === current;
					return (
						<div
							key={one.id}
							data-sub-tab={one.id}
							className={`group/subtab flex h-[22px] shrink-0 items-center gap-1.5 rounded-md pr-0.5 pl-2 transition-colors duration-[var(--ly-t-quick)] ${
								active ? "bg-card-hover text-ink" : "text-ink-faint hover:text-ink"
							}`}
						>
							<button
								type="button"
								role="tab"
								aria-selected={active}
								data-ly-tip={tipFor(one)}
								onClick={() => onFocus(one.id)}
								className="flex min-w-0 items-center gap-1.5 text-detail"
							>
								<Dot agent={one} />
								<span className="max-w-[140px] truncate whitespace-nowrap">{one.description}</span>
							</button>
							{trailing?.(one)}
						</div>
					);
				})}
			</div>
			{total && (
				<span data-sub-total data-ly-tip={TOTAL_TIP} className="shrink-0 px-2 text-caption tabular-nums text-ink-faint">
					合计 {total}
				</span>
			)}
		</div>
	);
}

function Tree({ agents, current, onFocus, trailing, hostRef }: Shape) {
	const rows = rosterRows(agents);
	const total = figuresWord(rosterTotal(agents));
	return (
		<div ref={hostRef} role="tree" aria-label="子 Agent 派生树" className="shrink-0 border-b border-line py-0.5">
			{rows.map((node) => (
				<Branch key={node.agent.id} node={node} active={node.agent.id === current} onFocus={onFocus} trailing={trailing} />
			))}
			{total && (
				<div
					data-sub-total
					data-ly-tip={TOTAL_TIP}
					className="flex h-[20px] items-center justify-end px-2 text-caption tabular-nums text-ink-faint"
				>
					本次编排 · {agents.length} 个子 Agent · {total}
				</div>
			)}
		</div>
	);
}

function Branch({
	node,
	active,
	onFocus,
	trailing,
}: {
	node: RosterNode;
	active: boolean;
	onFocus: (id: string) => void;
	trailing?: (agent: SubAgentSummary) => ReactNode;
}) {
	const { agent, level, children } = node;
	/*
	 * A root with children shows the branch, not itself: what dispatching it cost is the whole
	 * errand, and its own share is a detail the tip carries.
	 */
	const figures = figuresWord(children.length > 0 ? node.branch : node.own);
	return (
		<div
			role="treeitem"
			aria-level={level}
			aria-selected={active}
			data-sub-tab={agent.id}
			data-sub-level={level}
			style={{ paddingLeft: 8 + (level - 1) * 14 }}
			className={`group/subtab flex h-[22px] items-center gap-1.5 pr-1.5 transition-colors duration-[var(--ly-t-quick)] ${
				active ? "bg-card-hover text-ink" : "text-ink-faint hover:text-ink"
			}`}
		>
			<button
				type="button"
				data-ly-tip={tipFor(agent)}
				onClick={() => onFocus(agent.id)}
				className="flex min-w-0 flex-1 items-center gap-1.5 text-detail"
			>
				<Dot agent={agent} />
				<span className="min-w-0 truncate whitespace-nowrap">{agent.description}</span>
				<span className="shrink-0 text-caption text-ink-faint">{agent.agent}</span>
			</button>
			{figures && (
				<span
					data-sub-figures
					data-ly-tip={
						children.length > 0
							? `含它派生的子 Agent 在内；它自己：${figuresWord(node.own) ?? "还没有"}`
							: "这个子 Agent 用掉的 token 与估算费用"
					}
					className="shrink-0 text-caption tabular-nums text-ink-faint"
				>
					{figures}
				</span>
			)}
			{trailing?.(agent)}
		</div>
	);
}

/** The dot carries the state, so the name does not have to spell it out. */
function Dot({ agent }: { agent: SubAgentSummary }) {
	return (
		<span
			className={`size-[5px] shrink-0 rounded-full ${statusTone(agent.status)} ${agent.status === "running" ? "ly-pulse" : ""}`}
		/>
	);
}

function tipFor(one: SubAgentSummary): string {
	return `${one.agent} · ${statusWord(one.status)} · ${ranFor(one)}`;
}
