import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/**
 * 一个路径的规范写法：`..` 解开，软链也解开。
 *
 * `file-ops.ts` 里的边界检查只做前者，那是它有意的——那个文件是一组纯字符串规则，不碰磁盘。
 * 可判断「这个路径在不在项目里」的两侧并不是从同一个地方来的：目录列举交给渲染进程的是规范
 * 路径，配置里存的是用户当初选中的那个写法。macOS 上一个位于 `/tmp` 或任何软链下的项目，
 * 一边是 `/private/var/…`，另一边还是 `/var/…`——同一个目录，两种写法，`relative()` 算出一串
 * `../..`，于是新建、重命名、删除、复制粘贴全被判在项目之外，而且判完什么都不说。
 *
 * 解析软链同时是更严的读法：项目里一个指向项目外的软链，不再是一条绕过边界的通路。
 *
 * 目标可以还不存在——新建文件时它必然不存在。那就往上找到第一个存在的祖先，解析它，再把剩下
 * 的一段接回去；一路到根都解不开时按字面归一，这是没有软链可言的情况。
 */
export function canonicalPath(target: string): string {
	const full = resolve(target);
	try {
		return realpathSync.native(full);
	} catch {
		const parent = dirname(full);
		// 到根了：再往上没有东西可解，字面量就是它自己。
		if (parent === full) return full;
		return join(canonicalPath(parent), basename(full));
	}
}
