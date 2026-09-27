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
 *
 * 事情说完了它就自己收起来：派出去的都结束了、主智能体也把它们的结果用完了（这一轮收尾了），
 * 这一行就没有什么可说的了。从前它停在那儿写着「4 个子 Agent 已结束」，要人自己去点叉——而叉掉
 * 它还会顺手把登记簿清空，想回头看一眼就没了。现在它淡出，记录留着：对话里的派发卡片一点，面板
 * 照样翻到那一页。
 */

import { useI18n } from "../../i18n/index.ts";
import { translate } from "../../i18n/translate.ts";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { SubAgentSummary } from "@lyra/core";
import { useAgentAvatars } from "../../store/agent-avatars.ts";
import { figuresOf, isActive, rosterOrder, useSubAgents } from "../../store/subAgents.ts";
import { useScopedSessionId, useScopedSubAgents } from "../../app/session-scope.tsx";
import { stateOf } from "../../lib/dispatches.ts";
import { AgentAvatar } from "../../ui/avatar/AgentAvatar.tsx";
import { AvatarPile } from "../../ui/avatar/AvatarPile.tsx";
import { Collapse } from "../../ui/layout/Collapse.tsx";
import { Popover, usePopover } from "../../ui/overlay/Popover.tsx";
import { doingWord, elapsedSince, figuresWord, statusWord } from "./format.ts";
import { SubAgentMenu } from "./SubAgentMenu.tsx";

/**
 * 这一行此刻要说的那几个：还没完的，和主智能体还没把结果用上的。
 *
 * 「用上了」以这个会话最近一次收尾为准（`settled`）：在那之前结束的，它们的结果已经进了那一轮；
 * 之后结束的——后台跑完、结果刚送回去——主智能体还在用，这一行还得说。人按停的不算：停它的
 * 人知道它停了。
 */
function barAgents(agents: readonly SubAgentSummary[], settledAt: number): SubAgentSummary[] {
	return agents.filter((one) => isActive(one) || (one.status !== "aborted" && (one.endedAt ?? 0) > settledAt));
}

export function SubAgentBar({ onOpen }: { onOpen: () => void }) {
	const { t } = useI18n();
	// This screen's conversation's delegated work — not the focused conversation's.
	const roster = useScopedSubAgents();
	const sessionId = useScopedSessionId();
	const settledAt = useSubAgents((s) => (sessionId ? (s.settled[sessionId] ?? 0) : 0));
	const agents = barAgents(roster, settledAt);
	const running = agents.filter((one) => one.status === "running").length;
	const queued = agents.filter((one) => one.status === "queued").length;
	const avatarOf = useAgentAvatars();
	const menu = usePopover();
	const focused = useSubAgents((s) => s.focused);
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

	/*
	 * 收起的那一段还画着最后那一份：内容先空掉、盒子再合上，看起来是一行字先没了、然后一块空白
	 * 缩回去。菜单开着的时候也不收——人正在读它。
	 */
	const open = agents.length > 0 || menu.open;
	const last = useRef<SubAgentSummary[]>(agents);
	if (agents.length > 0) last.current = agents;
	const drawn = agents.length > 0 ? agents : last.current;

	return (
		<Collapse open={open} className="w-full" bodyClassName="pb-1.5">
			{drawn.length > 0 && (
				<Line
					agents={drawn}
					running={running}
					queued={queued}
					focused={focused}
					sessionId={sessionId}
					menu={menu}
					onOpen={onOpen}
					label={t("subAgentBar.countAndRunning", { n: drawn.length, running })}
					avatarOf={avatarOf}
				/>
			)}
		</Collapse>
	);
}

