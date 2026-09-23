/**
 * 提交弹窗：居中的那一个，以及「提交到哪个分支」。
 *
 * 两件事在这里钉住：
 *
 * 一、**它是个居中弹窗，不是挂在按钮上的 popover**。从前它贴着窗口右上角展开，宽 340，底下压着
 *    半个面板。提交是少数几件「按下去就改变磁盘」的事，该占住屏幕中间、把背后压暗。
 *
 * 二、**分支那一行是能点的**。它一度带着一枚点了不动的箭头，后来那枚箭头被整个删掉了——两次都
 *    不对：要的是让它能动。展开是本地分支，末尾一项是新建；选了新建不会当场创建分支，名字先
 *    记着，等真的提交那一刻才 `git switch -c`，中途改主意就什么都没发生。
 *
 * 三、**关掉它不等于那件事没在发生**。写了什么、哪一步在跑，都存在弹窗外面（`commit-work.ts`），
 *    所以生成到一半按下 Esc，事情照跑，工具条那颗按钮照转，再打开还是原来那一个。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement as h, useState } from "react";
import { CommitPushDialog, type CommitPushDialogProps } from "../../src/features/git/CommitPushDialog.tsx";
import { useCommitWork } from "../../src/features/git/commit-work.ts";
import { click, fire, mount } from "../helpers/mount.ts";
import { withKeyboard } from "../helpers/keyboard.ts";

/**
 * `Overlay` 把卡片送进 portal，所以它不在挂载点的子树里。
 *
 * 第一版这里用的是 `view.find`，六条里红了五条——报的是「找不到元素」，看着像组件没画出来。
 * 实际画在 `document.body` 上。
 */
const at = (selector: string) => document.querySelector(selector);
const textOf = () => document.body.textContent ?? "";

/** 这个弹窗会问主进程要分支、要状态，够用就行。 */
function stubBridge(extra: Record<string, unknown> = {}) {
	const calls: { name: string; args: unknown[] }[] = [];
	const record = (name: string, value: unknown) => (...args: unknown[]) => {
		calls.push({ name, args });
		return Promise.resolve(value);
	};
	Reflect.set(window, "lyra", {
		platform: "darwin",
		git: {
			branches: record("branches", { current: "main", local: ["main", "feature-x"], remote: [] }),
			status: record("status", { branch: "main", staged: [], unstaged: [] }),
			stage: record("stage", { ok: true }),
			createBranch: record("createBranch", { ok: true }),
			switchBranch: record("switchBranch", { ok: true }),
			generateCommitMessage: record("generateCommitMessage", { ok: true, message: "生成的一句话" }),
			...extra,
		},
	});
	return calls;
}

const props = {
	cwd: "/repo",
	branch: "main",
	stagedCount: 2,
	unstagedCount: 1,
	addedCount: 10,
	removedCount: 3,
	busy: false,
	running: false,
	unpushed: 0,
	pushTip: "已与 origin/main 同步",
	onClose: () => {},
	onCommit: async () => true,
	onCommitAndPush: async () => true,
	onPush: async () => {},
};

/**
 * 面板的替身——弹窗一个人挂不起来，也不该挂得起来。
 *
 * 「这次提交」那份状态归面板持有（见 `commit-work.ts`），弹窗只是它此刻的样子。所以测试里也得
 * 有个东西替面板拿着它：`data-test-toggle` 把弹窗关掉再打开，`data-test-active` 是工具条那颗
 * 按钮读的同一个值——它说「还有活在跑」，按钮据此转圈。
 */
function Panel(props: Omit<CommitPushDialogProps, "work">) {
	const work = useCommitWork(props.cwd);
	const [open, setOpen] = useState(true);
	return h(
		"div",
		null,
		h("button", { "data-test-toggle": "", onClick: () => setOpen((v) => !v) }, "toggle"),
		h("span", { "data-test-active": work.active ? "1" : "0" }),
		open ? h(CommitPushDialog, { ...props, work }) : null,
	);
}

/** 面板此刻认不认为还有活在跑——转圈与否读的就是这一个。 */
const active = (view: { find: (selector: string) => HTMLElement }) =>
	view.find("[data-test-active]").getAttribute("data-test-active");

test("是一个居中的弹窗，不是挂在按钮上的浮层", async () => {
	stubBridge();
	const view = await mount(h(Panel, props));
	try {
		/*
		 * `Overlay` 画的是遮罩 + 居中卡片；`Popover` 画的是锚定在某个矩形上的浮层。两者的区别
		 * 在 DOM 上看得见：前者有一层铺满的背板。
		 */
		assert.ok(at("[data-ly-overlay]"), "没有遮罩，说明还是个 popover");
		assert.ok(at('[data-ly-modal][role="dialog"][aria-modal="true"]'), "遮罩里该是一个真正的模态");
		assert.ok(at("[data-ly-commit-dialog]"), "弹窗本体没画出来");
	} finally {
		await view.unmount();
		Reflect.deleteProperty(window, "lyra");
	}
});

