/**
 * 悬停才出现的那两层，在有东西开着的时候该站到一边。
 *
 * tooltip 和侧边栏的会话信息卡都不是谁点出来的——指针停住了，它们就来。有东西开出来，它们就得
 * 让开：一张 248px 的卡画在菜单上面，盖住的正是那份菜单（卡 210，菜单 60）。
 *
 * 这件事从前是各写一份。tooltip 自己记一个由 `Popover` 拨的开关，外加每次 `pointerover` 都
 * 跑一遍 `.fixed.z-[60][role="menu"]` 的选择器——开关只认弹出层，选择器只认弹出层恰好带着的那
 * 串 class。信息卡则谁都没问过：右键一行、指针晃开再回来，420ms 后卡就又画在那份还开着的菜单上。
 *
 * 两种请求不是一回事，这里守的正是这个区别。菜单只盖住一小块，剩下的地方照样能悬停，所以它得
 * 「在我开着的这段时间里都别出来」；模态的 scrim 把整个窗口盖了，底下什么都激不出来，持续压着
 * 一分钱换不来，却会把对话框自己那些 tooltip 全弄哑——所以它只把此刻挂着的收掉。
 *
 * 另外守两件：菜单的账按个数记（菜单套菜单，各记各的），以及那两层相互之间的高低——指着某一个
 * 按钮的气泡压在讲整行的卡上面。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { act, createElement as h } from "react";

import type { SessionMeta } from "@lyra/core";
import {
	claimHoverSuppression,
	dismissHoverLayers,
	hoverLayersSuppressed,
	onHoverLayersDismissed,
} from "../../src/ui/overlay/hover-layers.ts";
import { Overlay } from "../../src/ui/overlay/Overlay.tsx";
import { Popover } from "../../src/ui/overlay/Popover.tsx";
import { SessionCard, useSessionCard } from "../../src/features/sidebar/SessionCard.tsx";
import { mount } from "../helpers/mount.ts";

const usage = { input: 1000, output: 200, total: 2000, cacheRead: 800, cacheWrite: 0, cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 } };
const meta: SessionMeta = {
	id: "s1", title: "1000字小说创作", cwd: "/tmp/CliProxy", projectId: "p", projectName: "CliProxy",
	createdAt: 1, updatedAt: 2, modelId: "", messageCount: 4, seq: 2, usage,
};

/** 一条会话行的矩形，够 `SessionCard` 摆位置用。 */
const anchor = {
	x: 10, y: 100, left: 10, top: 100, right: 262, bottom: 127, width: 252, height: 27,
	toJSON: () => ({}),
} as DOMRect;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** 比 `OPEN_DELAY_MS`（420）宽裕一点，够那趟等待跑完或者证明它没被排上。 */
const PAST_THE_DELAY_MS = 640;

test("hover-layers: 一个开着就算抑制，最后一个走了才解除", () => {
	assert.equal(hoverLayersSuppressed(), false, "起点必须是没人占着");

	const outer = claimHoverSuppression();
	assert.equal(hoverLayersSuppressed(), true);
	const inner = claimHoverSuppression();
	assert.equal(hoverLayersSuppressed(), true);

	// 子菜单关掉不能把父菜单的账一起销掉——布尔值就是在这儿出错的。
	inner();
	assert.equal(hoverLayersSuppressed(), true, "里层走了，外层还开着");
	outer();
	assert.equal(hoverLayersSuppressed(), false);
});

test("hover-layers: 同一个释放调两次不会把计数带到负数", () => {
	const release = claimHoverSuppression();
	release();
	release();
	assert.equal(hoverLayersSuppressed(), false);

	// 真被带到 -1 的话，下一次 claim 会从 -1 数到 0，于是抑制永远开不起来。
	const next = claimHoverSuppression();
	assert.equal(hoverLayersSuppressed(), true, "上一轮的重复释放不该欠下一轮的账");
	next();
});

test("hover-layers: 第一个占上来时通知一次收摊，套在里面的那个不再惊动人", () => {
	let told = 0;
	const stop = onHoverLayersDismissed(() => told++);

	const a = claimHoverSuppression();
	assert.equal(told, 1, "菜单一开就得把已经挂着的收掉");
	const b = claimHoverSuppression();
	assert.equal(told, 1, "屏幕上早就空了，子菜单不必再喊一遍");
	b();
	a();

	// 一次性的那条路：不占账，只清场。
	dismissHoverLayers();
	assert.equal(told, 2);
	assert.equal(hoverLayersSuppressed(), false, "清场不等于占着——对话框自己的 tooltip 还得能用");

	stop();
	dismissHoverLayers();
	assert.equal(told, 2, "退订之后不该再收到");
});

/*
 * 下面两条盯的是接线，不是逻辑。
 *
 * 上面那组用 `claimHoverSuppression` 直接拨开关，证明的是「开关一拨，卡就让开」；可真正会出
 * 错的是没人去拨它。菜单和对话框各自登记这一步，从前一处只对 tooltip 有效、另一处压根不存在。
 */
