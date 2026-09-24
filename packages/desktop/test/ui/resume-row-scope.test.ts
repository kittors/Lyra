/**
 * 分屏里每一屏的续跑行，讲的是这一屏的会话。
 *
 * 分屏时一个窗口挂着好几个转录，每个底下都有一个 `ResumeRow`。它从前读 store 里「台上那一份」，
 * 于是每一屏讲的都是焦点会话的收场：甲暂停、乙答完，焦点在甲时乙屏也说「已暂停」，焦点挪到乙，
 * 甲那行又没了。真窗口里还量到两处后果：鼠标按非焦点屏的「继续」，焦点先切、文案一变长按钮就从
 * 指针底下滑走，什么也没发出去；键盘按下去焦点不切，「继续」发给了焦点那个会话。
 *
 * 这里测按屏取数和动作指名这两件事。「按钮滑走」是画出来的后果，归真窗口探针。
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { act, createElement as h } from "react";
import type { AssistantMessage, Message, SessionMeta, UserContent } from "@lyra/core";
import { SessionScope } from "../../src/app/session-scope.tsx";
import { ResumeRow } from "../../src/features/conversation/ResumeRow.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useApp, type AppState } from "../../src/store/index.ts";
import type { Cache, TurnStop } from "../../src/store/derive.ts";
import { click, fire, mount, type Mounted } from "../helpers/mount.ts";

const USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

function meta(id: string): SessionMeta {
	return { id, title: id, projectId: "p", projectName: "p", cwd: "/test", createdAt: 1, updatedAt: 2, modelId: "", messageCount: 2, seq: 3, usage: USAGE };
}

/** 一个会话：一句问、一句答，答的收场决定这一行该说什么。 */
function session(id: string, stopped: TurnStop, stopReason: AssistantMessage["stopReason"]): Cache[string] {
	const messages: Message[] = [
		{ role: "user", content: [{ type: "text", text: `${id} 的问题` }], timestamp: 1 },
		{ role: "assistant", content: [{ type: "text", text: `${id} 的回答` }], api: "anthropic-messages", provider: "t", model: "t", usage: USAGE, stopReason, timestamp: 2 },
	];
	return {
		meta: meta(id),
		messages,
		toolRuns: {},
		state: { running: false, approvals: [], todos: [], compactions: [], commandRuns: [], hiccups: [], stopped, retrying: null, capabilities: null, pendingUserMessage: null },
	};
}

/** 甲暂停了，乙答完了，丙上次请求失败。 */
const ALL = { a: session("a", "user", "aborted"), b: session("b", null, "stop"), c: session("c", "error", "error") };

/** 让 `live` 上台，其余的停在缓存里——`openSession` 切走时留下的就是这个样子。 */
function stage(live: keyof typeof ALL): void {
	const on = ALL[live];
	useApp.setState({
		activeSessionId: live,
		pendingSessionId: null,
		meta: on.meta,
		messages: on.messages,
		running: false,
		stopped: on.state?.stopped ?? null,
		todos: [],
		hiccups: [],
		activity: {},
		sessions: Object.values(ALL).map((each) => each.meta),
		sessionCache: Object.fromEntries(Object.entries(ALL).filter(([id]) => id !== live)),
	});
}

/** 分屏的样子：每一屏一个 `SessionScope`，底下各挂一行。 */
function screens(ids: string[]): Promise<Mounted> {
	return mount(
		h(I18nProvider, {
			locale: "zh-CN",
			children: ids.map((id) => h(SessionScope.Provider, { key: id, value: id }, h("section", { "data-screen": id }, h(ResumeRow)))),
		}),
	);
}

