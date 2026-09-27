/**
 * 面板顶上那一行：此刻在看的是谁、它在干什么——派了不止一个时，从这里换人。
 *
 * 从前这里是两层。上面一排 tab，派得多了横着滚、名字被截成「检查项目质量与工程…」；有了第二层
 * 派生就换成一棵树，每行 22px，四个人就把正文往下推了一百多像素。下面一行 32px 的读数把 agent
 * 名、时长、调用次数、花销、最近一步挤在一起，面板一窄就互相压着截断。
 *
 * 现在只有一行半：脸、它的任务写到放不下为止，下面一行小字是它的读数。派了不止一个的时候脸叠成
 * 一摞——后一张压着前一张，正在看的那张放在最后、压在最上面，紧挨着它的标题——整块是一个按钮，
 * 点开是和输入框上方同一张单子，点一行换过去。
 * 只有一个的时候没什么可选的，那就不画下拉的箭头，也不是按钮。
 */

import { ChevronDown, CircleStop } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { SubAgentSummary } from "@lyra/core";
import { useI18n } from "../../i18n/index.ts";
import { figuresOf, rosterOrder, useSubAgents } from "../../store/subAgents.ts";
import { useAgentAvatars } from "../../store/agent-avatars.ts";
import { stateOf } from "../../lib/dispatches.ts";
import { AgentAvatar } from "../../ui/avatar/AgentAvatar.tsx";
import { AvatarPile } from "../../ui/avatar/AvatarPile.tsx";
import { Popover, usePopover } from "../../ui/overlay/Popover.tsx";
import { doingWord, figuresWord, ranFor, statusWord } from "./format.ts";
import { SubAgentMenu } from "./SubAgentMenu.tsx";
import { bridge } from "../../services/index.ts";