test("分支那一行能点开，里面列着本地分支", async () => {
	stubBridge();
	const view = await mount(h(Panel, props));
	try {
		const picker = at("[data-ly-branch-picker]");
		assert.ok(picker, "分支那一行不可点——它一度只是个标签");
		await click(picker);
		const text = textOf();
		assert.ok(text.includes("feature-x"), `菜单里该有另一个本地分支：${text.slice(0, 160)}`);
		assert.ok(text.includes("新分支"), "菜单末尾该有「新分支」");
	} finally {
		await view.unmount();
		Reflect.deleteProperty(window, "lyra");
	}
});

test("选「新分支」只是换成一个输入框，不会当场建分支", async () => {
	const calls = stubBridge();
	const view = await mount(h(Panel, props));
	try {
		await click(at("[data-ly-branch-picker]")!);
		const entry = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("新分支"));
		assert.ok(entry, "菜单里没有「新分支」");
		await click(entry);
		assert.ok(at("[data-ly-new-branch]"), "该换成一个能打字的输入框");
		/*
		 * 这一条是重点：名字还没填、更没提交，仓库里不该多出任何东西。中途改主意留下一个空分支，
		 * 是这种「先建后用」的做法最常见的后遗症。
		 */
		assert.equal(calls.filter((c) => c.name === "createBranch").length, 0, "分支不该在这一刻就被创建");
	} finally {
		await view.unmount();
		Reflect.deleteProperty(window, "lyra");
	}
});

test("填了新分支名再提交：先建分支，再提交", async () => {
	const calls = stubBridge();
	const order: string[] = [];
	const view = await mount(
		h(Panel, {
			...props,
			onCommit: async (message: string) => {
				order.push(`commit:${message}`);
				return true;
			},
		}),
	);
	try {
		await click(at("[data-ly-branch-picker]")!);
		const entry = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("新分支"))!;
		await click(entry);

		const field = at("[data-ly-new-branch]") as HTMLInputElement;
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
		setter.call(field, "fix/some-bug");
		// `fire`，不是裸的 `dispatchEvent`：分支名现在存在弹窗外面，更新打的是另一个组件，
		// 不包 act 就是一句「update was not wrapped in act」的警告加一次读到旧值的风险。
		await fire(field, new Event("input", { bubbles: true }));

		const commit = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim().startsWith("提交") && !(b.textContent ?? "").includes("推送"));
		assert.ok(commit, "找不到「提交」那一行");
		await click(commit);

		const made = calls.find((c) => c.name === "createBranch");
		assert.ok(made, "提交时该先把分支建出来");
		assert.deepEqual(made.args, ["/repo", "fix/some-bug"]);
		assert.ok(order.some((step) => step.startsWith("commit:")), "分支建完之后要真的提交");
	} finally {
		await view.unmount();
		Reflect.deleteProperty(window, "lyra");
	}
});

test("留空提交：先生成一句，提交的就是那一句", async () => {
	stubBridge();
	const committed: string[] = [];
	const view = await mount(
		h(Panel, {
			...props,
			onCommit: async (message: string) => {
				committed.push(message);
				return true;
			},
		}),
	);
	try {
		const commit = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim().startsWith("提交") && !(b.textContent ?? "").includes("推送"))!;
		await click(commit);
		assert.deepEqual(committed, ["生成的一句话"]);
	} finally {
		await view.unmount();
		Reflect.deleteProperty(window, "lyra");
	}
});

/*
 * 生成出来的那句话要**写回输入框**，人得看得见自己提交的是什么。
 *
 * 成功那条路上看不出来——提交完就清空、关窗，本来就该这样。所以这一条让提交失败：弹窗留在原地，
 * 那句生成的话必须还在框里，否则人重试时面对的又是一个空框，而刚才那句已经无从得知。
 */
test("生成的那句话写回了输入框——提交失败时它还在", async () => {
	stubBridge();
	const view = await mount(h(Panel, { ...props, onCommit: async () => false }));
	try {
		const commit = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim().startsWith("提交") && !(b.textContent ?? "").includes("推送"))!;
		await click(commit);
		const field = at("[data-ly-commit-message]") as HTMLTextAreaElement;
		assert.equal(field.value, "生成的一句话");
	} finally {
		await view.unmount();
		Reflect.deleteProperty(window, "lyra");
	}
});

/** 一个握在测试手里的生成请求：按下提交之后它就停在那儿，直到这里放行。 */
function pendingGenerate() {
	let release!: (result: { ok: boolean; message?: string }) => void;
	const promise = new Promise<{ ok: boolean; message?: string }>((resolve) => {
		release = resolve;
	});
	return { promise, release };
}

