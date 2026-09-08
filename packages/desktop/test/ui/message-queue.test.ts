/**
 * 排队：进来、换位置、走掉，以及走掉之后发给了谁。
 *
 * 队列本身是一段纯粹的状态，可以直接摆弄；真正容易错的是它和会话之间那几处交接——发给的是不是排队
 * 时的那个对话、这一轮是怎么结束的、发失败之后那一条还在不在。这些都在这里量。
 */

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { UserContent } from "@lyra/core";
import type { SessionMeta } from "@lyra/core";
import { useApp } from "../../src/store/index.ts";
import { applySessionChange } from "../../src/store/session-changes.ts";
import type { QueuedMessage } from "../../src/store/queue-slice.ts";

const usage = { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 } };
const meta = (id: string): SessionMeta => ({ id, title: id, cwd: "/test", projectId: "test", projectName: "test", createdAt: 1, updatedAt: 2, modelId: "", messageCount: 1, seq: 2, usage });

/** 送出去的那些，按顺序记下来：谁、说了什么、怎么送的。 */
let prompted: { sessionId: string; text: string; deliver?: string }[];
let refuse: (() => boolean) | null;

function entry(text: string, extra: Partial<QueuedMessage> = {}): Omit<QueuedMessage, "id" | "queuedAt"> {
	const content: UserContent[] = [{ type: "text", text }];
	return { content, draft: { text, attachments: [], sessionRefs: [] }, preview: text, ...extra };
}

beforeEach(() => {
	prompted = [];
	refuse = null;
	useApp.setState({
		queued: {}, activeSessionId: "a", meta: meta("a"), messages: [], sessions: [meta("a")], sessionCache: {},
		running: false, activity: {}, turns: {}, carried: {}, notices: [], pendingUserMessage: null, drafts: {}, workspace: null, scratchCwd: "/test",
	});
	Object.defineProperty(window, "lyra", { configurable: true, value: {
		agent: {
			prompt: async (sessionId: string, content: UserContent[], options?: { deliver?: string }) => {
				if (refuse?.()) throw new Error("offline");
				const text = content.map((block) => (block.type === "text" ? block.text : "[图]")).join("");
				prompted.push({ sessionId, text, ...(options?.deliver ? { deliver: options.deliver } : {}) });
				return meta(sessionId);
			},
		},
		// 一轮结束会去重读会话列表（见 `apply-event.ts` 的 agent_end），少了它这里会在事件里炸掉。
		sessions: { capabilities: async () => null, list: async () => [meta("a")] },
	} });
});

test("排进来的按先后站队，位置能改", () => {
	const { enqueue, moveQueued } = useApp.getState();
	enqueue("a", entry("第一句"));
	const second = enqueue("a", entry("第二句"));
	const third = enqueue("a", entry("第三句"));
	assert.deepEqual(useApp.getState().queued.a?.map((item) => item.preview), ["第一句", "第二句", "第三句"]);

	// 往下拖：拿走它之后目标会上移一位，落点要按拿走之后的队伍算，否则会差一格。
	assert.equal(useApp.getState().moveQueued("a", second, third, "after"), true);
	assert.deepEqual(useApp.getState().queued.a?.map((item) => item.preview), ["第一句", "第三句", "第二句"]);

	// 往上拖。
	assert.equal(moveQueued("a", second, useApp.getState().queued.a![0]!.id, "before"), true);
	assert.deepEqual(useApp.getState().queued.a?.map((item) => item.preview), ["第二句", "第一句", "第三句"]);

	// 挪到自己那儿不算一次改动，否则拖起来放回原处会白记一笔。
	assert.equal(moveQueued("a", second, second, "before"), false);
	assert.equal(moveQueued("a", second, useApp.getState().queued.a![0]!.id, "before"), false);
});

test("拿走一条会把它交回来——删掉和编辑是同一个动作，区别在于之后拿它做什么", () => {
	const { enqueue, dropQueued } = useApp.getState();
	const id = enqueue("a", entry("要改的那一句"));
	enqueue("a", entry("留着的那一句"));
	const taken = dropQueued("a", id);
	assert.equal(taken?.draft.text, "要改的那一句", "退回来的是草稿本身，编辑要靠它回填输入框");
	assert.deepEqual(useApp.getState().queued.a?.map((item) => item.preview), ["留着的那一句"]);
	assert.equal(dropQueued("a", id), null, "同一条不能被拿走两次");
});

