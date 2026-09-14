/**
 * 「运行期间不让电脑休眠」那个开关，会不会攒出一串谁也停不掉的声明。
 *
 * 这是这个功能里唯一会出错的地方，而且它坏掉的样子很难查：`applySettings` 的监听器在**每一次**
 * 设置保存时都会跑——改主题、换模型、开别的开关，全都会走到它。每次都发一个新声明的话，
 * `powerSaveBlocker` 的效果是叠加的，于是把开关关掉之后电脑仍然不睡，而界面上没有任何东西
 * 解释得了为什么。要到下次重启才「好」。
 *
 * 所以这里的假 blocker 记的是**每一次调用**，不只是当下的状态：只断言「现在拦着」是看不出攒了
 * 五个还是一个的。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createKeepAwake, type SleepBlocker } from "../electron/keep-awake.ts";

/** 一个记账的假 blocker：发了几个、停了几个、现在还剩几个活的。 */
function fake(): SleepBlocker & { started: number[]; stopped: number[]; live(): number[] } {
	let next = 1;
	const started: number[] = [];
	const stopped: number[] = [];
	return {
		started,
		stopped,
		live: () => started.filter((id) => !stopped.includes(id)),
		start() {
			const id = next++;
			started.push(id);
			return id;
		},
		stop(id) {
			stopped.push(id);
		},
		isStarted: (id) => started.includes(id) && !stopped.includes(id),
	};
}

test("开一次就是一个声明，反复开不会再发", () => {
	const blocker = fake();
	const keeper = createKeepAwake(blocker);

	keeper.set(true);
	assert.equal(keeper.keeping(), true);
	assert.equal(blocker.started.length, 1);

	// 设置页每存一次都会走到这里，哪怕改的是别的东西。
	for (let i = 0; i < 5; i++) keeper.set(true);
	assert.equal(blocker.started.length, 1, `反复开发出了 ${blocker.started.length} 个声明，它们会叠加`);
	assert.deepEqual(blocker.live().length, 1);
});

test("关掉就真的放开，而且只放一次", () => {
	const blocker = fake();
	const keeper = createKeepAwake(blocker);

	keeper.set(true);
	keeper.set(false);
	assert.equal(keeper.keeping(), false);
	assert.equal(blocker.live().length, 0, "关掉之后还有活着的声明，电脑就一直不会睡");

	// 没持有的时候再关，不该去 stop 一个不存在的 id。
	const before = blocker.stopped.length;
	for (let i = 0; i < 3; i++) keeper.set(false);
	assert.equal(blocker.stopped.length, before, "对已经停掉的声明又 stop 了一次");
});

test("反复开关，任何时刻活着的声明都不超过一个", () => {
	const blocker = fake();
	const keeper = createKeepAwake(blocker);

	for (let i = 0; i < 12; i++) {
		keeper.set(i % 2 === 0);
		assert.ok(blocker.live().length <= 1, `第 ${i} 次之后活着 ${blocker.live().length} 个声明`);
	}
	keeper.set(false);
	assert.equal(blocker.live().length, 0);
});

test("系统自己收走了声明，下一次开会重新发一个", () => {
	/*
	 * `powerSaveBlocker` 的声明不保证一直在——系统睡过一轮、或者别的什么原因把它收走了，`isStarted`
	 * 就变成 false。这时候 `keeping()` 得如实说「没拦着」，而不是因为自己手里还攥着一个 id 就报真。
	 *
	 * 只信自己那半边的话，开关在界面上是开的、实际上没在拦，而且永远不会自愈：因为 `set(true)` 看
	 * 自己的状态是「已经开着了」，直接返回。
	 */
	const blocker = fake();
	const keeper = createKeepAwake(blocker);

	keeper.set(true);
	const id = blocker.started[0]!;
	blocker.stop(id); // 系统收走了，不是这个模块干的

	assert.equal(keeper.keeping(), false, "声明已经没了，却还报自己拦着");
	keeper.set(true);
	assert.equal(blocker.live().length, 1, "没有重新发一个，开关就一直是个摆设");
});
