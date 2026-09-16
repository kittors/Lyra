/**
 * 压缩之后，它还记不记得自己读过什么。
 *
 * 压缩把内容折叠掉了，而摘要是模型的转述——「我读过 X」这件事转述时最容易漏。漏掉的代价是量出来的：
 * 一个会话跨 9 个压缩段，`apply-event.ts` 在其中 **8 段里各被重读一次**；同一个会话里 `store.ts` 读了
 * 55 次。全局看，2,347 次 read 里有 1,987 次是在读同一个会话里已经碰过的文件。
 *
 * 所以这份清单是**机械收集**的，不指望模型写。分法参照 oh-my-pi 的压缩摘要：只读过的和改过的分开，
 * 因为改过的那些内容已经和它记忆里的不一样，重读是对的。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { filesSeen, summaryMessages } from "../src/runtime/compaction.ts";
import type { AssistantMessage, ModelConfig, ProviderConfig } from "../src/types.ts";
import { emptyUsage } from "../src/types.ts";

const MODEL: ModelConfig = { id: "m", providerId: "p", modelId: "m", name: "M", contextWindow: 100_000, maxOutputTokens: 4096, supportsThinking: false, supportsImages: false, supportsTools: true };
const PROVIDER: ProviderConfig = { id: "p", name: "P", baseUrl: "http://l", api: "openai-responses", apiKey: "x", enabled: true, models: [MODEL] };

function calls(...items: { name: string; path: string }[]): AssistantMessage {
	return {
		role: "assistant", api: "openai-responses", provider: "p", model: "m", usage: emptyUsage(),
		stopReason: "toolUse", timestamp: 1,
		content: items.map((it, i) => ({ type: "toolCall", id: `c${i}`, name: it.name, arguments: { path: it.path }, argumentsText: "{}" })),
	};
}

test("what was read and what was changed are two different lists", () => {
	const seen = filesSeen([
		calls({ name: "read", path: "a.ts" }, { name: "read", path: "b.ts" }),
		calls({ name: "edit", path: "c.ts" }),
		calls({ name: "write", path: "d.ts" }),
	]);

	assert.deepEqual(seen.read, ["a.ts", "b.ts"]);
	assert.deepEqual(seen.changed, ["c.ts", "d.ts"]);
});

test("a file both read and changed counts as changed", () => {
	/*
	 * 「它变了」比「你读过」要紧。
	 *
	 * 一个改过的文件，模型记忆里那份已经不对了——那时候重读是对的事，不该被劝阻。
	 */
	const seen = filesSeen([calls({ name: "read", path: "a.ts" }), calls({ name: "edit", path: "a.ts" })]);

	assert.deepEqual(seen.read, [], "不能再出现在「只读过」里");
	assert.deepEqual(seen.changed, ["a.ts"]);
});

test("the list is capped so it stays a list, not another wall of text", () => {
	// 再长就从「一眼能扫完的清单」变成「又一段要读的正文」——那是在省 token 的名义下花 token。
	const many = Array.from({ length: 50 }, (_, i) => calls({ name: "read", path: `f${i}.ts` }));
	const seen = filesSeen(many);

	assert.equal(seen.read.length, 20);
	assert.equal(seen.read[19], "f49.ts", "留最近的，不是最早的");
});

test("the summary head tells the model what it has already seen", () => {
	const head = summaryMessages("做了一些事", null, PROVIDER, MODEL, { read: ["a.ts"], changed: ["b.ts"] });
	const text = (head[0].content[0] as { text: string }).text;

	assert.match(text, /files-already-seen/);
	assert.match(text, /a\.ts/, "只读过的要列出来");
	assert.match(text, /b\.ts/, "改过的也要，但归在另一类");
	assert.match(text, /不是禁止你重读/, "语气要紧：改过的文件本来就该重读，别把它劝住");
	assert.match(text, /recall/, "要给出取回原文的办法");
});

test("no files, no section", () => {
	// 一段空的清单只是噪音，而且每一轮都要重发。
	const head = summaryMessages("做了一些事", null, PROVIDER, MODEL, { read: [], changed: [] });
	assert.ok(!/files-already-seen/.test((head[0].content[0] as { text: string }).text));

	const without = summaryMessages("做了一些事", null, PROVIDER, MODEL);
	assert.ok(!/files-already-seen/.test((without[0].content[0] as { text: string }).text), "不给这个参数时也不该出现");
});

test("both places that rebuild a compaction head pass the list", async () => {
	/*
	 * 接线守卫。
	 *
	 * 摘要头有两个组装点：压缩发生的那一刻，和之后每一次从日志重建历史。只接上一个的话，这份清单会在
	 * 会话重新打开后凭空消失——而那正是最需要它的时刻。参数是可选的，漏掉不会报错。
	 */
	const { readFile } = await import("node:fs/promises");
	for (const file of ["../src/runtime/compaction.ts", "../src/runtime/session-turn.ts"]) {
		const source = await readFile(new URL(file, import.meta.url), "utf8");
		// 按行找，不用正则啃括号——`lastRequest(older)` 那层嵌套会把 `[^)]*` 提前截断。
		const heads = source
			.split("\n")
			.filter((line) => line.includes("summaryMessages(") && !line.includes("export function"));
		assert.ok(heads.length > 0, `${file} 里应该有组装点`);
		for (const line of heads) {
			assert.match(line, /filesSeen\(/, `${file} 的这个组装点没带上已读清单：${line.trim()}`);
		}
	}
});
