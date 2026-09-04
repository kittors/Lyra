/**
 * Prompt blocks a project can replace with a file.
 *
 * `appendSystemPrompt` already existed and is not the same thing. Appending gives the model two
 * statements about who it is, and the second does not cancel the first — it produces a prompt that
 * argues with itself. Replacing is what somebody writing "you are our team's reviewer, not a
 * general assistant" means.
 *
 * 两块可以换，第三块不行：
 *
 *   `identity`   人最常想改的一块，而且换掉它是安全的。
 *   `guidelines` 十二条行为准则。一个团队想去掉「Be concise」或者加一条自己的，此前只能改代码。
 *   `boundaries` **不可覆盖**——工具输出是不可信通道、破坏性操作要先确认、没让你提交就别提交。
 *                这几条是我们的，一份项目文件不该能把它们删掉。
 *
 * `guidelines` 换掉的只是内置那份，**工具自己贡献的仍然照常追加**：`bash` 关于 shell 的那几句
 * 是这个工具的说明书，不是一条可以被别人的偏好删掉的意见。
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Blocks a project may replace. Deliberately not `boundaries`: those are ours to keep. */
export type OverridableBlock = "identity" | "guidelines";

/**
 * 把一份 markdown 读成一条条准则。
 *
 * 接受 `- 这样` 也接受裸行——写这份文件的人想的是「一条一行」，而要求他记住加不加短横线，
 * 是拿一个格式问题去换一次沉默的失效（少了短横线的那行会变成上一条的一部分）。
 */
export function parseGuidelines(raw: string): string[] {
	return raw
		.split("\n")
		.map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
		.filter((line) => line && !line.startsWith("#"));
}

/**
 * Read `<cwd>/.lyra/prompts/<block>.md`, or empty when there is none.
 *
 * Bounded, because this text goes into every request in the project and an accident — a log file
 * renamed, a paste gone wrong — should cost one truncated prompt rather than every turn's budget.
 */
export async function readPromptOverride(cwd: string, block: OverridableBlock): Promise<string> {
	const raw = await readFile(join(cwd, ".lyra", "prompts", `${block}.md`), "utf8").catch(() => null);
	return raw === null ? "" : raw.slice(0, 8000).trim();
}
