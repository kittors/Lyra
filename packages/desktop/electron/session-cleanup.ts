/**
 * 会话记录占了多少地方，以及怎么把一段时间的删掉。
 *
 * 用量页上的每一个数字都是现算的——扫一遍 `~/.lyra/sessions` 下的日志，把里面的 token 加起来。
 * 所以「清除统计数据」没有一个单独的东西可以清：**要让那些数字消失，只能删掉产生它们的会话**，
 * 而那些会话就是聊天记录本身。这个模块存在的第一个理由，就是把这件事说清楚，而不是让一个叫
 * 「清除统计」的按钮悄悄删掉半年的对话。
 *
 * 删除的单位是一整条会话，不是某几条消息。一条会话的用量摊在它活跃的每一天上，按天把中间几段
 * 剜掉，留下的是一份读不通的对话和一份仍然对不上的账——两样都不值得要。所以时间范围筛的是
 * 「最后活动时间」：一条八月建、昨天还在写的会话，属于昨天。
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { lyraHome, removeSessionArtifacts, type SessionMeta, type SessionStorage } from "@lyra/core";

/** 本地日期键，和用量页、扫描器用的是同一个口径——不是 ISO/UTC。 */
function dayKey(ms: number): string {
	const date = new Date(ms);
	const month = `${date.getMonth() + 1}`.padStart(2, "0");
	const day = `${date.getDate()}`.padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day}`;
}

/** 一天里最后活动过的那些会话：几条，占多少。 */
interface StorageDay {
	day: string;
	sessions: number;
	bytes: number;
}

export interface StorageUse {
	/** 会话日志占的字节数。 */
	bytes: number;
	/** 有几条会话。 */
	sessions: number;
	/** 最早、最晚那条会话的最后活动日（本地 `YYYY-MM-DD`）。没有会话时都是 null。 */
	earliest: string | null;
	latest: string | null;
	/**
	 * 按天摊开，好让「选了这一段会删掉什么」在按下去之前就算得出来。
	 *
	 * 不给这个，界面只能拿总数去问「删除全部 303 条？」——而实际上落在所选范围里的可能只有 1 条。
	 * 一个说 4 条却删 1 条的确认框已经够糟；反过来那次就是灾难，而它们是同一个 bug 的两个方向。
	 *
	 * 一天一行而不是一条会话一行：三百条会话摊在六十天里，六十行传过去是几 KB，而按天足够精确
	 * ——范围本来就是按天选的。
	 */
	days: StorageDay[];
}

/**
 * 要删哪一段，两头都含当天。
 *
 * 两个都是 null 就是全部——这是「一键清空」，而不是一个退化的区间。
 */
export interface ClearRange {
	from: string | null;
	to: string | null;
}

export interface ClearResult {
	/** 删掉了几条会话。 */
	removed: number;
	/** 释放了多少字节（按删之前量到的日志大小算）。 */
	freed: number;
	/** 正在跑、所以没动的那几条。 */
	skipped: number;
}

/** 落在这一段里吗。两头都含当天，空的那头表示不设限。 */
export function withinRange(meta: Pick<SessionMeta, "updatedAt">, range: ClearRange): boolean {
	const day = dayKey(meta.updatedAt);
	if (range.from && day < range.from) return false;
	if (range.to && day > range.to) return false;
	return true;
}

/** 一条会话的日志有多大。读不到就当 0——它可能刚被别处删掉，不值得让整张表算不出来。 */
async function sizeOf(home: string, meta: Pick<SessionMeta, "projectId" | "id">): Promise<number> {
	const info = await stat(join(home, "sessions", meta.projectId, `${meta.id}.jsonl`)).catch(() => null);
	return info?.size ?? 0;
}

/**
 * 会话日志一共占多少。
 *
 * 数的是 `sessions/` 下的 `.jsonl`，不是整个 `~/.lyra`——因为这正是下面那个删除动作能收回来的
 * 部分。索引、缓存、插件目录都不归它管，把它们算进来会让「删了却没少多少」变成常态。
 *
 * 走目录而不是走索引：一个索引里没有的孤儿日志照样占着盘，而它恰恰是最该被数出来的那种。
 */
export async function storageUse(store: SessionStorage, home = lyraHome()): Promise<StorageUse> {
	const root = join(home, "sessions");
	let bytes = 0;
	for (const project of await readdir(root, { withFileTypes: true }).catch(() => [])) {
		if (!project.isDirectory()) continue;
		for (const file of await readdir(join(root, project.name)).catch(() => [])) {
			if (!file.endsWith(".jsonl")) continue;
			const info = await stat(join(root, project.name, file)).catch(() => null);
			bytes += info?.size ?? 0;
		}
	}

	const sessions = await store.listSessions();
	/*
	 * 每条会话量一次自己的日志，摊到它最后活动的那一天上。
	 *
	 * 总数那个 `bytes` 走目录（孤儿日志也占盘，也该数出来），这里走索引——按天分组问的是「删掉
	 * 这一段会少多少」，而只有索引里的会话才会被删。两个数字对不上的那部分正是孤儿，它不属于
	 * 任何一天。
	 */
	const byDay = new Map<string, StorageDay>();
	for (const meta of sessions) {
		const day = dayKey(meta.updatedAt);
		const seen = byDay.get(day) ?? { day, sessions: 0, bytes: 0 };
		seen.sessions += 1;
		seen.bytes += await sizeOf(home, meta);
		byDay.set(day, seen);
	}
	const days = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
	return {
		bytes,
		sessions: sessions.length,
		earliest: days[0]?.day ?? null,
		latest: days[days.length - 1]?.day ?? null,
		days,
	};
}

/**
 * 把这一段里的会话删掉，连同它们写在项目外的东西。
 *
 * 正在跑的会话跳过，不打断。删一条正在执行工具调用的会话，省下的那几兆远不如它正在写的东西
 * 值钱——而且它下一次落盘又会把文件建回来，于是「删干净了」是假的。跳过几条要在结果里报出来，
 * 不能让它们无声地留下。
 *
 * 先量大小再删：`deleteMany` 之后文件就不在了，那时候再 stat 得到的是 0，释放量会报成一片零。
 */
export async function clearSessions(
	store: SessionStorage,
	range: ClearRange,
	isRunning: (sessionId: string) => boolean,
	home = lyraHome(),
): Promise<ClearResult> {
	const all = await store.listSessions();
	const matched = all.filter((meta) => withinRange(meta, range));
	const targets = matched.filter((meta) => !isRunning(meta.id));
	if (targets.length === 0) return { removed: 0, freed: 0, skipped: matched.length };

	const freed = (await Promise.all(targets.map((meta) => sizeOf(home, meta)))).reduce((sum, size) => sum + size, 0);
	await store.deleteMany(targets.map((meta) => ({ projectId: meta.projectId, id: meta.id })));
	await Promise.all(targets.map((meta) => removeSessionArtifacts(home, meta.id).catch(() => {})));

	return { removed: targets.length, freed, skipped: matched.length - targets.length };
}
