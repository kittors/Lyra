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
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { CommitPushDialog } from "../../src/features/git/CommitPushDialog.tsx";
import { click, mount } from "../helpers/mount.ts";

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

test("是一个居中的弹窗，不是挂在按钮上的浮层", async () => {
	stubBridge();
	const view = await mount(h(CommitPushDialog, props));
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
	const view = await mount(h(CommitPushDialog, props));
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
	const view = await mount(h(CommitPushDialog, props));
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
		h(CommitPushDialog, {
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
		field.dispatchEvent(new Event("input", { bubbles: true }));

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
		h(CommitPushDialog, {
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
	const view = await mount(h(CommitPushDialog, { ...props, onCommit: async () => false }));
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

test("没有可推的提交时，「推送」那一行是禁用的", async () => {
	stubBridge();
	const view = await mount(h(CommitPushDialog, { ...props, unpushed: 0 }));
	try {
		const push = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "推送");
		assert.ok(push, "找不到「推送」那一行");
		assert.equal((push as HTMLButtonElement).disabled, true, "它一度永远画成灰的却永远可点");
	} finally {
		await view.unmount();
		Reflect.deleteProperty(window, "lyra");
	}
});
