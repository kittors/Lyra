/**
 * The answer when there is no language server, and the sentence that says so.
 *
 * A text search is what this app had, and it is not useless — most references are written the way
 * they are declared. What is dangerous is a text search *presented as if it were exhaustive*. So
 * the fallback is allowed to be imprecise and is not allowed to be quiet: every degraded result
 * carries a caveat naming the specific things it cannot see.
 *
 * The two blind spots, both of which produce a rename that compiles locally and breaks elsewhere:
 *
 *   Aliased imports. `import { parse as p }` and then `p(...)` — nothing at the call site contains
 *   the string being searched for.
 *
 *   Re-export chains. `export { parse } from './core.ts'` means the importer's `parse` resolves
 *   somewhere the grep never visits.
 */

import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import type { CodeLocation } from "./types.ts";

export const TEXTUAL_CAVEAT =
	"这是文本搜索的结果，不是语言服务器的。它看不到别名导入（`import { a as b }` 之后调用点写的是 `b`）" +
	"和重导出链，所以可能有遗漏；改导出符号之前请再确认一次。";

/**
 * Occurrences of `name` as a whole word, skipping comment-only lines.
 *
 * Comment lines are dropped because a mention in a comment is not a callsite, and a rename driven
 * by this list would edit prose. String contents are kept: a name inside a string is often a
 * dynamic reference and is exactly the kind of thing a compiler-aware rename misses too, so it is
 * worth showing to a person.
 */
export async function textualReferences(files: string[], name: string, cwd: string): Promise<CodeLocation[]> {
	const pattern = new RegExp(`\\b${escapeRegex(name)}\\b`);
	const found: CodeLocation[] = [];

	for (const file of files) {
		const content = await readFile(file, "utf8").catch(() => null);
		if (content === null) continue;
		const lines = content.split("\n");
		for (let i = 0; i < lines.length; i += 1) {
			const line = lines[i];
			const trimmed = line.trimStart();
			if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
			const match = pattern.exec(line);
			if (!match) continue;
			found.push({
				path: relative(cwd, file) || file,
				line: i + 1,
				column: match.index + 1,
				text: line.trim().slice(0, 200),
			});
		}
	}
	return found;
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
