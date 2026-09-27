/**
 * 一张授权卡活多久。
 *
 * 主会话自己的问题跟着它那一轮走：循环是等到回答才往下走的，一轮收尾时它的问题不可能还有人等，
 * 收掉是兜底。后台子智能体的问题不一样——主会话放了手、先去回应人之后，它们还在跑，问题常常是在
 * 主会话收尾之后才问出来的。一轮收尾就一刀清空，会把这张卡从屏幕上拿走，而那边一直等到五分钟
 * 超时，被当成「不行」。
 *
 * 所以只收主会话的；子智能体的那几张，等核心说它们收场了（`approval_settled`）再拿走。
 */

const NONE: never[] = [];

export function outlivingTurn<T extends { from?: unknown }>(approvals: T[]): T[] {
	if (approvals.length === 0) return approvals;
	const kept = approvals.filter((one) => one.from);
	return kept.length === 0 ? NONE : kept;
}
