import type { MessageKey } from "../../i18n/messages/index.ts";
import { translate } from "../../i18n/translate.ts";
import type { SessionActivity } from "@lyra/core/activity";

import { BreatheLoader } from "../../ui/motion/loaders.tsx";

/** Keys, looked up when the row is drawn — this table is built at import time. */
const LABEL: Record<SessionActivity, MessageKey> = {
	running: "sessionStatus.running",
	waiting: "sessionStatus.waiting",
	done: "sessionStatus.done",
	failed: "sessionStatus.failed",
};

/**
 * What a conversation in the list is doing, in the space of one character.
 *
 * Four things can be true of a conversation and only one of them is visible from a title: it may
 * be running right now, it may have stopped to ask permission and be waiting indefinitely for an
 * answer, it may have finished or failed since you last looked, or there may be nothing to say.
 * Without this the third case is invisible and the second is worse than invisible — an agent
 * waits forever for approval nobody knows it needs.
 *
 * Idle keeps its place rather than collapsing. Every row reserves the same width whatever its
 * state, so titles line up as a column and a mark appearing does not shove one sideways; the
 * faint ring standing in for "nothing" is quiet enough to read as part of the rule.
 */
export function SessionStatus({ activity }: { activity: SessionActivity | null }) {
	return (
		<span
			className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center overflow-visible"
			data-ly-tip={activity ? translate(LABEL[activity]) : undefined}
			data-ly-tip-side="right"
			aria-label={activity ? translate(LABEL[activity]) : undefined}
			role={activity ? "img" : undefined}
		>
			{activity === "running" ? (
				/*
				 * 比槽位小一圈，不填满。
				 *
				 * 波纹每口气的末尾会涨到满宽，所以给足 14px 的话，它每个周期顶点都要碰到邻居。12px
				 * 上最宽的那圈仍然让得开行距，而核心——一眼真正读到的就是它——保持着其余状态那些点
				 * 的大小。
				 *
				 * 这一处没有跟着换成全应用那个射线记号：一列会话可能同时好几行在跑，而这一列还要
				 * 用来读标题。射线并排三四个各自明灭，读标题时旁边总有东西在闪。
				 */
				<BreatheLoader size={12} />
			) : activity === "waiting" ? (
				/*
				 * The only state that is asking for something, so the only one that moves.
				 *
				 * A still mark would sit in the list looking like a result rather than a question,
				 * and this one is a question that blocks until answered. The accent rather than a
				 * new amber: it is the colour this app already uses to mean "you", and a palette
				 * gains nothing from a sixth hue that appears in one place.
				 */
				<span className="ly-pulse block h-[7px] w-[7px] rounded-full bg-accent" />
			) : activity === "done" ? (
				<span className="block h-[7px] w-[7px] rounded-full bg-ok" />
			) : activity === "failed" ? (
				<span className="block h-[7px] w-[7px] rounded-full bg-danger" />
			) : (
				// Nothing to report — a ring rather than a dot, so it reads as an empty slot.
				<span className="block h-[6px] w-[6px] rounded-full border border-line" />
			)}
		</span>
	);
}
