/**
 * 一张缩略图只算一次，算完落盘。
 *
 * 缩略图是解码整张原图、缩小、再编码回去——三件都是同步的，都跑在主进程上。量过：一张 28ms，
 * 是直接读原图的十二倍；十张一起 281ms，其间最便宜的那个 IPC 也要等 91ms，也就是说那段时间
 * 整个应用是哑的。会话里有一百多张图的时候，向上翻页把它们一起带进视口，这笔账就要付三秒。
 *
 * Chromium 本来就缓存，但只认同一个地址，而且只在内存里——应用一重启就全没了，于是每次开应用
 * 后第一次打开带图的会话，这三秒都要重付一遍。落到盘上才是付一次。
 *
 * 缩放本身留在调用方（它需要 Electron 的 `nativeImage`，这里不碰），这个文件只管「算过没有」。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** 缓存名里带边长：同一张图要 128 和 512 两种尺寸时，它们是两个文件，不会互相覆盖。 */
export function thumbPath(home: string, name: string, edge: number): string {
	return join(home, "thumbs", `${name.replace(/\.[^.]+$/, "")}.${edge}.png`);
}

/** 同一张图的并发请求合流，不然十个 img 同时挂上去就是十次同样的解码。 */
const running = new Map<string, Promise<Uint8Array | null>>();

export interface ThumbDeps {
	/** 原图的字节，拿不到就返回 null。 */
	source(): Promise<Uint8Array | null>;
	/** 缩到这个边长，返回 PNG；本来就比它小则返回 null，表示原样发回去。 */
	shrink(bytes: Uint8Array, edge: number): Uint8Array | null;
}

/**
 * 盘上有就读盘上的，没有就算一次、写下来。
 *
 * 命中时连原图都不读——原图是几 MB 的字节，读它本身就有代价，而这条路走到底根本用不上它。
 */
export async function parkedThumb(home: string, name: string, edge: number, deps: ThumbDeps): Promise<Uint8Array | null> {
	const path = thumbPath(home, name, edge);
	const hit = await readFile(path).catch(() => null);
	if (hit) return hit;

	const key = `${path}`;
	const inflight = running.get(key);
	if (inflight) return inflight;

	const work = (async () => {
		const bytes = await deps.source();
		if (!bytes) return null;
		const png = deps.shrink(bytes, edge);
		if (!png) return null;
		/*
		 * 写不进去（盘满、目录被删、只读的家目录）不该让这张图画不出来。
		 * 这一次照样交货，下一次再算一遍——慢，但是看得见图。
		 */
		await mkdir(dirname(path), { recursive: true })
			.then(() => writeFile(path, png))
			.catch(() => undefined);
		return png;
	})();
	running.set(key, work);
	try {
		return await work;
	} finally {
		running.delete(key);
	}
}

/** 盘上那份，没有就 null——调用方用它跳过读原图这一步。 */
export function cachedThumb(home: string, name: string, edge: number): Promise<Uint8Array | null> {
	return readFile(thumbPath(home, name, edge)).catch(() => null);
}
