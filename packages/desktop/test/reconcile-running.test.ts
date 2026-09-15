/**
 * 界面说「还在跑」而实际上早就跑完了，能不能自己回来。
 *
 * 症状是这样的：转录末尾已经有了收尾那一行（用时、速度），下面却还挂着「Thinking…」和一个转圈，
 * 输入框右边是停止按钮而不是发送。磁盘上那个会话最后一条是 `agent_end / done`——事情一小时前就
 * 做完了，只有界面不知道，而界面上没有任何入口能把它按回去，只能重开窗口。
 *
 * 根上的毛病不是某一条事件：`running` 是纯增量维持的——`agent_start` 把它立起来、`agent_end` 放
 * 下去——中间任何一次丢失、乱序或窗口重建都会让它永远停在立着的那一档。为什么会丢过一次可能永远
 * 查不清（e2e 里「切走、后台收尾、切回」那条时序试过，是干净的），但**丢了之后会怎样**是确定的、
 * 当场可验的。所以这里测的是那道对账，而不是某一条事件。
 *
 * 判据全在「它敢不敢动手」上：主进程说没跑才动，说还在跑、或者问不到、或者人已经切走了，都不许动
 * ——把一轮真在跑的按停，比多转一会儿圈严重得多。
 */

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

/** 主进程每次被问到时回答什么，以及被问了几次。 */
let answer: boolean | Promise<boolean> | (() => Promise<boolean>) = false;
const asked: string[] = [];

/*
 * 够 store 自己的那些模块导入用的一个窗口。
 *
 * 照 `session-thinking.test.ts` 的路数：导入这个 store 会牵出 dock，它在模块作用域上挂
 * `beforeunload`、读 localStorage。两样都不在测什么，但都得存在，否则 import 本身就抛。
 */
(globalThis as unknown as { window: unknown }).window = {
	addEventListener: () => {},
	removeEventListener: () => {},
	localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
	matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
	lyra: {
		sessions: {
			running: async (sessionId: string) => {
				asked.push(sessionId);
				return typeof answer === "function" ? answer() : answer;
			},
		},
	},
};

const { useApp } = await import("../src/store/index.ts");

function stand(over: Partial<{ running: boolean; activeSessionId: string | null }>): void {
	useApp.setState({ running: true, activeSessionId: "s-1", messages: [], retrying: null, ...over });
}

beforeEach(() => {
	asked.length = 0;
	answer = false;
});

describe("界面说在跑的时候", () => {
	it("主进程说没跑，就把它放下来", async () => {
		stand({});
		await useApp.getState().reconcileRunning();
		assert.equal(useApp.getState().running, false, "主进程都说收工了，界面还转着圈");
		assert.deepEqual(asked, ["s-1"]);
	});

	it("主进程说还在跑，一个字都不动", async () => {
		stand({});
		answer = true;
		await useApp.getState().reconcileRunning();
		assert.equal(useApp.getState().running, true, "把一轮真在跑的按停了——这比多转一会儿圈严重得多");
	});

	it("问不到就当没问过，不擅自下结论", async () => {
		// 连接断了、主进程正忙、方法不存在——任何一种都不是「它没在跑」的证据。
		stand({});
		answer = () => Promise.reject(new Error("IPC 断了"));
		await useApp.getState().reconcileRunning();
		assert.equal(useApp.getState().running, true);
	});
});

describe("界面说没在跑的时候", () => {
	it("连问都不问", async () => {
		/*
		 * 这一条决定了这道对账的代价。
		 *
		 * 它挂在窗口的 `focus` 上，而人一天里切回这个窗口几百次——每次都发一趟 IPC，为的是一个几乎
		 * 不发生的状态。卡住的那一档一定是「界面说在跑」，所以反过来那一档直接返回，正常情况下这道
		 * 对账连一次 IPC 都不发。
		 */
		stand({ running: false });
		await useApp.getState().reconcileRunning();
		assert.deepEqual(asked, [], "没在跑也去问了一趟，这道对账每次切窗口都要烧一次 IPC");
	});

	it("没有打开任何会话时也不问", async () => {
		stand({ activeSessionId: null });
		await useApp.getState().reconcileRunning();
		assert.deepEqual(asked, []);
	});
});

describe("问的这段时间里情况变了", () => {
	it("人已经切到别的会话，就不要再动这边的状态", async () => {
		/*
		 * IPC 是异步的，答案回来时人可能已经走了。拿着一个关于**上一个会话**的答案去改现在这个会话
		 * 的状态，是把两件事混成一件——而现在这个可能真的在跑。
		 */
		stand({});
		answer = async () => {
			useApp.setState({ activeSessionId: "s-2", running: true });
			return false;
		};
		await useApp.getState().reconcileRunning();
		assert.equal(useApp.getState().running, true, "拿着上一个会话的答案按停了现在这个");
	});

	it("这期间换了一轮，也不要按停", async () => {
		/*
		 * 上一轮结束、人又发了一条，新一轮同样是「在跑」——只看「现在还在跑吗」分不出这两种情况，
		 * 于是拿着关于上一轮的答案把新一轮按停了。`turnStartedAt` 每轮都换，它就是这一轮的身份。
		 * 第一版没有这一条，这个用例当场把它抓了出来。
		 */
		stand({});
		useApp.setState({ turnStartedAt: 1000 });
		answer = async () => {
			// 答案在路上时，这一轮收了工，人又发了一条。
			useApp.setState({ running: true, turnStartedAt: 2000 });
			return false;
		};
		await useApp.getState().reconcileRunning();
		assert.equal(useApp.getState().running, true);
	});
});