test("菜单挂上来就自己登记，卸掉就解除", async () => {
	assert.equal(hoverLayersSuppressed(), false);
	const trigger = document.createElement("button");
	document.body.append(trigger);

	const view = await mount(h(Popover, { anchor: trigger, onClose: () => {}, children: "置顶" }));
	assert.equal(hoverLayersSuppressed(), true, "菜单开着，悬停出来的东西都该站到一边");

	await view.unmount();
	assert.equal(hoverLayersSuppressed(), false, "菜单走了就该把话收回");
	trigger.remove();
});

test("对话框挂上来只清一次场，不会把自己的 tooltip 一起压掉", async () => {
	assert.equal(hoverLayersSuppressed(), false);
	let told = 0;
	const stop = onHoverLayersDismissed(() => told++);

	const view = await mount(h(Overlay, { onClose: () => {}, children: h("p", null, "移除这个项目？") }));
	assert.equal(told, 1, "键盘开出来的模态上面不该还挂着气泡或卡");
	/*
	 * 这一句是这条测试真正的理由。
	 *
	 * 把对话框接成「开着就一直压」看着更彻底，代价是模态自己的 tooltip 全哑了——`ReleaseModal`
	 * 光自己就有九处，`ProjectDialog` 三处。scrim 已经把底下盖住了，压着换不来任何东西。
	 */
	assert.equal(hoverLayersSuppressed(), false, "模态不该持续压着——它自己也要用 tooltip");

	await view.unmount();
	stop();
});

test("信息卡的层级低于 tooltip——它们会在归档图标上碰面", async () => {
	const view = await mount(h(SessionCard, { session: meta, anchor }));
	const card = document.querySelector<HTMLElement>("[data-ly-session-card]");
	assert.ok(card, "信息卡是 portal 到 body 的，要从 document 上找");
	const cardZ = Number(card.style.zIndex);
	assert.ok(Number.isFinite(cardZ) && cardZ > 0, `信息卡得有层级，读到的是 ${card.style.zIndex}`);

	/*
	 * tooltip 那个数字从源码文本里读，不 import。
	 *
	 * 它写在一个模块私有的常量里、由 `ensureHost` 写进 host 的行内样式；import 进来就变成
	 * 「两边都改了所以相等」，而这条要守的恰恰是有人只改一边的那次。
	 */
	const source = await readFile(new URL("../../src/ui/overlay/tooltip.ts", import.meta.url), "utf8");
	const declared = /const TIP_Z = (\d+);/.exec(source)?.[1];
	assert.ok(declared, "tooltip.ts 里找不到 TIP_Z——改了名字就来改这条测试");

	assert.ok(
		Number(declared) > cardZ,
		`指着某一个按钮的气泡要压在整行的信息卡上面：tooltip ${declared} vs 卡 ${cardZ}`,
	);

	await view.unmount();
});

/** 把 `useSessionCard` 的返回值捞出来，直接问它——绕开 React 合成 enter 的那套委托。 */
function probe(): { view: ReturnType<typeof mount>; read: () => ReturnType<typeof useSessionCard> } {
	let latest: ReturnType<typeof useSessionCard> | null = null;
	function Probe() {
		latest = useSessionCard();
		return h("div", { "data-probe": "" });
	}
	return {
		view: mount(h(Probe)),
		read: () => {
			assert.ok(latest, "探针组件还没渲染");
			return latest;
		},
	};
}

test("useSessionCard: 有菜单开着时，悬停连那趟 420ms 的等待都不排", async () => {
	const p = probe();
	const view = await p.view;
	const row = view.find("[data-probe]");

	const release = claimHoverSuppression();
	try {
		await act(async () => {
			p.read().bind.onMouseEnter({ currentTarget: row, buttons: 0 } as never);
		});
		await act(async () => {
			await sleep(PAST_THE_DELAY_MS);
		});
		assert.equal(p.read().anchor, null, "菜单还开着，卡不该出来");
	} finally {
		release();
	}
	await view.unmount();
});

test("useSessionCard: 卡已经开着，菜单或对话框一来就把它撤掉", async () => {
	const p = probe();
	const view = await p.view;
	const row = view.find("[data-probe]");

	await act(async () => {
		p.read().bind.onMouseEnter({ currentTarget: row, buttons: 0 } as never);
	});
	await act(async () => {
		await sleep(PAST_THE_DELAY_MS);
	});
	// 对照的另一半：没有菜单时它是真会开的，不然下一句断言什么都证明不了。
	assert.ok(p.read().anchor, "没有任何东西开着的时候，悬停应当把卡摆出来");

	let release = () => {};
	await act(async () => {
		release = claimHoverSuppression();
	});
	assert.equal(p.read().anchor, null, "菜单一开，已经在场的卡要立刻让开");
	release();

	// 模态走的是另一条路——只清场、不占账，卡同样得让开。
	await act(async () => {
		p.read().bind.onMouseEnter({ currentTarget: row, buttons: 0 } as never);
	});
	await act(async () => {
		await sleep(PAST_THE_DELAY_MS);
	});
	assert.ok(p.read().anchor, "先让它重新开起来");
	await act(async () => {
		dismissHoverLayers();
	});
	assert.equal(p.read().anchor, null, "对话框开出来时，屏幕上的卡也要收掉");

	await view.unmount();
});