function Line({ agents, running, queued, focused, sessionId, menu, onOpen, label, avatarOf }: {
	agents: SubAgentSummary[];
	running: number;
	queued: number;
	focused: string | null;
	sessionId: string | null;
	menu: ReturnType<typeof usePopover>;
	onOpen: () => void;
	label: string;
	avatarOf: ReturnType<typeof useAgentAvatars>;
}) {
	const { t } = useI18n();
	const ordered = rosterOrder(agents);
	/*
	 * The whole roster on the tip, which is the question this line raises.
	 *
	 * 「3 个子任务」 immediately asks "which three, and are they moving?" — and the answer is short
	 * enough to give in full. Running ones first, each with what it was asked to do and how long it
	 * has been at it; the rest with how they ended.
	 */
	/*
	 * 这里曾经在末尾还接一行「本次编排合计」，作为铺开子代理的刹车。拿掉了，因为那个刹车装错了
	 * 地方：子代理烧掉的 token 现在直接进这一轮的总数（见 `store/apply-event.ts` 里数
	 * `subagent_message` 的那一段），运行指示器上那个一直在爬的数字本身就是账单。同一笔钱在屏幕
	 * 上写两遍，口径但凡差一点（比如一处含已结束的、一处不含），读的人只会更不知道该信哪个。
	 */
	const line = (one: SubAgentSummary) => {
		const state =
			one.status === "running" ? translate("subAgentBar.runningFor", { elapsed: elapsedSince(one.startedAt) })
			: one.status === "queued" ? translate("subAgentBar.queuedOne")
			: statusWord(one.status);
		// 正在重连时说重连，理由同 `doingWord`：最后一次工具调用可能是半小时前的事了。
		const doing = one.awaitingApproval ? translate("subAgent.awaitingApproval") : doingWord(one);
		const activity = one.status === "running" && doing ? ` · ${doing}` : "";
		const spent = figuresWord(figuresOf(one));
		return `${translate("subAgentBar.tipLine", { description: one.description, agent: one.agent, state })}${activity}${spent ? ` · ${spent}` : ""}`;
	};
	const tip = ordered.map(line).join("\n");

	/*
	 * 一个人的时候，这一行就是它：它的脸、它在做的事、它跑了多久，点一下打开面板。
	 *
	 * 不止一个的时候，脸叠成一摞，点开是一张单子——谁在干什么、到哪一步，点一行面板翻到它那一页。
	 * 从前是一排并排的脸，派五个就摆五张，这一行被挤成一串色块，而它们各自在干什么还得去猜。
	 */
	const single = ordered.length === 1;
	const one = ordered[0];
	const lead = ordered.find((each) => each.status === "running") ?? one;
	const pile = ordered.map((each) => ({ key: each.id, avatar: avatarOf(each.agent), mood: stateOf(each), seed: each.agent }));
	const elapsed = running > 0 ? elapsedSince(Math.min(...ordered.filter((each) => each.status === "running").map((each) => each.startedAt))) : null;
	// 等人授权是最该说出口的状态：它停在那儿不是卡住了，是在等你点。
	const asking = ordered.some((each) => each.awaitingApproval);
	const leadDoing = lead?.awaitingApproval ? t("subAgent.awaitingApproval") : lead?.status === "running" ? doingWord(lead) : lead?.status === "queued" ? t("subAgent.queued") : undefined;

	return (
		<div className="ly-enter group/bar flex w-full items-center gap-1 rounded-[12px] border border-line-soft bg-card/60 py-0.5 pr-2 pl-1 transition-colors hover:bg-card" style={{ "--ly-avatar-ring": "var(--color-card)" } as React.CSSProperties} data-ly-avatar-host="">
			<button
				type="button"
				onClick={single ? onOpen : menu.toggle}
				data-ly-tip={single ? tip : undefined}
				data-ly-subagent-bar
				aria-haspopup={single ? undefined : "menu"}
				aria-expanded={single ? undefined : menu.open}
				aria-label={label}
				className="group/pile flex min-w-0 flex-1 items-center gap-2 rounded-[9px] py-1 pr-1 pl-1 text-detail text-ink-muted transition-colors duration-[var(--ly-t-quick)] hover:text-ink aria-expanded:text-ink"
			>
				{single && one ? (
					<AgentAvatar avatar={avatarOf(one.agent)} size={18} mood={stateOf(one)} seed={one.agent} host="[data-ly-avatar-host]" />
				) : (
					<AvatarPile faces={pile} size={22} max={4} />
				)}
				{/*
				 * What is happening, not how many rows there are.
				 *
				 * With one running, its own description is more use than a count of one; with several,
				 * the count is the only thing that fits and the single name on it is the one that has
				 * been at it longest.
				 */}
				<span className="min-w-0 truncate text-left">{single ? one?.description : headline(ordered, running)}</span>
				{/* 排队的另算一句：它们还没开始，混进「N 个运行中」就说错了。 */}
				{!single && queued > 0 && <span className="shrink-0 text-ink-faint">· {translate("subAgentBar.queued", { n: queued })}</span>}
				{!single && asking && <span className="shrink-0 text-accent" data-sub-asking="">· {t("subAgent.awaitingApproval")}</span>}
				{/* 一个人在跑的时候，顺手说它此刻在做什么——「它是不是卡住了」就在这一行上回答。 */}
				{single && leadDoing && (
					<span className={`ly-fade-tail min-w-0 shrink truncate ${lead?.awaitingApproval ? "text-accent" : "text-ink-faint"}`} data-sub-doing="">
						· {leadDoing}
					</span>
				)}
				<span className="flex-1" />
				{elapsed && <span className="shrink-0 text-caption text-ink-faint tabular-nums">{elapsed}</span>}
				{!single && <ChevronDown size={13} strokeWidth={2} aria-hidden className={`shrink-0 text-ink-faint transition-transform duration-[var(--ly-t-quick)] ${menu.open ? "rotate-180" : ""}`} />}
			</button>
			{!single && menu.open && (
				<Popover anchor={menu.anchor} onClose={menu.close} placement="top" align="start" width={348} label={t("subAgent.title")}>
					<SubAgentMenu
						agents={agents}
						current={focused}
						sessionId={sessionId}
						onPick={(id) => {
							menu.close();
							useSubAgents.getState().focus(id);
							onOpen();
						}}
					/>
				</Popover>
			)}
		</div>
	);
}

