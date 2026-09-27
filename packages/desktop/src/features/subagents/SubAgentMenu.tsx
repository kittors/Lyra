/**
 * 派出去的那几个，一张单子：谁、在干什么、到哪一步了——点一行就去看它。
 *
 * 从前面板顶上是一排 tab，派得多了就横着滚、名字被截成「检查项目质量与工程…」，谁在跑要看那颗
 * 5px 的点；输入框上方那条则把每张脸并排摆开，五个就是一长串。两处都在「数人」，都没回答「他们
 * 各自在干什么」。这张单子一行一个人：脸带着状态，描述写全，第二行是它此刻在做的事（在跑时）
 * 或者它花了多少（跑完后）。
 *
 * 只在不止一个时出现。一个的时候没什么可选的，那一行本身就是它。
 *
 * 派生出来的（子智能体又派的）按树缩进在它的上级下面，上级那一行的花销是整个分支的。排队的那几个
 * 排在在跑的后面，灰一些，写着「排队中」——它们已经在名单上了（派出去那一刻就登记），点进去是
 * 它领到的那份任务；行尾那颗 × 同样停得下它。
 *
 * 有人在排队的时候，单子底下一行说出闸门有多宽，旁边就是去改它的地方：「为什么只有一个在跑」
 * 是读到那几行「排队中」时最自然的问题，而答案常常是设置里的一个数字（2026-09-26 那位用户的并发
 * 上限就是 1）。放在底下而不是标题里：标题本来就说了三件事，再塞一句就被截成「同时最…」。
 */

import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { SubAgentSummary } from "@lyra/core";
import { delegationConcurrency, normalizeDelegationPolicy } from "@lyra/core/delegation";
import { rosterRows } from "../../store/subAgents.ts";
import { useAgentAvatars } from "../../store/agent-avatars.ts";
import { stateOf } from "../../lib/dispatches.ts";
import { sessionThinking } from "../../lib/thinking.ts";
import { useScopedMeta } from "../../app/session-scope.tsx";
import { AgentAvatar } from "../../ui/avatar/AgentAvatar.tsx";
import { useI18n } from "../../i18n/index.ts";
import { translate } from "../../i18n/translate.ts";
import { doingWord, elapsedSince, figuresWord, ranFor, statusWord } from "./format.ts";
import { useApp } from "../../store/index.ts";
import { bridge } from "../../services/index.ts";

/**
 * 停下并关掉一个（在跑的），或者只是关掉（跑完的）。
 *
 * 停不是一下子的事：它先把自己记成「已停止」，这一行要到下一次才消失。说一声，好过一下点击
 * 看起来什么都没发生。
 */
async function dismissSubAgent(sessionId: string, agent: SubAgentSummary): Promise<void> {
	const what = await bridge.subAgents.dismiss(sessionId, agent.id);
	if (what === "stopping") useApp.getState().notify(translate("subAgent.stopping"), "info");
}

/** 一行的第二句：在跑的说它在做什么（等人授权时说等授权），跑完的说它花了多少，排着的不说。 */
function doing(one: SubAgentSummary, figures: string | null): string {
	if (one.awaitingApproval) return translate("subAgent.awaitingApproval");
	if (one.status === "running") return doingWord(one) ?? figures ?? "";
	if (one.status === "queued") return "";
	return figures ?? "";
}

/** 一行右上角那个读数：在跑的是表，排着的是「排队中」，结束的是怎么结束的、跑了多久。 */
function stateLine(one: SubAgentSummary): string {
	if (one.status === "running") return elapsedSince(one.startedAt);
	if (one.status === "queued") return translate("subAgent.queued");
	return `${statusWord(one.status)} · ${ranFor(one)}`;
}

/**
 * 这一轮闸门实际有多宽——跟运行时算法一样：设置里的上限，按这场对话的推理等级和派活档位收窄。
 *
 * 算的是此刻的设置和等级，运行时每一轮开头、以及设置一改就按同一个式子重算，所以两边说的是
 * 同一个数（见 `turn-config.ts` 的 `refreshDispatchGate`）。
 */
function useGateWidth(): number | null {
	const settings = useApp((s) => s.settings);
	const meta = useScopedMeta();
	if (!settings) return null;
	return delegationConcurrency(settings.maxConcurrentSubAgents, sessionThinking(meta, settings), normalizeDelegationPolicy(settings.subAgentDelegation));
}

