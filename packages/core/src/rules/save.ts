/**
 * Writing a rule to disk, wherever the person chose to put it.
 *
 * Two destinations and the difference matters: a project rule is committed and applies to whoever
 * clones the repository, a user rule follows the person across every project. "Don't use `any`"
 * is usually the first; "always explain your reasoning in Chinese" is usually the second, and
 * putting either in the other place is a small ongoing annoyance for somebody.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { lyraHome } from "../session/store.ts";

/**
 * Where a rule goes — deliberately not called `RuleScope`.
 *
 * `RuleScope` next door in `types.ts` already means something unrelated: which stream a rule
 * watches. Two types with the same name and different meanings in one directory is the kind of
 * trap that costs somebody an afternoon exactly once.
 */
export type RuleDestination = "project" | "user";

export function ruleDir(scope: RuleDestination, cwd: string): string {
	return scope === "project" ? join(cwd, ".lyra", "rules") : join(lyraHome(), "rules");
}

/**
 * Save, without overwriting a rule that is already there.
 *
 * A collision means somebody already wrote a rule with this name, and replacing it silently would
 * lose something they meant. Suffixing is the small rude option; failing would leave the person
 * with a suggestion they liked and no way to keep it.
 */
export async function saveRule(
	scope: RuleDestination,
	cwd: string,
	name: string,
	content: string,
): Promise<{ path: string; renamed?: string }> {
	const dir = ruleDir(scope, cwd);
	await mkdir(dir, { recursive: true });

	let candidate = name;
	for (let n = 2; n < 100; n += 1) {
		const path = join(dir, `${candidate}.md`);
		const existing = await readFile(path, "utf8").catch(() => null);
		if (existing === null) {
			await writeFile(path, content, "utf8");
			return { path, renamed: candidate === name ? undefined : candidate };
		}
		candidate = `${name}-${n}`;
	}
	throw new Error(`目录里已经有太多叫 ${name} 的规则了。`);
}