test("队伍空了就把这个会话的键去掉，不留一个空数组", () => {
	const { enqueue, dropQueued } = useApp.getState();
	const id = enqueue("a", entry("唯一的一句"));
	dropQueued("a", id);
	assert.deepEqual(useApp.getState().queued, {});
});

test("这一轮干净收尾，队首自己就发出去了", async () => {
	useApp.getState().enqueue("a", entry("排在前面的"));
	useApp.getState().enqueue("a", entry("排在后面的"));
	useApp.getState().applyEvent("a", { type: "agent_end", reason: "done" });
	// 出队推在微任务里——收尾要先写完，见 `apply-event.ts`。
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.deepEqual(prompted.map((one) => one.text), ["排在前面的"], "一次只放一条，剩下的等下一轮");
	assert.deepEqual(useApp.getState().queued.a?.map((item) => item.preview), ["排在后面的"]);
});

for (const reason of ["aborted", "error", "max_turns", "stalled"] as const) {
	test(`这一轮是「${reason}」结束的，队伍不动`, async () => {
		useApp.getState().enqueue("a", entry("不该被自动发出去的"));
		useApp.getState().applyEvent("a", { type: "agent_end", reason });
		await new Promise((resolve) => setTimeout(resolve, 0));
		assert.deepEqual(prompted, [], "按下停止之后接着把排队的灌进去，屏幕上刚说完「已停止」");
		assert.equal(useApp.getState().queued.a?.length, 1, "那一条要留在条上，发不发由人决定");
	});
}

test("还在跑就不出队，哪怕收到过一次收尾", async () => {
	useApp.getState().enqueue("a", entry("排着的"));
	useApp.setState({ activity: { a: "running" } });
	await useApp.getState().flushQueue("a");
	assert.deepEqual(prompted, []);
	assert.equal(useApp.getState().queued.a?.length, 1);
});

test("「现在就发」是插进这一轮，不打断它", async () => {
	const id = useApp.getState().enqueue("a", entry("插一句"));
	useApp.setState({ running: true, activity: { a: "running" } });
	await useApp.getState().steerQueued("a", id);
	assert.deepEqual(prompted, [{ sessionId: "a", text: "插一句", deliver: "steer" }]);
	assert.deepEqual(useApp.getState().queued, {});
});

test("发不出去的那一条回到原来的位置，不是队尾", async () => {
	const { enqueue } = useApp.getState();
	enqueue("a", entry("第一句"));
	enqueue("a", entry("第二句"));
	refuse = () => true;
	await useApp.getState().flushQueue("a");
	assert.deepEqual(useApp.getState().queued.a?.map((item) => item.preview), ["第一句", "第二句"], "站回原位，否则它会越过后面那句再发一次");
	assert.ok(useApp.getState().notices.some((notice) => notice.message.includes("发送失败")));
});

test("人已经切到别的对话，排队的仍旧发给它原来那个", async () => {
	useApp.getState().enqueue("a", entry("给 a 的"));
	// 切走：屏幕上换成了另一个对话。
	useApp.setState({ activeSessionId: "b", meta: meta("b"), messages: [], selectionEpoch: 1 });
	await useApp.getState().flushQueue("a");
	assert.deepEqual(prompted, [{ sessionId: "a", text: "给 a 的" }]);
	// 而屏幕上这个对话的转录不许被它写脏——那条消息不属于这里。
	assert.deepEqual(useApp.getState().messages, []);
	assert.equal(useApp.getState().running, false);
});

test("会话被删掉，排着的跟草稿一起走", () => {
	useApp.getState().enqueue("a", entry("说给一个已经不存在的对话"));
	useApp.getState().setDraft("a", { text: "还没发出去的字", attachments: [] });
	useApp.setState({ activeSessionId: null });
	applySessionChange({ id: "a", projectId: "test", meta: null }, useApp.setState, useApp.getState);
	assert.equal(useApp.getState().queued.a, undefined);
	assert.equal(useApp.getState().drafts.a, undefined);
});

