/**
 * 真实会话的成本体检：钱花在哪、哪条闸门在真的起作用、回合都是怎么结束的。
 *
 * 为什么要有这个文件：关于「浪费 token」「死循环」「突然停止」的改动，之前有两次是照着直觉做
 * 的，两次都误伤了真实工作——一条「连着 60 轮不说话就停」上线八小时掐断了一次正常发版，一条
 * 「花到多少钱就提醒」纯属噪音。两次的共同点是**没有先量**。
 *
 * 所以任何针对循环、截断、停止条件的改动，前后都要跑一遍这个脚本，拿两份输出对照：
 *
 *   - 省下的量对得上预期吗（第 1、2 节）
 *   - 有没有哪条闸门从「从不触发」变成「频繁触发」，或者反过来（第 4 节）
 *   - 回合结束的原因分布变了吗（第 5 节）
 *
 * 读的是 `~/.lyra/sessions` 下的真实会话，所以数字会随着你自己的使用而变。**要对照就必须是同
 * 一台机器、同一批会话的前后两次**，不同机器之间的绝对值没有可比性。
 *
 * 第 4 节直接 import 生产用的 `RepetitionWatch` 并在真实调用序列上重放，而不是照着它的逻辑另
 * 写一份：另写的那份只能证明「我以为它是这样」。
 *
 * 配套的执行清单在 `docs/architecture/agent-cost-and-stopping.md`，那里记着每个数字对应哪一条待办。
 *
 * 用法：
 *   pnpm audit:sessions
 *   pnpm audit:sessions --json > /tmp/before.json
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { RepetitionWatch, REPEAT_WARN, REPEAT_STOP } from "../packages/core/src/agent/repetition.ts";
import { pruneToolResults, PRUNE_THRESHOLD_CHARS } from "../packages/core/src/runtime/prune.ts";
import type { Message } from "../packages/core/src/types.ts";

/** 字符数换算 token 的粗系数。绝对值不重要，前后两次用同一个就行。 */
const CHARS_PER_TOKEN = 3.5;
/** 进入「单条最贵」榜的门槛，低于这个的条目太多且都不值得看。 */
const BIG_RESULT_CHARS = 2000;

const ROOT = join(homedir(), ".lyra", "sessions");
const asJson = process.argv.includes("--json");

interface Call {
	id: string;
	name: string;
	args: unknown;
	/** 第几个助手回合发出的，用来算这条结果之后还要被重发多少轮。 */
	round: number;
}

