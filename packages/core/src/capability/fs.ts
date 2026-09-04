/**
 * 两件 provider 都需要、而谁也不该写第二遍的事：走目录，和读 frontmatter 的键。
 *
 * 这个文件曾经比现在大一倍。另外那一半——一个通用的「读一个目录里的 markdown、逐个构建、
 * 单个文件坏掉不牵连其他」的 `readMarkdownDir`，加上向上找祖先目录、判断是否在点目录里、
 * 命名空间化文件名——写得很仔细，有很好的注释，**而每一个 provider 最后都走了另一条路**：
 * 它们各自复用了本领域已有的 `loadSkills` / `loadRules`。
 *
 * 那半个文件从来没有被调用过。删掉，而不是留着加一句「以后会用上」：一个没跑过的 API 摆在
 * 那里，下一个人会以为那是该走的路。真要走那条路的时候，从 git 历史里捞回来，比对着一段从没
 * 运行过的代码写要安全。
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Files with the given extensions under `dir`. `null` means the directory is not there, which is
 * different from it being empty and is why this does not just return `[]`.
 */
export async function walkFiles(dir: string, extensions: string[], maxDepth: number): Promise<string[] | null> {
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
	if (!entries) return null;

	const out: string[] = [];
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (maxDepth <= 1) continue;
			const nested = await walkFiles(full, extensions, maxDepth - 1);
			if (nested) out.push(...nested);
			continue;
		}
		if (entry.isSymbolicLink()) {
			const target = await stat(full).catch(() => null);
			if (target?.isDirectory()) {
				if (maxDepth <= 1) continue;
				const nested = await walkFiles(full, extensions, maxDepth - 1);
				if (nested) out.push(...nested);
				continue;
			}
		}
		if (extensions.some((ext) => entry.name.toLowerCase().endsWith(ext))) out.push(full);
	}
	return out.sort();
}

/**
 * `disable-model-invocation` and `disableModelInvocation` are the same key.
 *
 * Both spellings exist in the wild — the tools that inspired these formats disagree with each
 * other — and a user who writes the other one gets a field that is silently ignored. Normalising
 * here means a provider reads one spelling and every author gets the behaviour they meant.
 */
export function normalizeKeys(frontmatter: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(frontmatter)) {
		out[key] = value;
		const camel = key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
		if (camel !== key && !(camel in out)) out[camel] = value;
	}
	return out;
}
