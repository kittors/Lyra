/* oxlint-disable no-console -- probe CLI that prints what a session load actually costs */
/**
 * 打开一个大会话，钱花在哪一步。
 *
 * 「疯狂点会话，卡死」的现场是 254 个会话、最大的一个 25.2 MB、991 条消息。`readSelectedSession`
 * 里已经有合并闸了——同时只有一趟 IPC 在飞，中间点的那些折叠成最后一个——所以卡的不是排队，
 * 是单趟本身就太贵。贵在哪一步没量过，只能是猜：磁盘、`JSON.parse`、跨进程那次结构化克隆、
 * 还是拿到之后那几个各扫一遍的派生函数。
 *
 * 这里不开窗口（用户正开着 Lyra 在用），只在 Node 里把同一批数据按同样的顺序过一遍，量每一段。
 * 跨进程那次没法在这里真做，用 `structuredClone` 顶替——它和 IPC 用的是同一套序列化。
 *
 * 用法：node --import tsx e2e/session-load-cost.ts [会话文件路径]
 */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { intact } from "../src/lib/transcript.ts";
import { howItStopped, rebuildToolRuns, todosFrom } from "../src/store/derive.ts";

/** 最大的那几个会话文件，从大到小。 */
function biggest(n: number): string[] {
	const root = join(homedir(), ".lyra", "sessions");
	const out = execFileSync("sh", ["-c", `find ${JSON.stringify(root)} -name '*.jsonl' -type f -exec du -k {} + | sort -rn | head -${n} | cut -f2-`], { encoding: "utf8" });
	return out.trim().split("\n").filter(Boolean);
}

function ms(label: string, run: () => unknown): number {
	const t0 = performance.now();
	const value = run();
	const dt = performance.now() - t0;
	const size = Array.isArray(value) ? `  (${value.length} 条)` : "";
	console.log(`   ${dt.toFixed(0).padStart(6)} ms  ${label}${size}`);
	return dt;
}

/** 主进程读一个会话：按行 JSON.parse，取出 message 那些。 */
function parseTranscript(text: string): unknown[] {
	const messages: unknown[] = [];
	for (const line of text.split("\n")) {
		if (!line) continue;
		const record = JSON.parse(line) as { message?: unknown };
		if (record.message) messages.push(record.message);
	}
	return messages;
}

const files = process.argv[2] ? [process.argv[2]] : biggest(3);

for (const file of files) {
	const bytes = readFileSync(file).byteLength;
	console.log(`\n【${file.split("/").slice(-2).join("/")}】 ${(bytes / 1024 / 1024).toFixed(1)} MB`);

	let text = "";
	let messages: unknown[] = [];
	let cloned: unknown[] = [];

	const total =
		ms("读盘", () => { text = readFileSync(file, "utf8"); return null; }) +
		ms("逐行 JSON.parse（主进程）", () => { messages = parseTranscript(text); return messages; }) +
		ms("结构化克隆（相当于过一次 IPC）", () => { cloned = structuredClone(messages) as unknown[]; return cloned; }) +
		// 下面这些是拿到转录之后，渲染进程主线程上一个接一个跑的。
		ms("intact（进门那道闸）", () => intact(cloned as never)) +
		ms("rebuildToolRuns", () => rebuildToolRuns(cloned as never)) +
		ms("todosFrom", () => todosFrom(cloned as never)) +
		ms("howItStopped", () => howItStopped(cloned as never));

	console.log(`   ${"─".repeat(40)}`);
	console.log(`   ${total.toFixed(0).padStart(6)} ms  合计（不含 React 渲染）`);
}