/** 一个助手回合：谁答的、发了几个调用、花了多少。 */
interface Turn {
	model: string;
	toolCalls: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

interface UserPrompt {
	text: string;
	synthetic: boolean;
}

interface Session {
	id: string;
	rounds: number;
	calls: Call[];
	results: Map<string, Message>;
	/** 每个助手回合的 stopReason，最后一个决定这次会话是怎么收尾的。 */
	stops: string[];
	turns: Turn[];
	userPrompts: UserPrompt[];
	finalTodos?: { content: string; status: string }[];
	fileEdits: Map<string, number>;
}

function loadSessions(): Session[] {
	const out: Session[] = [];
	let dirs: string[];
	try {
		dirs = readdirSync(ROOT);
	} catch {
		console.error(`读不到 ${ROOT} —— 这台机器上还没有会话记录。`);
		process.exit(1);
	}
	for (const dir of dirs) {
		const path = join(ROOT, dir);
		if (!statSync(path).isDirectory()) continue;
		for (const file of readdirSync(path)) {
			if (!file.endsWith(".jsonl")) continue;
			let lines: string[];
			try {
				lines = readFileSync(join(path, file), "utf8").split("\n").filter(Boolean);
			} catch {
				continue;
			}
			const calls: Call[] = [];
			const results = new Map<string, Message>();
			const stops: string[] = [];
			const turns: Turn[] = [];
			const userPrompts: UserPrompt[] = [];
			let finalTodos: { content: string; status: string }[] | undefined;
			const fileEdits = new Map<string, number>();
			let round = 0;
			for (const line of lines) {
				let entry: { type?: string; message?: Record<string, unknown> };
				try {
					entry = JSON.parse(line);
				} catch {
					continue;
				}
				if (entry.type !== "message") continue;
				const message = entry.message;
				if (message?.role === "user") {
					const text = ((message.content ?? []) as { type?: string; text?: string }[])
						.map((p) => (p.type === "text" && p.text ? p.text : ""))
						.join("");
					userPrompts.push({ text, synthetic: message.synthetic === true });
				} else if (message?.role === "assistant") {
					round++;
					stops.push(String(message.stopReason ?? "(none)"));
					const content = (message.content ?? []) as { type: string; id: string; name: string; arguments: unknown }[];
					let inRound = 0;
					for (const block of content) {
						if (block.type === "toolCall") {
							calls.push({ id: block.id, name: block.name, args: block.arguments, round });
							inRound++;
							if (block.name === "todo_write" && block.arguments && typeof block.arguments === "object") {
								const argsObj = block.arguments as { todos?: { content: string; status: string }[] };
								if (Array.isArray(argsObj.todos)) finalTodos = argsObj.todos;
							}
							if (block.name === "edit" || block.name === "write") {
								const argsObj = block.arguments as { path?: string; filePath?: string } | undefined;
								const filePath = argsObj?.path || argsObj?.filePath;
								if (filePath && typeof filePath === "string") {
									fileEdits.set(filePath, (fileEdits.get(filePath) ?? 0) + 1);
								}
							}
						}
					}
					const u = (message.usage ?? {}) as Record<string, number | { total?: number }>;
					turns.push({
						model: String(message.model ?? "(unknown)"),
						toolCalls: inRound,
						input: Number(u.input ?? 0),
						output: Number(u.output ?? 0),
						cacheRead: Number(u.cacheRead ?? 0),
						cacheWrite: Number(u.cacheWrite ?? 0),
						cost: Number((u.cost as { total?: number } | undefined)?.total ?? 0),
					});
				} else if (message?.role === "toolResult" && typeof message.toolCallId === "string") {
					results.set(message.toolCallId, message as unknown as Message);
				}
			}
			if (round > 0)
				out.push({
					id: file.slice(0, 8),
					rounds: round,
					calls,
					results,
					stops,
					turns,
					userPrompts,
					finalTodos,
					fileEdits,
				});
		}
	}
	return out;
}

/** 一条工具结果的正文长度——模型真正要为之付钱的部分。 */
function charsOf(result: Message | undefined): number {
	if (!result || result.role !== "toolResult") return 0;
	let total = 0;
	for (const part of result.content) if (part.type === "text") total += part.text.length;
	return total;
}

const tk = (chars: number) => Math.round(chars / CHARS_PER_TOKEN);
const pad = (value: string | number, width: number) => String(value).padStart(width);
const share = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");

const sessions = loadSessions();

// ---------------------------------------------------------------------------
// 1&2. 每个工具的一次性体积，以及它真正的代价：体积 × 之后还要被重发的轮数
// ---------------------------------------------------------------------------

interface ToolCost {
	n: number;
	chars: number;
	/** 字符·轮。一条结果留在上下文里，之后每一轮都要重新发一遍。 */
	carried: number;
}
const byTool = new Map<string, ToolCost>();
const biggest: { session: string; tool: string; chars: number; after: number; carried: number; args: string }[] = [];
let allChars = 0;
let allCarried = 0;

for (const session of sessions) {
	for (const call of session.calls) {
		const chars = charsOf(session.results.get(call.id));
		const after = session.rounds - call.round;
		const carried = chars * after;
		const entry = byTool.get(call.name) ?? { n: 0, chars: 0, carried: 0 };
		entry.n++;
		entry.chars += chars;
		entry.carried += carried;
		byTool.set(call.name, entry);
		allChars += chars;
		allCarried += carried;
		if (chars >= BIG_RESULT_CHARS)
			biggest.push({
				session: session.id,
				tool: call.name,
				chars,
				after,
				carried,
				args: JSON.stringify(call.args ?? {}).slice(0, 60),
			});
	}
}

// ---------------------------------------------------------------------------
// 3. read 的重复：改过再读是正常的，一字不差地再读一遍不是
// ---------------------------------------------------------------------------

let readCalls = 0;
let readChars = 0;
let rereadCalls = 0;
let rereadChars = 0;
let identicalCalls = 0;
let identicalChars = 0;

for (const session of sessions) {
	const seenPath = new Set<string>();
	const seenExact = new Set<string>();
	for (const call of session.calls) {
		if (call.name !== "read") continue;
		const path = (call.args as { path?: unknown } | undefined)?.path;
		if (typeof path !== "string") continue;
		const chars = charsOf(session.results.get(call.id));
		readCalls++;
		readChars += chars;
		if (seenPath.has(path)) {
			rereadCalls++;
			rereadChars += chars;
		}
		seenPath.add(path);
		const exact = JSON.stringify(call.args);
		if (seenExact.has(exact)) {
			identicalCalls++;
			identicalChars += chars;
		}
		seenExact.add(exact);
	}
}

// ---------------------------------------------------------------------------
// 4. 重复检测这条闸门实际拦下了什么——用生产代码重放，不是照着它重写一份
// ---------------------------------------------------------------------------

let exactWarns = 0;
let intentWarns = 0;
let corrected = 0;
let correctedChars = 0;
let wouldStop = 0;
let worstEver = 0;

for (const session of sessions) {
	// 按助手回合重新分组：一个回合里的调用是一起交给 `observe` 的
	const rounds = new Map<number, Call[]>();
	for (const call of session.calls) {
		const group = rounds.get(call.round) ?? [];
		group.push(call);
		rounds.set(call.round, group);
	}
	const watch = new RepetitionWatch();
	let stoppedHere = false;
	for (const [, group] of [...rounds.entries()].sort(([a], [b]) => a - b)) {
		const results = group.map((call) => session.results.get(call.id)).filter(Boolean) as Message[];
		const round = watch.observe(
			group.map((call) => ({ name: call.name, arguments: call.args })),
			results,
		);
		if (round.warn) {
			if (round.kind === "exact") exactWarns++;
			else intentWarns++;
		}
		if (round.worst > worstEver) worstEver = round.worst;
		for (const [index, seen] of round.repeats.entries()) {
			if (seen < REPEAT_WARN) continue;
			corrected++;
			correctedChars += charsOf(session.results.get(group[index].id));
		}
		if (!stoppedHere && watch.exhausted()) {
			stoppedHere = true;
			wouldStop++;
		}
	}
}

// ---------------------------------------------------------------------------
// 5. 如果超大结果在产生 N 轮之后就被裁掉，能省多少（清单 A1 的收益预估）
//
// 裁剪后的大小是**真的裁一遍量出来的**：`pruneToolResults` 是生产代码，头尾各留多少由它说了
// 算。照着 `PRUNE_HEAD_CHARS + PRUNE_TAIL_CHARS` 自己加一遍，只能证明「我以为它留这么多」，
// 而那两个常量并没有导出，正说明它们是实现细节。
// ---------------------------------------------------------------------------

/** 把一条工具结果单独交给生产的裁剪函数，看它会被裁到多大。 */
function prunedCharsOf(result: Message | undefined): number {
	if (!result || result.role !== "toolResult") return 0;
	const [pruned] = pruneToolResults([result]);
	return charsOf(pruned);
}

const DELAYS = [0, 5, 12, 20, 40, 80];
/** 按裁剪延迟 N 轮算出来的总携带成本（字符·轮）。 */
const curve = new Map<number, number>(DELAYS.map((n) => [n, 0]));
let bigCount = 0;
let bigCarried = 0;
let allCount = 0;

for (const session of sessions) {
	for (const call of session.calls) {
		const result = session.results.get(call.id);
		const chars = charsOf(result);
		const after = session.rounds - call.round;
		allCount++;
		// 没到裁剪线的结果，在任何 N 下成本都一样，直接计入每一档
		if (chars <= PRUNE_THRESHOLD_CHARS) {
			for (const n of DELAYS) curve.set(n, curve.get(n)! + chars * after);
			continue;
		}
		bigCount++;
		bigCarried += chars * after;
		const small = prunedCharsOf(result);
		for (const n of DELAYS) {
			const atFullSize = Math.min(n, after);
			curve.set(n, curve.get(n)! + chars * atFullSize + small * Math.max(0, after - n));
		}
	}
}

// ---------------------------------------------------------------------------
// 6. 回合是怎么结束的
// ---------------------------------------------------------------------------

const stopKinds = new Map<string, number>();
const endedWith = new Map<string, number>();
for (const session of sessions) {
	for (const stop of session.stops) stopKinds.set(stop, (stopKinds.get(stop) ?? 0) + 1);
	const last = session.stops[session.stops.length - 1];
	if (last) endedWith.set(last, (endedWith.get(last) ?? 0) + 1);
}

// ---------------------------------------------------------------------------
// 7. 并行度：一个回合发几个调用，按模型分
//
// 这是「慢」的直接原因，和「贵」是两件事。一个回合只发一个调用，123 次调用就要 123 个回合，
// 每个回合都要等模型想一遍——工具本身可能只花了一分半，人却等了十五分钟。
// 按模型分组是因为实测差距到了两个数量级，同一套代码换个模型就完全不同。
// ---------------------------------------------------------------------------

interface Par {
	turns: number;
	calls: number;
	/** 一个回合里发了两个及以上调用的回合数。 */
	parallel: number;
}
const byModel = new Map<string, Par>();
let parTurns = 0;
let parCalls = 0;
let parMulti = 0;

for (const session of sessions) {
	for (const turn of session.turns) {
		if (turn.toolCalls === 0) continue;
		const e = byModel.get(turn.model) ?? { turns: 0, calls: 0, parallel: 0 };
		e.turns++;
		e.calls += turn.toolCalls;
		if (turn.toolCalls > 1) e.parallel++;
		byModel.set(turn.model, e);
		parTurns++;
		parCalls += turn.toolCalls;
		if (turn.toolCalls > 1) parMulti++;
	}
}

/** 被规则挡回去的调用：模型要用 shell 干工具的活，这一个回合白费了。 */
let blockedTurns = 0;
for (const session of sessions) {
	for (const result of session.results.values()) {
		if (result.role !== "toolResult") continue;
		const text = result.content.map((p) => (p.type === "text" ? p.text : "")).join("");
		if (/^用 `(grep|read|ls|glob)`/.test(text.trim())) blockedTurns++;
	}
}

// ---------------------------------------------------------------------------
// 8. 缓存与真实花销（A1 的验收要看这里：cacheWrite 占比不能因为改动而上升）
// ---------------------------------------------------------------------------

let cacheRead = 0;
let cacheWrite = 0;
let rawInput = 0;
let output = 0;
let cost = 0;
for (const session of sessions)
	for (const turn of session.turns) {
		cacheRead += turn.cacheRead;
		cacheWrite += turn.cacheWrite;
		rawInput += turn.input;
		output += turn.output;
		cost += turn.cost;
	}
const billed = rawInput + cacheRead + cacheWrite;

// ---------------------------------------------------------------------------
// 9. 任务完成质量与用户体验（守卫第一原则：省 token 不能伤及完成质量）
// ---------------------------------------------------------------------------

const FRUSTRATION_REGEX = /(上一轮|刚才|不对|怎么又|别再|不是让|做错了|还原|重来|为什么不|卡住|死循环|没按要求|报错了|恢复原样)/;
let totalUserPrompts = 0;
let frustrationPrompts = 0;

let frustMaxEdits: number[] = [];
let smoothMaxEdits: number[] = [];

for (const session of sessions) {
	let isFrustSession = false;
	for (const u of session.userPrompts) {
		if (u.synthetic) continue;
		totalUserPrompts++;
		if (FRUSTRATION_REGEX.test(u.text)) {
			frustrationPrompts++;
			isFrustSession = true;
		}
	}
	if (session.fileEdits.size > 0) {
		const maxCount = Math.max(...session.fileEdits.values());
		if (isFrustSession) frustMaxEdits.push(maxCount);
		else smoothMaxEdits.push(maxCount);
	}
}

const avgMaxEdits = (arr: number[]) => (arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : 0);
const frustAvgEdits = avgMaxEdits(frustMaxEdits);
const smoothAvgEdits = avgMaxEdits(smoothMaxEdits);

// ---------------------------------------------------------------------------
// 报告
// ---------------------------------------------------------------------------

const tools = [...byTool.entries()].sort((a, b) => b[1].carried - a[1].carried);

if (asJson) {
	console.log(
		JSON.stringify(
			{
				sessions: sessions.length,
				rounds: sessions.reduce((n, s) => n + s.rounds, 0),
				totalTokens: tk(allChars),
				totalCarried: tk(allCarried),
				tools: Object.fromEntries(
					tools.map(([name, v]) => [name, { calls: v.n, tokens: tk(v.chars), carried: tk(v.carried) }]),
				),
				read: {
					calls: readCalls,
					tokens: tk(readChars),
					reread: rereadCalls,
					reredTokens: tk(rereadChars),
					identical: identicalCalls,
					identicalTokens: tk(identicalChars),
				},
				repetition: { exactWarns, intentWarns, corrected, savedTokens: tk(correctedChars), wouldStop, worstEver },
				pruneGain: Object.fromEntries(
					DELAYS.map((n) => [`delay${n}`, { carried: tk(curve.get(n)!), savedShare: share(allCarried - curve.get(n)!, allCarried) }]),
				),
				stops: Object.fromEntries(stopKinds),
				endedWith: Object.fromEntries(endedWith),
				parallelism: {
					callsPerTurn: +(parCalls / parTurns).toFixed(3),
					parallelShare: share(parMulti, parTurns),
					blockedTurns,
					byModel: Object.fromEntries(
						[...byModel.entries()].map(([name, v]) => [
							name,
							{ turns: v.turns, calls: v.calls, perTurn: +(v.calls / v.turns).toFixed(3), parallelShare: share(v.parallel, v.turns) },
						]),
					),
				},
				spend: { rawInput, cacheRead, cacheWrite, output, cost: +cost.toFixed(2), cacheReadShare: share(cacheRead, billed), cacheWriteShare: share(cacheWrite, billed) },
				quality: {
					totalUserPrompts,
					frustrationPrompts,
					frustrationRate: share(frustrationPrompts, totalUserPrompts),
					frustAvgMaxEdits: frustAvgEdits,
					smoothAvgMaxEdits: smoothAvgEdits,
				},
			},
			null,
			2,
		),
	);
	process.exit(0);
}

console.log(`会话 ${sessions.length} 个，助手回合 ${sessions.reduce((n, s) => n + s.rounds, 0)} 次\n`);

console.log("── 1. 工具结果的一次性体积，与它的携带成本 ──");
console.log(`合计 ${tk(allChars).toLocaleString()} token，携带 ${(tk(allCarried) / 1e6).toFixed(0)}M token·轮\n`);
console.log("工具            次数     token    平均   携带(token·轮)   占比");
for (const [name, v] of tools.slice(0, 12))
	console.log(
		`${name.padEnd(14)} ${pad(v.n, 5)}  ${pad(tk(v.chars).toLocaleString(), 9)}  ${pad(tk(v.chars / v.n), 6)}  ` +
			`${pad(`${(tk(v.carried) / 1e6).toFixed(1)}M`, 13)}  ${pad(share(v.carried, allCarried), 6)}`,
	);

console.log("\n── 2. 单条最贵：体积 × 之后还要重发多少轮 ──");
for (const item of biggest.sort((a, b) => b.carried - a.carried).slice(0, 10))
	console.log(
		`  ${item.session} ${item.tool.padEnd(7)} ${pad(tk(item.chars).toLocaleString(), 8)} token × 之后${pad(item.after, 4)}轮 ` +
			`= ${pad(`${(tk(item.carried) / 1e6).toFixed(0)}M`, 5)}  ${item.args}`,
	);

console.log("\n── 3. read 的重复 ──");
console.log(`  ${readCalls} 次 / ${tk(readChars).toLocaleString()} token`);
console.log(
	`  这个 path 之前读过：${rereadCalls} 次 (${share(rereadCalls, readCalls)})，` +
		`${tk(rereadChars).toLocaleString()} token —— 改过再读是正常的`,
);
console.log(
	`  参数一字不差：      ${identicalCalls} 次 (${share(identicalCalls, readCalls)})，` +
		`${tk(identicalChars).toLocaleString()} token —— 这些是纯重复`,
);

console.log("\n── 4. 重复检测这条闸门 ──");
console.log(`  警告：exact(≥${REPEAT_WARN}) ${exactWarns} 次，intent ${intentWarns} 次`);
console.log(
	`  改写成「第 N 次」的调用：${corrected} 次，省下 ${tk(correctedChars).toLocaleString()} token (${share(correctedChars, allChars)})`,
);
console.log(`  会被 exhausted()(≥${REPEAT_STOP}) 停掉的会话：${wouldStop} 个；实际见过的最高重复次数 ${worstEver}`);
if (worstEver < REPEAT_STOP)
	console.log(`  ⚠ 最高才 ${worstEver} 次，够不到 ${REPEAT_STOP} —— 这条停止线在这批数据上是死的`);

console.log("\n── 5. 提前裁剪超大结果能省多少（清单 A1） ──");
console.log(
	`  超过 ${PRUNE_THRESHOLD_CHARS} 字符的结果：${bigCount}/${allCount} 条 (${share(bigCount, allCount)})，` +
		`却占携带成本的 ${share(bigCarried, allCarried)}`,
);
for (const n of DELAYS)
	console.log(
		`  产生 ${pad(n, 2)} 轮后就裁：剩 ${pad(`${(tk(curve.get(n)!) / 1e6).toFixed(0)}M`, 5)} token·轮，` +
			`省 ${share(allCarried - curve.get(n)!, allCarried)}`,
	);

console.log("\n── 6. 回合怎么结束的 ──");
console.log(`  全部助手回合：${[...stopKinds].map(([k, v]) => `${k} ${v}`).join("，")}`);
console.log(`  会话的最后一个：${[...endedWith].map(([k, v]) => `${k} ${v}`).join("，")}`);
console.log("  ⚠ toolUse 收尾的会话是「要了工具却没有下文」，既可能是人按了停，也可能是循环断了 —— 落盘的 stopReason 区分不了。");

console.log("\n── 7. 并行度：一个回合发几个调用（这是「慢」，不是「贵」） ──");
console.log(`  总体 ${(parCalls / parTurns).toFixed(2)} 个/轮，并行率 ${share(parMulti, parTurns)}`);
console.log("  模型                        有工具的轮次    调用    每轮    并行率");
for (const [name, v] of [...byModel.entries()].sort((a, b) => b[1].turns - a[1].turns).slice(0, 8))
	console.log(
		`  ${name.slice(0, 26).padEnd(26)} ${pad(v.turns, 9)} ${pad(v.calls, 8)}  ${pad((v.calls / v.turns).toFixed(2), 6)}  ${pad(share(v.parallel, v.turns), 7)}`,
	);
console.log(`  若把总体提到 5 个/轮：${parCalls} 次调用只需 ${Math.ceil(parCalls / 5)} 轮（现在 ${parTurns} 轮）`);
console.log(`  被规则挡回、白费一整轮的调用：${blockedTurns} 次`);

console.log("\n── 8. 缓存与花销（A1 验收看这里） ──");
console.log(`  计费 token：未命中 ${rawInput.toLocaleString()}｜cacheRead ${cacheRead.toLocaleString()}｜cacheWrite ${cacheWrite.toLocaleString()}｜输出 ${output.toLocaleString()}`);
console.log(`  cacheRead 占输入侧 ${share(cacheRead, billed)}，cacheWrite 占 ${share(cacheWrite, billed)}`);
console.log(`  记录在案的花销合计 $${cost.toFixed(2)}`);
if (cacheWrite === 0)
	console.log("  ⚠ cacheWrite 恒为 0：openai-chat-completions/responses 两条链路都不上报它，所以**它不能用作验收指标**。");
console.log(`  ⚠ 看 cacheRead 占比（现在 ${share(cacheRead, billed)}）：改动后它明显下降 = 前缀缓存被反复打断，`);
console.log("    八成是把裁剪写成了「每轮都改历史」。这是 A1 唯一可靠的缓存守卫。");
console.log(`  ⚠ 携带成本（第 1 节）里有 ${share(cacheRead, billed)} 是缓存命中的，单价约为未命中的十分之一。`);
console.log("    所以省下的 token 量 ≠ 省下的钱，A1 的收益要按这个比例打折，以本节的 $ 为准。");

console.log("\n── 9. 完成质量与用户体验（第一原则守卫） ──");
console.log(`  用户发言：真实输入 ${totalUserPrompts} 条，含挫败信号 ${frustrationPrompts} 条 (${share(frustrationPrompts, totalUserPrompts)})`);
console.log(`  单文件最大修改均值：顺利组 ${smoothAvgEdits} 次 vs 挫败组 ${frustAvgEdits} 次（纯事后连续观测，严禁在运行时注入打断）`);
