import type { SessionActivity } from "@lyra/core/activity";

import { BreatheLoader } from "../ui/motion/loaders.tsx";

const LABEL: Record<SessionActivity, string> = {
	running: "正在执行",
	waiting: "等待你的批准",
	done: "已完成 · 未查看",
	failed: "执行失败 · 未查看",
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
			data-ly-tip={activity ? LABEL[activity] : undefined}
			data-ly-tip-side="right"
			aria-label={activity ? LABEL[activity] : undefined}
			role={activity ? "img" : undefined}
		>
			{activity === "running" ? (
				/*
				 * Just inside the slot, not filling it.
				 *
				 * The rings expand to the full width at the end of each breath, so a loader given
				 * the whole 14px would touch its neighbours at the top of every cycle. At 12px the
				 * widest ring still clears the row, and the core — which is what you actually read
				 * at a glance — stays the size of the dots the other states use.
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
