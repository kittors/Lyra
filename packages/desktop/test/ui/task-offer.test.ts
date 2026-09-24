import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement as h } from "react";
import { Mark } from "../../src/features/task/Mark.tsx";
import { TaskList } from "../../src/features/task/TaskList.tsx";
import { STEP_HOVER_MS, useDelayedOffer } from "../../src/features/task/hover-offer.ts";
import { SessionStatus } from "../../src/features/conversation/SessionStatus.tsx";
import { useApp } from "../../src/store/index.ts";
import { fire, mount } from "../helpers/mount.ts";

function OfferProbe() {
	const offer = useDelayedOffer(true);
	return h("div", { onMouseEnter: offer.enter, onMouseLeave: offer.leave, "data-offer": offer.show ? "on" : "off" }, "row");
}

test("a passing pointer does not offer the action, a one-second sit does", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const view = await mount(h(OfferProbe));
	try {
		// React binds enter/leave to mouseover/mouseout. `mouseenter` does not reach the handler.
		await fire(view.find("[data-offer]"), new MouseEvent("mouseover", { bubbles: true }));
		assert.equal(view.find("[data-offer]").getAttribute("data-offer"), "off");
		await act(async () => {
			t.mock.timers.tick(STEP_HOVER_MS - 1);
		});
		assert.equal(view.find("[data-offer]").getAttribute("data-offer"), "off");
		await act(async () => {
			t.mock.timers.tick(1);
		});
		assert.equal(view.find("[data-offer]").getAttribute("data-offer"), "on");
		await fire(view.find("[data-offer]"), new MouseEvent("mouseout", { bubbles: true }));
		assert.equal(view.find("[data-offer]").getAttribute("data-offer"), "off");
	} finally {
		t.mock.timers.reset();
		await view.unmount();
	}
});

test("an idle in-progress step is a still dot, not a spinner or pause bars", async () => {
	const view = await mount(h(Mark, { status: "in_progress", idle: true }));
	try {
		assert.equal(view.host.querySelector("svg"), null);
		assert.match(view.host.innerHTML, /bg-accent/);
		assert.doesNotMatch(view.host.innerHTML, /w-\[2px\]/);
	} finally {
		await view.unmount();
	}
});

/**
 * 停下来的那一步，折叠行不能再用 `activeForm` 说它。
 *
 * 卡片的其余部分早就不撒谎了——上面那条测的静止圆点就是同一次修复——只剩这句话还在说「正在强制
 * 推送到远程」，而那一轮已经结束了十几分钟。在这个具体场景里代价格外高：读到的人有充分理由相信
 * 自己的 Git 历史此刻正被覆盖上去。
 */
async function headlineOf(state: { running: boolean; stopped: "user" | null }) {
	const previous = useApp.getState();
	useApp.setState({
		activeSessionId: null,
		running: state.running,
		stopped: state.stopped,
		// 空转录就够了：这一行读的是「跑没跑」和「谁停的」，只有失败态才会去翻消息。
		messages: [],
		todos: [
			{ content: "本地验证重写结果与代码完整性", activeForm: "正在本地验证重写结果", status: "completed" },
			{ content: "强制推送到远程并修正本地 Git 配置", activeForm: "正在强制推送到远程并修正本地", status: "in_progress" },
		],
	});
	const view = await mount(h(TaskList, { placement: "inline" }));
	const text = view.find("button").textContent ?? "";
	await view.unmount();
	useApp.setState(previous, true);
	return text;
}

test("a turn that has ended stops describing its unfinished step in the present tense", async () => {
	const ended = await headlineOf({ running: false, stopped: null });
	assert.ok(!ended.includes("正在强制推送"), "轮次已经结束，没有谁在推——这句话从前就在这里撒谎");
	assert.ok(ended.includes("停在"), `折叠行该说它停在哪一步，实际是：${ended}`);
	assert.ok(ended.includes("强制推送到远程并修正本地 Git 配置"), "但仍要说清停在哪一步");

	// 真的在跑的时候，进行时是对的，不能一起改没了。
	const running = await headlineOf({ running: true, stopped: null });
	assert.ok(running.includes("正在强制推送到远程并修正本地"), `在跑就该用进行时，实际是：${running}`);

	// 人按下的暂停仍旧是暂停，不是「停在」。
	const paused = await headlineOf({ running: false, stopped: "user" });
	assert.ok(paused.includes("已暂停"), `实际是：${paused}`);
});

test("session status idle and done marks share a 7px disc", async () => {
	const idle = await mount(h(SessionStatus, { activity: null }));
	const done = await mount(h(SessionStatus, { activity: "done" }));
	try {
		assert.equal(idle.find("[data-ly-status-mark=idle]").className.includes("h-[7px]"), true);
		assert.equal(done.find("[data-ly-status-mark=done]").className.includes("h-[7px]"), true);
		assert.equal(idle.host.querySelector("[data-ly-status-mark=idle]")?.className.includes("h-[6px]"), false);
	} finally {
		await idle.unmount();
		await done.unmount();
	}
});
