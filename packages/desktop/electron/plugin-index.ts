/**
 * 市场索引的那份缓存，以及「同一个包同一时间只动一次」。
 *
 * 两处要读索引：窗口里的市场页（经 `registry:fetch`），和后台检查更新的定时器（`plugin-updates.ts`）。
 * 从前缓存是 `ipc/plugins.ts` 里的一张私有表，定时器要么再抓一遍、要么读不到——两份缓存就是两个
 * 「现在市场上是什么」的答案。放到这里，两边拿到的是同一份。
 *
 * 锁也是同一个理由：人在市场页上点「更新」的那一刻，后台可能正好在自动更新同一个包。两次安装共用
 * 一个暂存目录（`.<id>.staging`），并排跑的结果是其中一次把另一次正在解的包删掉。
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { fetchRegistry, lyraHome } from "@lyra/core";

/*
 * How long an index is reused without asking again.
 *
 * The platform rebuilds entries on a schedule, so re-fetching every time the view mounts buys nothing
 * and costs a visible reload: leave the page and come back and the shop empties and refills in front
 * of you. Ten minutes is shorter than the platform's refresh and far longer than a browsing session,
 * and 刷新 ignores it entirely.
 */
const INDEX_CACHE_MS = 10 * 60 * 1000;

type Registry = Awaited<ReturnType<typeof fetchRegistry>>;

/** Per URL, so one slow or broken registry does not invalidate the others. */
const indexes = new Map<string, { at: number; registry: Registry }>();

/**
 * `stale` when the answer is the copy kept on disk from an earlier launch rather than this one's —
 * see `allowStale` below.
 */
export type IndexAnswer = { ok: true; registry: Registry; fetchedAt: number; stale?: boolean } | { ok: false; message: string };

/**
 * One index, from the cache when it is fresh enough.
 *
 * A failed refresh falls back to what we last had, rather than to nothing: the copy from an hour ago
 * is almost certainly still true, and it is unquestionably more useful than an empty shop with an
 * error on it. Only a first fetch with nothing behind it reports the failure.
 */
export async function readRegistry(url: string, force = false, maxAge = INDEX_CACHE_MS, allowStale = false): Promise<IndexAnswer> {
	const hit = indexes.get(url);
	if (!force && hit && Date.now() - hit.at < maxAge) return { ok: true, registry: hit.registry, fetchedAt: hit.at };
	/*
	 * `allowStale`: the market page opening for the first time this launch, which would rather draw
	 * the catalogue it showed last time *now* and replace it a moment later than draw a skeleton for
	 * the seconds a fetch takes. The page asks again without it straight after. Only the page asks
	 * this way — the update check never does, so it never installs from a copy that may be old.
	 */
	if (!force && !hit && allowStale) {
		const kept = await readKept(url);
		if (kept) return { ok: true, registry: kept.registry, fetchedAt: kept.at, stale: true };
	}
	try {
		const registry = await fetchRegistry(url);
		const at = Date.now();
		indexes.set(url, { at, registry });
		void keep(url, registry, at);
		return { ok: true, registry, fetchedAt: at };
	} catch (cause) {
		if (hit) return { ok: true, registry: hit.registry, fetchedAt: hit.at };
		return { ok: false, message: cause instanceof Error ? cause.message : String(cause) };
	}
}

/** Where the last good copy of each index is kept between launches. */
function keptPath(url: string): string {
	return join(lyraHome(), "cache", "registries", `${createHash("sha256").update(url).digest("hex").slice(0, 32)}.json`);
}

async function keep(url: string, registry: Registry, at: number): Promise<void> {
	try {
		const path = keptPath(url);
		await mkdir(join(path, ".."), { recursive: true });
		await writeFile(path, JSON.stringify({ url, at, registry }));
	} catch {
		// A copy that could not be written costs the next launch a fetch, and nothing else.
	}
}

async function readKept(url: string): Promise<{ registry: Registry; at: number } | null> {
	try {
		const kept = JSON.parse(await readFile(keptPath(url), "utf8")) as { url?: unknown; at?: unknown; registry?: { name?: unknown; entries?: unknown } };
		if (kept.url !== url || typeof kept.at !== "number" || typeof kept.registry?.name !== "string" || !Array.isArray(kept.registry.entries)) return null;
		return { registry: kept.registry as Registry, at: kept.at };
	} catch {
		return null;
	}
}

const held = new Map<string, Promise<unknown>>();

/**
 * Run `work` once nothing else is installing, updating or removing `id`.
 *
 * Queued rather than refused: a person pressing 更新 while the background happens to be updating the
 * same bundle wants the newest version, and after the queue drains that is what is there.
 */
export function withBundle<T>(id: string, work: () => Promise<T>): Promise<T> {
	const before = held.get(id) ?? Promise.resolve();
	const run = before.catch(() => undefined).then(work);
	const settled = run.catch(() => undefined);
	held.set(id, settled);
	void settled.then(() => {
		if (held.get(id) === settled) held.delete(id);
	});
	return run;
}
