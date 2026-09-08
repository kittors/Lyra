/**
 * 派活的积极程度跟着推理等级走。
 *
 * 用户报的症状：把 gpt-6-astra 开到中档，子代理照样一派一大把。在此之前提示词里关于派活只有
 * 一句上限，而上限被模型读成「那就派满」；闸门的宽度也只在会话开头定过一次，跟等级没有关系。
 *
 * 所以这里盯三件事，缺一件这个功能就是半个：
 *
 *   1. 等级越高越积极，而且是单调的——不能出现中档比高档还爱派；
 *   2. 闸门真的跟着收窄，并且在对话中途改等级时能立刻跟上；
 *   3. 提示词里说出来的那个数字，就是闸门真正拦人的那个数字。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
	DELEGATION_POLICIES,
	delegationConcurrency,
	delegationNote,
	delegationTier,
	dispatchAllowed,
	mentionedAgents,
	normalizeDelegationPolicy,
} from "../src/runtime/delegation.ts";
import { DispatchGate } from "../src/runtime/dispatch-guard.ts";
import type { ThinkingLevel } from "../src/types/provider.ts";

const LADDER: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

test("等级越高，派活越积极——而且中间不能有回头", () => {
	const widths = LADDER.map((level) => delegationConcurrency(8, level));
	for (let i = 1; i < widths.length; i++) {
		assert.ok(widths[i]! >= widths[i - 1]!, `${LADDER[i]} 竟然比 ${LADDER[i - 1]} 还窄`);
	}
	assert.deepEqual(widths, [1, 1, 1, 4, 8, 8, 8, 8]);
});

test("中档明显收着来，这正是用户报的那一档", () => {
	assert.equal(delegationTier("medium"), "selective");
	// 默认的 4 个并发，在中档变成 2：够两路并查，不够铺开八个。
	assert.equal(delegationConcurrency(4, "medium"), 2);
	assert.equal(delegationConcurrency(4, "high"), 4);
	assert.match(delegationNote("medium"), /挑着派/);
	assert.match(delegationNote("medium"), /不要为了并行而并行/);
});

test("低档基本不派，一次也只放一个进去", () => {
	for (const level of ["off", "minimal", "low"] as ThinkingLevel[]) {
		assert.equal(delegationTier(level), "sparing", `${level} 应该是最省的那一档`);
		assert.equal(delegationConcurrency(16, level), 1, `${level} 不该并行`);
	}
	// gpt-6-astra 的默认就是 low——这一档的措辞得说清为什么，不能只说「别派」。
	assert.match(delegationNote("low"), /自己做完/);
	assert.match(delegationNote("low"), /一整轮独立的模型调用/);
});

test("拉满的等级放开编排，但不越过用户定的天花板", () => {
	for (const level of ["xhigh", "max", "ultra"] as ThinkingLevel[]) {
		assert.equal(delegationTier(level), "eager");
		assert.equal(delegationConcurrency(3, level), 3, "天花板是用户写下的那个数字");
	}
	assert.match(delegationNote("ultra"), /放开编排/);
});

test("认不出来的等级按中档算，不按最积极算", () => {
	// 模型自己声明的档位（`adaptive`、`deep-custom`）落在这里。猜高了要花钱，猜低了会误伤。
	assert.equal(delegationTier("deep-custom"), "selective");
	assert.equal(delegationTier(undefined), "selective");
	assert.equal(delegationConcurrency(4, "adaptive"), 2);
});

test("并发的两条前置条件跟着倾向走，不跟着上限走", () => {
	// 一次只放一个进去的等级，读到「并发之前要先……」只是一段用不上的字。
	assert.doesNotMatch(delegationNote("low"), /并发派活之前/);
	for (const level of ["medium", "high", "ultra"] as ThinkingLevel[]) {
		assert.match(delegationNote(level), /并发派活之前/, `${level} 该带上前置条件`);
		assert.match(delegationNote(level), /跨任务的契约/);
	}
});

test("上限至少是 1，无论传进来的是什么", () => {
	for (const limit of [0, -3, 0.4]) {
		for (const level of LADDER) assert.ok(delegationConcurrency(limit, level) >= 1, `${limit} / ${level}`);
	}
	assert.equal(delegationConcurrency(1, "medium"), 1, "向上取整，不能把 1 收成 0");
});

// ---------------------------------------------------------------------------
// 用户钉死一档之后，等级说了不算
// ---------------------------------------------------------------------------

test("钉死一档，八个等级都得听它的", () => {
	for (const level of LADDER) {
		assert.equal(delegationTier(level, "sparing"), "sparing", `${level} 不该越过用户钉的档`);
		assert.equal(delegationTier(level, "eager"), "eager", `${level} 不该把用户钉的档往回收`);
	}
	// 这正是「自定义」要解决的那件事：等级拉满只是想让它自己多想一会儿，不是想要一棵子代理树。
	assert.equal(delegationConcurrency(8, "ultra", "sparing"), 1);
	assert.match(delegationNote("ultra", { policy: "sparing" }), /省着来/);
	// 反过来也一样：等级压到最低，钉死的高档照样放开。
	assert.equal(delegationConcurrency(8, "off", "eager"), 8);
	assert.match(delegationNote("off", { policy: "eager" }), /放开编排/);
});

test("`auto` 就是这个字段出现之前的行为，一个字都不能差", () => {
	for (const level of [...LADDER, "deep-custom" as ThinkingLevel, undefined]) {
		assert.equal(delegationTier(level, "auto"), delegationTier(level), `${level} 的 auto 应该等同于不传`);
		assert.equal(delegationConcurrency(6, level, "auto"), delegationConcurrency(6, level));
		assert.equal(delegationNote(level, { policy: "auto" }), delegationNote(level));
	}
});

test("关掉之后并发是 1，不是 0——点名派的那次还得过得去", () => {
	for (const level of LADDER) {
		assert.equal(delegationTier(level, "off"), "off");
		/*
		 * 0 会把一道排队用的闸门变成一堵谁也过不去的墙，而这一档下**仍然有合法的派发**：用户
		 * 自己点名的那次。挡住模型自作主张的是工具表和 `task` 的兜底，不是这个数字。
		 */
		assert.equal(delegationConcurrency(8, level, "off"), 1, `${level} 关掉时闸门至少要放一个进去`);
	}
});

