/**
 * How much room the conversations take, and how to delete a stretch of them.
 *
 * What is deleted is whole conversations, never some of their messages. A conversation is spread
 * over every day it was active, and cutting the middle days out of it leaves a transcript that no
 * longer reads. So a range selects by last activity: a conversation started in August and written
 * to yesterday belongs to yesterday.
 *
 * What it spent is not deleted with it. The usage page reads the `spend` table, which deleting a
 * conversation does not touch (ADR-0032): clearing old conversations to free room no longer quietly
 * rewrites what the page says was spent.
 */

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

/**
 * How much room the conversations take, spread over the day each was last active.
 *
 * Counted as each session's records — what deleting it gives back — rather than as the database
 * file, which also holds what is streaming and what was spent, and keeps some free pages for the
 * next writes.
 */
export async function storageUse(store: SessionStorage, _home = lyraHome()): Promise<StorageUse> {
	const sizes = (await store.sizes?.()) ?? {};
	const sessions = await store.listSessions();
	const byDay = new Map<string, StorageDay>();
	let bytes = 0;
	for (const meta of sessions) {
		const day = dayKey(meta.updatedAt);
		const seen = byDay.get(day) ?? { day, sessions: 0, bytes: 0 };
		const size = sizes[meta.id] ?? 0;
		seen.sessions += 1;
		seen.bytes += size;
		bytes += size;
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
 * Delete the conversations in a range, with what they keep outside the database.
 *
 * Running ones are skipped, not interrupted: the few megabytes a conversation in the middle of a
 * tool call would free are worth much less than what it is writing. How many were skipped is
 * reported, so they are not left behind in silence.
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

	// Measured before deleting: afterwards there is nothing left to measure.
	const sizes = (await store.sizes?.()) ?? {};
	const freed = targets.reduce((sum, meta) => sum + (sizes[meta.id] ?? 0), 0);
	await store.deleteMany(targets.map((meta) => ({ projectId: meta.projectId, id: meta.id })));
	await Promise.all(targets.map((meta) => removeSessionArtifacts(home, meta.id).catch(() => {})));

	return { removed: targets.length, freed, skipped: matched.length - targets.length };
}
