/**
 * 一个停下的子代理，面板上给哪条出路。
 *
 * 单独一个文件、只依赖类型：面板和单测都要用它，而 `format.ts` 连着设置页那一串组件，
 * 单测的剥类型运行器加载不了 `.tsx`。
 */

import type { SubAgentStatus } from "@lyra/core";

/**
 * 上下文还在、又没做完的（跑到检查点、上游出错、被按停）→ 接着跑：只付新增的那几轮。上下文
 * 已经不在的失败和按停 → 重派：只能从零来。正常做完的、还在跑的 → 什么都不给。
 *
 * 跑到检查点的那种（`done` + `incomplete`）从前落在最后一类——面板上什么都没有，而它正是
 * 「60 步跑满、啥都没干好」的那一个。
 */
export function wayBack(agent: { status: SubAgentStatus; incomplete?: boolean; resumable?: boolean }): "resume" | "redispatch" | null {
	if (agent.status === "running") return null;
	const unfinished = agent.incomplete === true || agent.status === "failed" || agent.status === "aborted";
	if (!unfinished) return null;
	if (agent.resumable) return "resume";
	return agent.status === "done" ? null : "redispatch";
}