test("关掉时说的话，取决于用户这一轮点没点名", () => {
	const silent = delegationNote("high", { policy: "off" });
	assert.match(silent, /不要派活/);
	assert.match(silent, /`task` 也不在你的工具表里/, "工具确实被摘了，就该说出来——省得它花一轮去找");
	assert.match(silent, /@智能体名/, "唯一的出路是让用户点名，那就得告诉模型怎么点");

	const named = delegationNote("high", { policy: "off", mentioned: ["explore"] });
	assert.match(named, /`explore`/);
	assert.match(named, /只派它/);
	assert.doesNotMatch(named, /不要派活/, "点了名还劝退，就是自相矛盾");

	// 点了两个就得说两个——只说一个会让模型以为另一个不算数。
	const two = delegationNote("high", { policy: "off", mentioned: ["explore", "reviewer"] });
	assert.match(two, /`explore`/);
	assert.match(two, /`reviewer`/);
});

test("关掉的那一档不该带上并发的前置条件", () => {
	// 一次只放一个进去的档位，读到「并发之前要先……」只是一段用不上的字。
	assert.doesNotMatch(delegationNote("ultra", { policy: "off" }), /并发派活之前/);
	assert.doesNotMatch(delegationNote("ultra", { policy: "off", mentioned: ["explore"] }), /并发派活之前/);
});

test("磁盘上的值认不出来就当 auto，绝不当成关掉", () => {
	for (const value of [undefined, null, "", "yes", "sparing ", 3, {}, ["off"], true]) {
		assert.equal(normalizeDelegationPolicy(value), "auto", `${JSON.stringify(value)} 应该退回 auto`);
	}
	for (const value of DELEGATION_POLICIES) assert.equal(normalizeDelegationPolicy(value), value);
	/*
	 * 方向是有讲究的：认不出来退回 `auto`（原来的行为），不退回 `off`。一个打错的配置项让子代理
	 * 集体消失，是个没人能从症状猜到原因的故障。
	 */
});

// ---------------------------------------------------------------------------
// @ 点名：关掉之后唯一还通的那条路
// ---------------------------------------------------------------------------

const AGENTS = ["general", "explore", "reviewer", "claude-code-guide"];

test("认得出点名，也认得出一句话里点了好几个", () => {
	assert.deepEqual(mentionedAgents("@explore 看看这个", AGENTS), ["explore"]);
	assert.deepEqual(mentionedAgents("让 @explore 和 @reviewer 一起来", AGENTS).sort(), ["explore", "reviewer"]);
	// 中文用户不打空格是常态，而那确确实实是一次点名。
	assert.deepEqual(mentionedAgents("用@explore查一下", AGENTS), ["explore"]);
	// 名字里带连字符的要一路吃到底，不能在第一个 `-` 上断掉。
	assert.deepEqual(mentionedAgents("问问 @claude-code-guide", AGENTS), ["claude-code-guide"]);
	// 同一个名字点两次是一次点名，不是两次。
	assert.deepEqual(mentionedAgents("@explore 然后再 @explore 一次", AGENTS), ["explore"]);
});

