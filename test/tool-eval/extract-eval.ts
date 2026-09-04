/**
 * Does background extraction record the durable things and leave the perishable ones?
 *
 *   node --experimental-strip-types test/tool-eval/extract-eval.ts [model]
 *
 * The expensive failure is not an empty file. It is a file of facts that expire: "parseFrontmatter
 * is in skills/loader.ts" is true today, gets injected into every prompt in this project from now
 * on, and is quietly wrong after the next refactor — and believed.
 *
 * So the fixture deliberately mixes the two. Half of what these sessions contain is a convention
 * that will hold for months; the other half is where a function happened to live that week.
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { streamAssistant } from "../../packages/core/src/ai/index.ts";
import { loadSettings, resolveModel } from "../../packages/core/src/config/settings.ts";
import { extractMemory } from "../../packages/core/src/runtime/memory-extract.ts";
import type { AssistantMessage, Message } from "../../packages/core/src/types.ts";

const say = (line = "") => process.stderr.write(`${line}\n`);
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const OFF = "\x1b[0m";

function talk(lines: string[]): Message[] {
	return lines.map((text, i) =>
		i % 2 === 0
			? ({ role: "user", content: [{ type: "text", text }], timestamp: 0 } as Message)
			: ({ role: "assistant", content: [{ type: "text", text }], api: "x", provider: "p", model: "m", usage: {}, stopReason: "stop", timestamp: 0 } as AssistantMessage),
	);
}

const SESSIONS = [
	talk([
		"跑 e2e 老是报一堆类型错，看不懂。",
		"这是因为没有先跑 `pnpm build:contract`。契约包是生成的，e2e 依赖它的类型。",
		"果然，跑完就好了。这个能不能写进 README？",
		"可以。不过这个约定目前只在 CI 配置里体现，仓库文档里确实没写。",
	]),
	talk([
		"把 buildSystemPrompt 挪到 packages/core/src/prompt/system.ts 了。",
		"好的，我更新了三处导入。",
		"另外提醒一下，这个仓库的提交 scope 只能用 core、desktop、cli，别的 commitlint 会拒。",
		"明白了。",
	]),
	talk([
		"又忘了 build:contract，白等了五分钟。",
		"我记下了。以后跑 e2e 之前我会先确认契约包是新的。",
		"对了，别用 npm，这仓库只用 pnpm。",
		"好。",
	]),
];

/** Durable: should be recorded. Perishable: should not. */
const DURABLE = [
	{ label: "e2e 前要 build:contract", pattern: /build:contract/ },
	{ label: "提交 scope 限 core/desktop/cli", pattern: /scope|commitlint/ },
	{ label: "只用 pnpm", pattern: /pnpm/ },
];
const PERISHABLE = [{ label: "buildSystemPrompt 在哪个文件", pattern: /buildSystemPrompt|prompt\/system\.ts/ }];

async function main(): Promise<void> {
	const modelId = process.argv[2] ?? "relay/gemini-3.7-flash-high";
	const settings = await loadSettings();
	const resolved = resolveModel(settings, modelId);
	if (!resolved) throw new Error(`Model not found: ${modelId}`);

	const cwd = await mkdtemp(join(tmpdir(), "lyra-extract-"));
	const result = await extractMemory({
		cwd,
		candidates: SESSIONS.map((messages, i) => ({ id: `s${i}`, updatedAt: Date.now(), messages })),
		provider: resolved.provider,
		model: resolved.model,
		stream: streamAssistant,
	});

	say(`\n后台抽取 · ${modelId}\n`);
	if (result.skipped) {
		say(`  跳过了：${result.skipped}`);
		return;
	}

	say(`${DIM}抽出来的：${OFF}`);
	for (const line of result.memory.split("\n").filter((l) => l.trim())) say(`${DIM}  ${line}${OFF}`);
	say("");

	let ok = 0;
	for (const item of DURABLE) {
		const found = item.pattern.test(result.memory);
		if (found) ok += 1;
		say(`  ${"该记".padEnd(4)} ${item.label.padEnd(28)} ${found ? `${GREEN}记了 ✓${OFF}` : `${RED}漏了 ✗${OFF}`}`);
	}
	for (const item of PERISHABLE) {
		const found = item.pattern.test(result.memory);
		if (!found) ok += 1;
		say(`  ${"不该记".padEnd(3)} ${item.label.padEnd(28)} ${found ? `${RED}记了 ✗ 这条会过期${OFF}` : `${GREEN}没记 ✓${OFF}`}`);
	}
	say(`\n  ${ok}/${DURABLE.length + PERISHABLE.length} 正确\n`);
}

await main();