export function SubAgentMenu({ agents, current, sessionId, onPick }: {
	/** 登记簿里的（包括排着的），按什么顺序都行——这里按派生树重排。 */
	agents: SubAgentSummary[];
	current: string | null;
	/** 行尾那颗 × 要知道是哪个会话的；没有就不画。 */
	sessionId: string | null;
	onPick: (id: string) => void;
}) {
	const { t } = useI18n();
	const avatarOf = useAgentAvatars();
	const rows = rosterRows(agents);
	const running = agents.filter((one) => one.status === "running").length;
	const queued = agents.filter((one) => one.status === "queued").length;
	const width = useGateWidth();
	const host = useRef<HTMLDivElement>(null);
	/*
	 * 打开时焦点落在正在看的那一行上，上下键在行之间走——从键盘打开的人不用先按一串 Tab 才进得来。
	 * 用鼠标打开的不会看到焦点框：程序给的焦点只在上一个动作来自键盘时才画 `:focus-visible`。
	 */
	useEffect(() => {
		const items = [...(host.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
		(items.find((item) => item.getAttribute("aria-current") === "true") ?? items[0])?.focus({ preventScroll: true });
	}, []);
	const onKeyDown = (event: React.KeyboardEvent) => {
		const items = [...(host.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
		if (items.length === 0) return;
		const at = items.indexOf(document.activeElement as HTMLElement);
		const next =
			event.key === "ArrowDown" ? (at + 1) % items.length
			: event.key === "ArrowUp" ? (at <= 0 ? items.length - 1 : at - 1)
			: event.key === "Home" ? 0
			: event.key === "End" ? items.length - 1
			: null;
		if (next === null) return;
		event.preventDefault();
		items[next].focus();
	};
	return (
		<div ref={host} className="w-[340px] max-w-full p-1" data-sub-menu="" role="none" onKeyDown={onKeyDown}>
			<p className="truncate px-2.5 pt-1.5 pb-2 text-caption text-ink-faint" data-sub-menu-heading="">
				{t("subAgentMenu.heading", { n: agents.length, running })}
				{queued > 0 && ` · ${t("subAgentBar.queued", { n: queued })}`}
			</p>
			{rows.map(({ agent, level, children, own, branch }) => {
				const figures = figuresWord(children.length > 0 ? branch : own);
				const selected = agent.id === current;
				const state = stateLine(agent);
				const waiting = agent.status === "queued";
				return (
					<div key={agent.id} data-sub-row={agent.id} data-sub-level={level} data-selected={selected || undefined} data-sub-queued={waiting || undefined} data-ly-avatar-host=""
						className={`group/subrow relative flex items-center rounded-[10px] transition-colors duration-[var(--ly-t-quick)] ${selected ? "bg-card-hover" : "hover:bg-card-hover/70"}`}
						style={{ paddingLeft: (level - 1) * 16 }}>
						<button type="button" role="menuitem" aria-current={selected || undefined} onClick={() => onPick(agent.id)}
							data-ly-tip={`@${agent.agent} · ${agent.description}`}
							className="flex min-w-0 flex-1 items-center gap-2.5 py-2 pr-1 pl-2.5 text-left">
							{level > 1 && <span aria-hidden className="-ml-1 h-4 w-2 shrink-0 rounded-bl-[4px] border-b border-l border-line" />}
							<AgentAvatar avatar={avatarOf(agent.agent)} size={22} mood={stateOf(agent)} seed={agent.agent} host="[data-ly-avatar-host]" />
							<span className="min-w-0 flex-1">
								<span className="flex items-baseline gap-2">
									<span className={`min-w-0 flex-1 truncate text-label ${waiting ? "text-ink-muted" : "text-ink"}`}>{agent.description}</span>
									<span className={`shrink-0 text-caption tabular-nums ${agent.status === "failed" ? "text-danger" : "text-ink-faint"}`}>{state}</span>
								</span>
								<span className="mt-0.5 flex min-w-0 items-baseline gap-1.5 text-caption text-ink-faint">
									<span className="shrink-0 font-mono">@{agent.agent}</span>
									{doing(agent, figures) && (
										<span
											className={`ly-fade-tail min-w-0 truncate ${agent.awaitingApproval ? "text-accent" : ""}`}
											data-sub-figures={agent.status === "running" ? undefined : ""}
											/* 上级那一行的花销是整个分支的；它自己用了多少放在提示里。 */
											data-ly-tip={agent.status !== "running" && children.length > 0 ? t("roster.withDescendants", { own: figuresWord(own) ?? t("roster.none") }) : undefined}
										>
											· {doing(agent, figures)}
										</span>
									)}
								</span>
							</span>
						</button>
						{/* 行尾那颗 ×：在跑的停下并关掉，跑完的只是关掉。 */}
						{sessionId && (
							<button type="button" data-ly-tip={agent.status === "running" || waiting ? t("subAgent.stopAndClose") : t("common.close")}
								aria-label={agent.status === "running" || waiting ? t("subAgent.stopAndCloseOne", { name: agent.description }) : t("subAgent.closeOne", { name: agent.description })}
								onClick={() => void dismissSubAgent(sessionId, agent)}
								className="mr-1.5 grid h-6 w-6 shrink-0 place-items-center rounded-md text-ink-faint opacity-0 transition-opacity duration-[var(--ly-t-quick)] group-hover/subrow:opacity-100 hover:bg-elevated hover:text-ink focus-visible:opacity-100">
								<X size={12} strokeWidth={2.2} aria-hidden />
							</button>
						)}
					</div>
				);
			})}
			{queued > 0 && width !== null && (
				<p className="mt-1 flex items-center gap-2 border-t border-line-soft px-2.5 pt-2 pb-1 text-caption text-ink-faint" data-sub-menu-cap="">
					<span className="min-w-0 flex-1">{t("subAgentMenu.cap", { n: width })}</span>
					<button
						type="button"
						data-sub-menu-adjust=""
						onClick={() => {
							useApp.getState().setSettingsSection("delegation");
							useApp.getState().setView("settings");
						}}
						className="shrink-0 rounded-md px-1.5 py-0.5 text-caption text-accent transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover"
					>
						{t("subAgentMenu.adjust")}
					</button>
				</p>
			)}
		</div>
	);
}