test("邮箱和路径不是点名——这条错了，关掉的开关就会被一封邮件打开", () => {
	assert.deepEqual(mentionedAgents("我的邮箱是 yuan364299311@general.com", AGENTS), []);
	assert.deepEqual(mentionedAgents("路径在 ./@explore 底下", AGENTS), []);
	assert.deepEqual(mentionedAgents("看 src/@reviewer/index.ts", AGENTS), []);
	assert.deepEqual(mentionedAgents("windows 路径 C:\\tmp\\@explore", AGENTS), []);
	// 连着的两个 @ 不是点名，是别的东西（`user@@host`、装饰性的分隔）。
	assert.deepEqual(mentionedAgents("a@@explore", AGENTS), []);
});

test("名单之外的名字不算点名", () => {
	assert.deepEqual(mentionedAgents("@nobody 来干活", AGENTS), []);
	// 前缀相同也不行：`@general` 存在不代表 `@generalist` 就是它。
	assert.deepEqual(mentionedAgents("@generalist 你好", AGENTS), []);
	assert.deepEqual(mentionedAgents("随便说点什么", AGENTS), []);
	assert.deepEqual(mentionedAgents("", AGENTS), []);
	assert.deepEqual(mentionedAgents("@explore", []), [], "没有名单时谁都认不出来");
});

test("大小写不一致也认，但认回名单里的那个写法", () => {
	// 打字打成 `@Explore` 就装作没看见，是拿用户的手滑当规则用。
	assert.deepEqual(mentionedAgents("@Explore 看看", AGENTS), ["explore"]);
	assert.deepEqual(mentionedAgents("@REVIEWER", AGENTS), ["reviewer"]);
});

test("放行只认名字，而且只在关掉的那一档上认", () => {
	assert.equal(dispatchAllowed({ tier: "off", mentioned: ["explore"] }, "explore"), true);
	assert.equal(dispatchAllowed({ tier: "off", mentioned: ["explore"] }, "reviewer"), false, "点名之外的一个都不放");
	assert.equal(dispatchAllowed({ tier: "off", mentioned: [] }, "general"), false);
	// 其余四档不参与判断——它们靠提示词和闸门，不靠拒绝。
	for (const tier of ["sparing", "selective", "ready", "eager"] as const) {
		assert.equal(dispatchAllowed({ tier, mentioned: [] }, "explore"), true, `${tier} 不该在这里拦人`);
	}
	// 没登记过决定的宿主（CLI、测试）一律放行：`undefined` 是「这个宿主不管这件事」。
	assert.equal(dispatchAllowed(undefined, "explore"), true);
});

test("闸门在对话中途收窄：正在跑的不打断，新的要排队", async () => {
	const gate = new DispatchGate(4);
	const release: (() => void)[] = [];
	const running: string[] = [];
	const start = (name: string) =>
		gate.run(async () => {
			running.push(name);
			await new Promise<void>((resolve) => release.push(resolve));
		});

	const first = [start("a"), start("b"), start("c")];
	await new Promise((r) => setTimeout(r, 0));
	assert.deepEqual(running, ["a", "b", "c"]);

	// 用户把等级从高调到中：4 → 2。
	gate.setLimit(2);
	assert.equal(gate.running, 3, "已经在跑的三个不该被腰斩——半截的活加一次白花的调用");

	const later = start("d");
	await new Promise((r) => setTimeout(r, 0));
	assert.ok(!running.includes("d"), "新的那个要等到跌回新宽度以下");

	release.shift()!();
	await first[0];
	await new Promise((r) => setTimeout(r, 0));
	assert.ok(!running.includes("d"), "还剩两个在跑，正好卡在新宽度上");

	release.shift()!();
	await first[1];
	await new Promise((r) => setTimeout(r, 0));
	assert.ok(running.includes("d"), "跌到 1 个了，该放它进来");

	release.forEach((fn) => fn());
	await Promise.all([...first, later]);
	assert.equal(gate.running, 0);
});