function headline(ordered: SubAgentSummary[], running: number): string {
	// 一个都还没开跑、全在排队：头一个马上就会开跑，这一瞬间说「0 个已结束」是错的。
	if (running === 0 && ordered.some((each) => each.status === "queued")) return translate("subAgentBar.starting");
	if (running === 0) return translate("subAgentBar.allFinished", { n: ordered.length });
	if (running === 1) {
		const one = ordered.find((each) => each.status === "running");
		return one ? `${one.description}` : translate("subAgentBar.oneRunning");
	}
	return translate("subAgentBar.nRunning", { n: running });
}

/**
 * Open the pane when work is delegated, once per batch.
 *
 * Not on every roster change — that fires on every tool call of every sub-agent, and a pane that
 * re-opened itself after being closed would be unusable. The first dispatch of a run is worth
 * surfacing; after that the bar is enough.
 */
function useAnnounceSubAgents(open: () => void): void {
	const agents = useScopedSubAgents();
	const seen = useRef(0);
	const session = useScopedSessionId();

	useEffect(() => {
		seen.current = 0;
	}, [session]);

	// 对话里点了某张派发卡片：面板翻到它那一页的同时要打开。只认本屏的会话，另一屏的请求不归这里管。
	const revealed = useSubAgents((s) => s.revealed);
	const handled = useRef(revealed?.at ?? 0);
	useEffect(() => {
		if (!revealed || revealed.at === handled.current) return;
		handled.current = revealed.at;
		if (revealed.sessionId === session) open();
	}, [revealed, session, open]);

	useEffect(() => {
		const running = agents.filter((one) => one.status === "running").length;
		if (running > seen.current) open();
		seen.current = running;
	}, [agents, open]);
}
