/**
 * 后台子智能体的结果送回来了——对话里的一行说明，不是一个人发的气泡。
 *
 * 人在主智能体等子智能体的时候插了话，主智能体先去回应人，子智能体留在后台接着跑；跑完之后，
 * 运行时把结果作为一条消息交回主智能体，主智能体接着干（`core/runtime/delegation-waits.ts`）。
 * 那条消息是写给模型的：报告原文套着标签。原样画出来，读的人会看见一大段自己没说过的话落在自己
 * 那一侧；什么都不画，主智能体又会像是自己突然动了起来。
 *
 * 所以画成一行：谁的结果回来了。报告本身在对应的派发卡片和子智能体面板里都有，这里只说「它回来
 * 了、主智能体接着处理」，点一下面板翻到它那一页。
 */

import type { DeliveredReport } from "@lyra/core";
import { useI18n } from "../../i18n/index.ts";
import { translate } from "../../i18n/translate.ts";
import { useAgentAvatars } from "../../store/agent-avatars.ts";
import { useSubAgents } from "../../store/subAgents.ts";
import { useScopedSessionId } from "../../app/session-scope.tsx";
import { AgentAvatar } from "../../ui/avatar/AgentAvatar.tsx";
import { AvatarPile } from "../../ui/avatar/AvatarPile.tsx";
import type { DispatchState } from "../../lib/dispatches.ts";

/** 一份报告是什么表情：和派发卡片、输入框上方那条用同一套。 */
function moodOf(report: DeliveredReport): DispatchState {
	if (report.status === "failed") return "failed";
	if (report.status === "aborted" || report.incomplete) return "stopped";
	return "done";
}

function outcome(report: DeliveredReport): string {
	if (report.status === "failed") return translate("subAgentReturn.failed");
	if (report.incomplete) return translate("subAgentReturn.partial");
	return translate("subAgentReturn.done");
}

export function DeliveryRow({ delivery }: { delivery: DeliveredReport[] }) {
	const { t } = useI18n();
	const avatarOf = useAgentAvatars();
	const sessionId = useScopedSessionId();
	if (delivery.length === 0) return null;
	const one = delivery.length === 1 ? delivery[0] : null;
	const failed = delivery.filter((report) => report.status === "failed").length;
	const text = one ? t("subAgentReturn.one", { name: one.description || one.agent }) : t("subAgentReturn.many", { n: delivery.length });
	const tip = delivery.map((report) => t("subAgentReturn.tipLine", { name: report.description || report.agent, agent: report.agent, outcome: outcome(report) })).join("\n");
	return (
		<div className="my-2 flex" data-delivery-row="">
			<button
				type="button"
				data-ly-tip={tip}
				onClick={() => useSubAgents.getState().reveal(delivery[0].id, sessionId)}
				className="flex min-w-0 max-w-full items-center gap-2 rounded-lg py-1 pr-2 pl-1 text-detail text-ink-muted transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink"
				data-ly-avatar-host=""
			>
				{one ? (
					<AgentAvatar avatar={avatarOf(one.agent)} size={18} mood={moodOf(one)} seed={one.agent} host="[data-ly-avatar-host]" />
				) : (
					<AvatarPile faces={delivery.map((report) => ({ key: report.id, avatar: avatarOf(report.agent), mood: moodOf(report), seed: report.agent }))} size={20} max={4} />
				)}
				<span className="min-w-0 truncate">{text}</span>
				{failed > 0 && <span className="shrink-0 text-danger">· {t("subAgentReturn.failedCount", { n: failed })}</span>}
			</button>
		</div>
	);
}