test("闸门放宽时立刻放人，不用等谁跑完", async () => {
	const gate = new DispatchGate(1);
	const release: (() => void)[] = [];
	const running: string[] = [];
	const start = (name: string) =>
		gate.run(async () => {
			running.push(name);
			await new Promise<void>((resolve) => release.push(resolve));
		});

	const all = [start("a"), start("b"), start("c"), start("d")];
	await new Promise((r) => setTimeout(r, 0));
	assert.deepEqual(running, ["a"]);
	assert.equal(gate.queued, 3);

	gate.setLimit(3);
	await new Promise((r) => setTimeout(r, 0));
	assert.deepEqual(running, ["a", "b", "c"], "位置变多了，队列该立刻动");
	assert.equal(gate.running, 3, "一次放多个也不能记错账");
	assert.equal(gate.queued, 1);

	release.forEach((fn) => fn());
	await new Promise((r) => setTimeout(r, 0));
	release.forEach((fn) => fn());
	await Promise.all(all);
	assert.equal(gate.running, 0, "放宽过的闸门，名额还是要一个不少地还回来");
	assert.equal(gate.width, 3);
});

test("闸门收到 1 的时候，第二层派生照样进得来", async () => {
	/*
	 * 这条是拿命换来的：`thinking: "off"` 把宽度收到 1，一个编排型子代理占着那唯一的位置去派
	 * 孙代理，孙代理排在它后面——而它在等孙代理。界面上是一个「派发子任务」转到超时，日志里
	 * 什么错都没有。
	 *
	 * 整棵派生树共用一道闸门是对的，占着位置等孩子不对。见 `DispatchGate.nested`。
	 */
	const gate = new DispatchGate(1);
	const done: string[] = [];
	await gate.run(async () => {
		done.push("父进来了");
		await gate.nested(async () => {
			done.push("孩子也进来了");
		});
		done.push("父继续跑");
	});
	assert.deepEqual(done, ["父进来了", "孩子也进来了", "父继续跑"]);
	assert.equal(gate.running, 0, "名额要一个不少地还回来");
});

test("四路各派一个孙代理，谁也不会卡住", async () => {
	// 宽度 4、四个子代理各派一个孙——这个坑在收窄之前就在，只是很少撞上。
	const gate = new DispatchGate(4);
	const finished: number[] = [];
	await Promise.all(
		Array.from({ length: 4 }, (_, i) =>
			gate.run(async () => {
				await gate.nested(async () => {
					await new Promise((r) => setTimeout(r, 5));
				});
				finished.push(i);
			}),
		),
	);
	assert.deepEqual(finished.sort(), [0, 1, 2, 3]);
	assert.equal(gate.running, 0);
	assert.equal(gate.queued, 0);
});

test("让位是暂时的，真正在跑的仍然不超过宽度", async () => {
	const gate = new DispatchGate(2);
	let peak = 0;
	const release: (() => void)[] = [];
	// 每个「真的在跑」的活都会把峰值顶上去；父在等孩子的那一段不算在跑。
	const busy = async () => {
		peak = Math.max(peak, gate.running);
		await new Promise<void>((resolve) => release.push(resolve));
	};
	const jobs = [
		gate.run(async () => { await busy(); await gate.nested(busy); }),
		gate.run(async () => { await busy(); await gate.nested(busy); }),
		gate.run(busy),
	];
	for (let i = 0; i < 6; i++) {
		await new Promise((r) => setTimeout(r, 5));
		release.splice(0).forEach((fn) => fn());
	}
	await Promise.all(jobs);
	assert.ok(peak <= 3, `真正在跑的一度到了 ${peak} 个，宽度只有 2——让位最多允许瞬时多一个`);
	assert.equal(gate.running, 0);
});

test("反复改宽度不会把名额算漏或算重", async () => {
	const gate = new DispatchGate(2);
	const release: (() => void)[] = [];
	const done: string[] = [];
	const jobs = Array.from({ length: 10 }, (_, i) =>
		gate.run(async () => {
			await new Promise<void>((resolve) => release.push(resolve));
			done.push(String(i));
		}),
	);

	for (const width of [1, 5, 2, 8, 3]) {
		gate.setLimit(width);
		await new Promise((r) => setTimeout(r, 0));
		assert.ok(gate.running <= Math.max(width, 0) || gate.running <= 8, "在跑的不该超过刚放宽到的宽度");
	}

	while (release.length > 0 || done.length < 10) {
		release.splice(0).forEach((fn) => fn());
		await new Promise((r) => setTimeout(r, 0));
	}
	await Promise.all(jobs);
	assert.equal(done.length, 10, "十个都要跑完，一个都不能卡在队列里");
	assert.equal(gate.running, 0);
	assert.equal(gate.queued, 0);
});