/*
 * 忙的时候说的话，和那块表。
 *
 * 运行行上那个时长回答的是「我这件事等了多久」。从前每一次发送都重新点一块表，于是正跑着的时候补
 * 一句需求，屏幕上的数字就退回 0s——它改成回答「补这一句之后过了多久」，而那不是任何人问的问题。
 * 两条路都要堵：插进这一轮的那句用台上那块表，排着等下一轮的那条接 `agent_end` 替它冻下来的那份。
 * 见 `turn-meter.ts`。
 */

const MINUTE = 60_000;

/** 一轮已经跑了这么久，台上摆着表。 */
function running(elapsedMs: number, tokens: number): number {
	const startedAt = Date.now() - elapsedMs;
	useApp.setState({
		running: true, activity: { a: "running" },
		turns: { a: { startedAt, tokens } }, turnStartedAt: startedAt, turnTokens: tokens,
	});
	return startedAt;
}

test("正跑着的时候插一句，表接着走", async () => {
	const startedAt = running(10 * MINUTE, 31_400);
	await useApp.getState().send([{ type: "text", text: "再补一句" }], { deliver: "steer" });
	assert.equal(useApp.getState().turns.a?.startedAt, startedAt, "补一句需求不是另起一件事");
	assert.equal(useApp.getState().turnStartedAt, startedAt, "运行行读的是同一块表");
	assert.equal(useApp.getState().turnTokens, 31_400, "用量也接着数，否则每秒字数是一段没人跑过的速率");
});

test("排着的那条出队时，接上这一轮已经跑掉的时间", async () => {
	running(10 * MINUTE, 31_400);
	useApp.getState().enqueue("a", entry("忙的时候补的一句"));
	useApp.getState().applyEvent("a", { type: "agent_end", reason: "done" });
	await new Promise((resolve) => setTimeout(resolve, 0));

	assert.deepEqual(prompted.map((one) => one.text), ["忙的时候补的一句"]);
	const meter = useApp.getState().turns.a;
	assert.ok(meter, "出队的那次发送重新点起了表");
	// 起点被推回到十分钟前：读出来的是人从开口到现在等的总时长，不是这一段的长度。
	assert.ok(meter.startedAt <= Date.now() - 10 * MINUTE, `表应当从十分钟前起算，实际差 ${Date.now() - meter.startedAt}ms`);
	assert.equal(meter.tokens, 31_400, "这一轮花掉的也一起带过去");
	assert.equal(useApp.getState().carried.a, undefined, "接走之后那份账就不该再留着，否则会被记第二次");
});

test("没有人排队，一轮干净收尾就把表收走", () => {
	running(10 * MINUTE, 31_400);
	useApp.getState().applyEvent("a", { type: "agent_end", reason: "done" });
	assert.equal(useApp.getState().turns.a, undefined, "这一轮到了自己的终点");
	assert.equal(useApp.getState().carried.a, undefined, "没有下一句要接，就没有账要留");
	assert.equal(useApp.getState().turnStartedAt, null, "运行行也该收掉");
});

test("会话闲着的时候开口，才是新的一件事", async () => {
	useApp.setState({ activity: {}, turns: {}, carried: {}, running: false });
	const before = Date.now();
	await useApp.getState().send([{ type: "text", text: "新的一件事" }]);
	const meter = useApp.getState().turns.a;
	assert.ok(meter && meter.startedAt >= before, "闲着的时候说的话从零开始数");
	assert.equal(meter.tokens, 0);
});

test("表已经没人收走了，也不许被下一次发送继承", async () => {
	/*
	 * `turns` 里的表只有 `agent_end` 收得走，那一条要是没送到就会留在原地。光看「有没有表」会让
	 * 下一次发送继承一个几小时前的起点，报出一个没人跑过的时长——所以还要问 `activity`。
	 */
	useApp.setState({
		running: false, activity: { a: "done" },
		turns: { a: { startedAt: Date.now() - 3 * 60 * MINUTE, tokens: 999_999 } }, carried: {},
	});
	const before = Date.now();
	await useApp.getState().send([{ type: "text", text: "隔了三小时才说的下一件事" }]);
	const meter = useApp.getState().turns.a;
	assert.ok(meter && meter.startedAt >= before, "会话已经不在跑了，留下的表不作数");
	assert.equal(meter.tokens, 0);
});