/** 弹窗底下那一行「提交」。菜单项里也有带「提交」的字样，所以按整行的文字认。 */
const commitRow = () =>
	[...document.querySelectorAll("button")].find(
		(b) => (b.textContent ?? "").trim().startsWith("提交") && !(b.textContent ?? "").includes("推送"),
	)!;

/*
 * 生成到一半把弹窗关掉：事情还在跑，工具条那颗按钮还在转，再打开还是原来那一个。
 *
 * 从前这三样都不成立——状态长在弹窗自己的 `useState` 上，关掉即卸载：转圈没了，面板也不知道自己
 * 正在忙（那颗按钮反而因为 `busy` 画成了禁用的灰色），再打开是一个崭新的空框。而磁盘那边，模型
 * 照样在写，提交照样会落下去。
 */
test("生成中关掉弹窗：活还在跑，再打开还是原来那一个", async () => {
	const generate = pendingGenerate();
	stubBridge({ generateCommitMessage: () => generate.promise });
	const view = await mount(h(Panel, props));
	try {
		await click(commitRow());
		assert.equal(
			(at("[data-ly-commit-message]") as HTMLTextAreaElement).placeholder,
			"正在生成提交说明…",
			"按下提交、输入框留空，这一刻该正在生成",
		);

		await click(view.find("[data-test-toggle]"));
		assert.ok(!at("[data-ly-commit-dialog]"), "弹窗该收起来了");
		assert.equal(active(view), "1", "弹窗关了，但这件事还在跑——那颗按钮正是读这一个来转圈的");

		await click(view.find("[data-test-toggle]"));
		assert.equal(
			(at("[data-ly-commit-message]") as HTMLTextAreaElement).placeholder,
			"正在生成提交说明…",
			"再打开该接着刚才那一下，而不是一个崭新的空框",
		);
		assert.ok(commitRow().querySelector("svg.ly-arc"), "「提交」那一行该还在转");
	} finally {
		generate.release({ ok: true, message: "生成的一句话" });
		await act(async () => {});
		await view.unmount();
		Reflect.deleteProperty(window, "lyra");
	}
});

/*
 * 生成回来的时候弹窗已经关了：那句话不能丢。
 *
 * 它是这次提交的内容，不是弹窗的一个渲染细节。`setMessage` 打在一个卸载掉的组件上，等于模型白写
 * 一次——重新打开只剩空框，而人完全不知道刚才那两秒发生过什么。
 */
test("关着的时候生成回来了：再打开，那句话在框里", async () => {
	const generate = pendingGenerate();
	stubBridge({ generateCommitMessage: () => generate.promise });
	const view = await mount(h(Panel, { ...props, onCommit: async () => false }));
	try {
		await click(commitRow());
		await click(view.find("[data-test-toggle]"));

		await act(async () => {
			generate.release({ ok: true, message: "生成的一句话" });
		});
		assert.equal(active(view), "0", "生成回来、提交也试过了，这件事就结束了");

		await click(view.find("[data-test-toggle]"));
		assert.equal(
			(at("[data-ly-commit-message]") as HTMLTextAreaElement).value,
			"生成的一句话",
			"提交失败了，那句生成出来的话得还在框里等重试",
		);
	} finally {
		await view.unmount();
		Reflect.deleteProperty(window, "lyra");
	}
});

test("没有可推的提交时，「推送」那一行是禁用的", async () => {
	stubBridge();
	const view = await mount(h(Panel, { ...props, unpushed: 0 }));
	try {
		const push = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "推送");
		assert.ok(push, "找不到「推送」那一行");
		assert.equal((push as HTMLButtonElement).disabled, true, "它一度永远画成灰的却永远可点");
	} finally {
		await view.unmount();
		Reflect.deleteProperty(window, "lyra");
	}
});

test("「提交」那一行的键帽按这台机器的键盘写：PC 上是 Ctrl+Enter，不是 ⌘↩", async () => {
	stubBridge();
	await withKeyboard("Win32", async () => {
		const view = await mount(h(Panel, props));
		try {
			const keys = [...document.querySelectorAll("[data-ly-commit-dialog] kbd")].map((kbd) => kbd.textContent);
			// 绑定本来就认 Ctrl+Enter（见 onKeyDown 里的 metaKey || ctrlKey），错的只是这枚键帽。
			assert.ok(keys.includes("Ctrl+Enter"), `键帽写的是 ${JSON.stringify(keys)}`);
			assert.ok(!keys.some((key) => key?.includes("⌘")));
		} finally {
			await view.unmount();
			Reflect.deleteProperty(window, "lyra");
		}
	});
});