export function SubAgentHeader({ agent, agents, sessionId }: {
	agent: SubAgentSummary;
	/** 这个会话的整份名单，排着的也在里面。 */
	agents: SubAgentSummary[];
	sessionId: string | null;
}) {
	const { t } = useI18n();
	const avatarOf = useAgentAvatars();
	const menu = usePopover();
	const host = useRef<HTMLDivElement>(null);
	/* 单子不比面板宽：打开的那一刻量一次——面板常常只有三百来像素，一张 348 的单子会探出去半截。 */
	const [menuWidth, setMenuWidth] = useState(348);
	const running = agent.status === "running";
	const queued = agent.status === "queued";
	/* 在跑的时候时钟每秒走一格，跑完就停在结束的那一刻。 */
	const [, tick] = useState(0);
	useEffect(() => {
		if (!running) return;
		const timer = window.setInterval(() => tick((n) => n + 1), 1000);
		return () => window.clearInterval(timer);
	}, [running]);

	const many = agents.length > 1;
	const figures = figuresWord(figuresOf(agent));
	/*
	 * 在跑的说它此刻在做什么——「它是不是卡住了」就在这儿回答；正在重连时说重连，那才是实话：
	 * 卡在重试上的，最后一次工具调用可能是半小时前的事。跑完的说它一共调用了几次。
	 */
	const doing = agent.awaitingApproval ? t("subAgent.awaitingApproval") : running ? doingWord(agent) : null;
	const calls = agent.toolCalls > 0 ? t("subAgent.calls", { n: agent.toolCalls }) : null;
	const state = running ? ranFor(agent) : queued ? statusWord(agent.status) : `${statusWord(agent.status)} · ${ranFor(agent)}`;
	const full = [`@${agent.agent}`, state, figures, calls, doing].filter(Boolean).join(" · ");

	const face = many ? (
		/* 正在看的那张压在最上面、紧挨着标题——见 `AvatarPile` 的 `focus`。 */
		<AvatarPile
			size={26}
			max={3}
			focus={agent.id}
			faces={rosterOrder(agents).map((one) => ({ key: one.id, avatar: avatarOf(one.agent), mood: stateOf(one), seed: one.agent }))}
		/>
	) : (
		<AgentAvatar avatar={avatarOf(agent.agent)} size={22} mood={stateOf(agent)} seed={agent.agent} host="[data-ly-avatar-host]" />
	);

	const title = (
		<span className="flex min-w-0 flex-1 flex-col text-left">
			<span className="flex min-w-0 items-center gap-1">
				<span className="min-w-0 truncate text-label leading-snug text-ink" data-sub-title="">{agent.description}</span>
				{many && (
					<ChevronDown size={13} strokeWidth={2} aria-hidden className={`shrink-0 text-ink-faint transition-transform duration-[var(--ly-t-quick)] ${menu.open ? "rotate-180" : ""}`} />
				)}
			</span>
			{/*
			 * 面板常常只有三百来像素，这一行放不下全部：按轻重排，放不下的从尾巴上收。在跑的时候最要紧的是
			 * 「它此刻在做什么」，花销挪进悬停说明；跑完了，花销和调用次数才是要看的。整行写全的那一份在
			 * 悬停说明里，什么都没丢。
			 */}
			<span className="flex min-w-0 items-baseline gap-1.5 overflow-hidden text-caption leading-snug text-ink-faint" data-sub-meta="" data-ly-tip={full}>
				<span className="shrink-0 font-mono">@{agent.agent}</span>
				<Sep />
				<span className={`shrink-0 tabular-nums ${agent.status === "failed" ? "text-danger" : ""}`}>{state}</span>
				{running || queued ? (
					doing && (
						<>
							<Sep />
							<span className={`ly-fade-tail min-w-0 truncate ${agent.awaitingApproval ? "text-accent" : agent.retrying ? "text-ink-muted" : ""}`} data-sub-doing="">{doing}</span>
						</>
					)
				) : (
					<>
						{/* 它花了多少——这是决定「派出去值不值」的那个数。 */}
						{figures && (
							<>
								<Sep />
								<span data-sub-figures="" data-ly-tip={t("subAgent.figuresTip")} className="shrink-0 tabular-nums">{figures}</span>
							</>
						)}
						{calls && <span className="min-w-0 truncate tabular-nums">· {calls}</span>}
					</>
				)}
			</span>
		</span>
	);

	return (
		<div ref={host} className="flex shrink-0 items-center gap-1 border-b border-line py-1 pr-1.5 pl-1" data-ly-avatar-host="" data-sub-header="">
			{many ? (
				<button
					type="button"
					onClick={(event) => {
						setMenuWidth(Math.min(348, Math.max(240, (host.current?.clientWidth ?? 348) - 8)));
						menu.toggle(event);
					}}
					aria-haspopup="menu"
					aria-expanded={menu.open}
					aria-label={`${t("subAgentMenu.switch")} · ${agent.description}`}
					data-ly-tip={menu.open ? undefined : t("subAgentMenu.switch")}
					data-sub-switch=""
					className="group/pile flex min-w-0 flex-1 items-center gap-2.5 rounded-[10px] px-1.5 py-1 transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover aria-expanded:bg-card-hover"
				>
					{face}
					{title}
				</button>
			) : (
				<div className="flex min-w-0 flex-1 items-center gap-2.5 px-1.5 py-1">
					{face}
					{title}
				</div>
			)}
			{many && menu.open && (
				<Popover anchor={menu.anchor} onClose={menu.close} placement="bottom" align="start" width={menuWidth} label={t("subAgent.title")}>
					<SubAgentMenu
						agents={agents}
						current={agent.id}
						sessionId={sessionId}
						onPick={(id) => {
							menu.close();
							useSubAgents.getState().focus(id);
						}}
					/>
				</Popover>
			)}
			{(running || queued) && sessionId && (
				<button
					type="button"
					data-ly-tip={t("subAgent.stopTip")}
					aria-label={t("subAgent.stop")}
					onClick={() => void bridge.subAgents.abort(sessionId, agent.id)}
					className="grid size-7 shrink-0 place-items-center rounded-lg text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-danger"
				>
					<CircleStop size={14} strokeWidth={1.9} />
				</button>
			)}
		</div>
	);
}

function Sep() {
	return <span aria-hidden className="shrink-0 text-line">·</span>;
}
