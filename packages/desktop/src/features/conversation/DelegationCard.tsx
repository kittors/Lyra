/**
 * 对话里的一次派发：派给了谁、它此刻怎么样了。
 *
 * 从前这一行和读文件、跑命令长得一样——一枚通用图标、一句描述、一个转圈。可派出去的是一个会
 * 自己干一阵子活的「人」，它在不在干、干完没有、卡没卡住，才是这一行该回答的问题。于是：
 *
 * - 前面是它的脸，带着表情（颠着干活、眯眼排队、弯眼交差、叉眼出错）；
 * - 后面写派给了 `@谁`；
 * - 闸门后面还在排队的，不转圈也不计时，只说「排队中」——它还没开始，计时是在说谎；
 * - 点一下直接翻到面板里它那一页，看它的全过程。登记簿里已经没有它的（历史会话），照旧展开看参数和结果。
 * - 人插话时转到后台的：工具调用早就交回了一句「转到后台了」，但它还在跑——这张卡跟着登记簿画它
 *   此刻的样子，不把那句话当成结论。
 */

import { useMemo, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import type { AssistantContent, AssistantMessage, ToolResult } from "@lyra/core";
import { useApp, type ToolRun } from "../../store/index.ts";
import { useAgentAvatars } from "../../store/agent-avatars.ts";
import { useSubAgents } from "../../store/subAgents.ts";
import { useScopedMessages, useScopedRunning, useScopedSessionId, useScopedSubAgents } from "../../app/session-scope.tsx";
import { deliveredReports, joinDispatches, type Dispatch } from "../../lib/dispatches.ts";
import { AgentAvatar } from "../../ui/avatar/AgentAvatar.tsx";
import { AvatarStack } from "../../ui/avatar/AvatarStack.tsx";
import { translate, useI18n } from "../../i18n/index.ts";
import { toolCardFallback } from "./tool-status.ts";

type ToolCall = Extract<AssistantContent, { type: "toolCall" }>;

/** `ToolCard` 收的那些属性里，派发卡片要填的那几个。照着写一份而不是引它的类型：见 `useDelegation`。 */
interface DelegationProps {
	stateKey?: string;
	toolName: string;
	args: Record<string, unknown>;
	summary: string;
	status: "running" | "done" | "error";
	result?: ToolResult;
	startedAt?: number;
	mark: ReactNode;
	aside: ReactNode;
	onOpen?: () => void;
	openLabel: string;
	pending?: string;
}

/**
 * 一段里的派发，整组一起对号。
 *
 * 一张一张各自对的话，两个同名同描述的会抢同一条登记。只订阅这几条记录，逐条比身份——整张
 * `toolRuns` 表每冒一行命令输出就换一次，订阅它等于让这一段跟着每一行输出重画（见 `LiveToolCard`）。
 */
export function useDispatches(calls: readonly ToolCall[], runs?: Record<string, ToolRun>): Dispatch[] {
	const roster = useScopedSubAgents();
	const delivered = useDelivered();
	const tasks = calls.filter((call) => call.name === "task");
	const records = useApp(useShallow((s) => tasks.map((call) => (runs ?? s.toolRuns)[call.id])));
	if (tasks.length === 0) return [];
	return joinDispatches(tasks.map((call, index) => ({ id: call.id, args: call.arguments, run: records[index] })), roster, delivered);
}

/** 这场对话里送达过的后台结果——登记簿里没有它了的时候，转到后台的派发靠它知道怎么收场的。 */
function useDelivered() {
	const messages = useScopedMessages();
	return useMemo(() => deliveredReports(messages), [messages]);
}

/** 行尾那一排脸：收起的一行说了「派发子任务 4 个」，脸说了是谁、到哪一步了。 */
export function DispatchFaces({ dispatches }: { dispatches: Dispatch[] }) {
	const avatarOf = useAgentAvatars();
	if (dispatches.length === 0) return null;
	return (
		<AvatarStack size={15} max={6} faces={dispatches.map((one) => ({
			key: one.callId,
			avatar: avatarOf(one.agent),
			mood: one.state,
			seed: one.agent,
			tip: `@${one.agent} · ${one.description}${one.state === "waiting" ? ` — ${translate("subAgent.queued")}` : ""}`,
		}))} />
	);
}

/**
 * 一张派发卡片该怎么画——交给 `ToolCard` 去画。
 *
 * 只算不画：这个文件要是自己引 `ToolCard`（连它的类型也算），依赖图上就多出一条绕回对话的环
 * （`ToolCard` 连着 git、dock、composer……最后回到 conversation）。画的那一步留在 `runs.tsx`，
 * 它本来就引着 `ToolCard`；属性照着写一份 `DelegationProps`，多一个字段 tsc 会在那边报出来。
 */
export function useDelegation({ block, run, stopReason, dispatch, detached }: {
	block: ToolCall;
	run?: ToolRun;
	stopReason: AssistantMessage["stopReason"];
	/** 整组一起对过号的结果；单独出现的一张自己对。 */
	dispatch?: Dispatch;
	/** 画在子智能体自己的转录里：那是一段已经结束的记录，不看主会话此刻在不在跑。 */
	detached?: boolean;
}): DelegationProps {
	const { t } = useI18n();
	const roster = useScopedSubAgents();
	const sessionId = useScopedSessionId();
	const turnRunning = useScopedRunning();
	const avatarOf = useAgentAvatars();
	const delivered = useDelivered();
	const view = dispatch ?? joinDispatches([{ id: block.id, args: block.arguments, run }], roster, delivered)[0];
	const summary = view.summary;
	/*
	 * 转到后台、还在跑的：调用那一头早就「做完」了（交回的是一句「转到后台了」），卡片却要照实说它
	 * 还在跑——转圈、计时，排着的说排队中。
	 */
	const backgrounded = (run?.result?.details as { detached?: unknown } | undefined)?.detached === true;
	const stillGoing = backgrounded && (summary?.status === "running" || summary?.status === "queued");
	// 翻到它那一页、并请状态条把面板打开——见 `useSubAgents.reveal`。
	const open = summary ? () => useSubAgents.getState().reveal(summary.id, sessionId) : undefined;
	return {
		stateKey: detached ? undefined : `tool-${block.id}`,
		toolName: block.name,
		args: block.arguments,
		summary: view.description,
		status: stillGoing ? "running" : (run?.status ?? toolCardFallback(stopReason, detached ? false : turnRunning)),
		result: run?.result,
		// 计时从它真正开跑算，不从派发算：排队的那段不是它的时间。
		startedAt: summary?.startedAt ?? run?.startedAt,
		mark: <AgentAvatar avatar={avatarOf(view.agent)} size={18} mood={view.state} seed={view.agent} host="[data-ly-avatar-host]" />,
		aside: <span className="max-w-[40%] shrink-0 truncate font-mono text-caption text-ink-faint">@{view.agent}</span>,
		onOpen: open,
		openLabel: t("subAgent.openInPanel", { name: view.agent }),
		pending: view.state === "waiting" ? t("subAgent.queued") : undefined,
	};
}