/** 这一屏的续跑行说了什么；没画就是空串。按钮是图标，文字只有前面那句。 */
function said(view: Mounted, id: string): string {
	return (view.host.querySelector(`[data-screen="${id}"]`)?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function button(view: Mounted, id: string, selector: string): HTMLElement {
	const found = view.host.querySelector<HTMLElement>(`[data-screen="${id}"] ${selector}`);
	if (!found) throw new Error(`屏 ${id} 里没有 ${selector}：${view.host.innerHTML.slice(0, 400)}`);
	return found;
}

let previous: AppState;
let view: Mounted | undefined;

beforeEach(() => {
	previous = useApp.getState();
});

afterEach(async () => {
	await view?.unmount();
	view = undefined;
	// 整份换回去，换进来的替身动作也一起还掉——不留给下一条测试。
	useApp.setState(previous, true);
});

test("每一屏讲自己的收场，不跟着焦点走", async () => {
	stage("a");
	view = await screens(["a", "b", "c"]);
	assert.match(said(view, "a"), /已暂停/);
	assert.equal(said(view, "b"), "", "乙答完了，这一屏不该有续跑行——焦点在甲时它曾照着甲说「已暂停」");
	assert.match(said(view, "c"), /上次请求失败/, `丙这一屏说成了「${said(view, "c")}」`);

	await act(async () => stage("b"));
	assert.match(said(view, "a"), /已暂停/, "焦点挪到乙，甲的「已暂停」不该跟着消失");
	assert.equal(said(view, "b"), "");
	assert.match(said(view, "c"), /上次请求失败/);
});

test("非焦点那一屏的「继续」发给这一屏的会话", async () => {
	stage("a");
	const sent: (string | undefined)[] = [];
	useApp.setState({
		send: async (_content: UserContent[], options?: { sessionId?: string }) => {
			sent.push(options?.sessionId);
			return true;
		},
	});
	view = await screens(["a", "c"]);
	await click(button(view, "c", "[data-resume-continue]"));
	assert.deepEqual(sent, ["c"], "键盘按下去焦点不会先切过来，不指名就会发给焦点那个会话");
});

test("非焦点那一屏的「重试」重答的是这一屏的会话", async () => {
	stage("a");
	const retried: [number, string | undefined][] = [];
	useApp.setState({
		retryFrom: async (index: number, sessionId?: string) => {
			retried.push([index, sessionId]);
		},
	});
	view = await screens(["a", "c"]);
	await click(button(view, "c", 'button[aria-label="重试"]'));
	const confirm = [...document.body.querySelectorAll<HTMLElement>("[data-ly-modal] button")].find((each) => each.textContent?.trim() === "重新生成");
	assert.ok(confirm, "点了重试应当先问一句");
	await click(confirm);
	// 确认的回调挂在退场动画的 animationend 上，happy-dom 不播动画，得手动送这一帧。
	const card = document.body.querySelector("[data-ly-modal]");
	if (card) await fire(card, new Event("animationend", { bubbles: true }));
	assert.deepEqual(retried, [[1, "c"]]);
});

test("retryFrom 指名一个不在台上的会话：先请上台，再重答它自己的那一问", async () => {
	stage("a");
	const opened: string[] = [];
	const edits: { index: number; text: string; live: string | null }[] = [];
	useApp.setState({
		// 真的 `openSession` 要读盘；这里只做它对台上那几样的交代。
		openSession: async (target: SessionMeta) => {
			opened.push(target.id);
			const parked = useApp.getState().sessionCache[target.id];
			useApp.setState({ activeSessionId: target.id, meta: target, messages: parked?.messages ?? [], running: false });
		},
		editMessage: async (index: number, content: UserContent[]) => {
			const first = content[0];
			edits.push({ index, text: first?.type === "text" ? first.text : "", live: useApp.getState().activeSessionId });
		},
	});
	await useApp.getState().retryFrom(1, "c");
	assert.deepEqual(opened, ["c"]);
	assert.deepEqual(edits, [{ index: 0, text: "c 的问题", live: "c" }], "重答的该是丙自己的那一问，而且是在丙上台之后");
});

test("请上台的途中人又点开了别的对话：这次重试不再作数", async () => {
	stage("a");
	const edits: number[] = [];
	useApp.setState({
		openSession: async () => {
			// 读盘那一段里，更新的一次点击把乙开了出来。
			useApp.setState({ activeSessionId: "b", messages: ALL.b.messages });
		},
		editMessage: async (index: number) => {
			edits.push(index);
		},
	});
	await useApp.getState().retryFrom(1, "c");
	assert.deepEqual(edits, [], "不能把丙的重试落到乙头上，也不能落到原来的甲头上");
});

test("指名的就是台上那个：照旧直接重答，不去开会话", async () => {
	stage("a");
	const opened: string[] = [];
	const edits: { index: number; live: string | null }[] = [];
	useApp.setState({
		openSession: async (target: SessionMeta) => {
			opened.push(target.id);
		},
		editMessage: async (index: number) => {
			edits.push({ index, live: useApp.getState().activeSessionId });
		},
	});
	await useApp.getState().retryFrom(1, "a");
	await useApp.getState().retryFrom(1);
	assert.deepEqual(opened, []);
	assert.deepEqual(edits, [{ index: 0, live: "a" }, { index: 0, live: "a" }]);
});
