/**
 * 发出去的消息里，一份 md 附件画成什么、菜单里有什么、点了之后发生什么。
 *
 * 用户报上来的原样：消息带了桌面上的 `调研-UI 参考知识库.md`，气泡上方是一张裂开的图（alt 是文件名），
 * 句子里那枚标记右键出来「预览 / 打开 / 在访达中显示 / 复制图片 / 复制路径」，「预览」和左键点它都没有
 * 任何反应。转录里那份记录是对的（`kind: "text"`），错在渲染端给每一份带路径的附件都算了一个图片地址。
 *
 * 消息用的是转录里那一条的真实形状：正文块、displayText 里的标记、带桌面路径的附件记录。项目列表是空的
 * ——那份文件本来就在项目外，这正是「预览」从前走不通的原因。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement as h } from "react";
import type { UserMessage as UserMessageType } from "@lyra/core";
import { UserMessage } from "../../src/features/conversation/UserMessage.tsx";
import { AttachmentStrip } from "../../src/features/composer/attachments/AttachmentStrip.tsx";
import { provideScope } from "../../src/features/dock/popout.ts";
import { usePaneDock } from "../../src/features/dock/pane-store.ts";
import { has } from "../../src/features/dock/tree.ts";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useApp } from "../../src/store/index.ts";
import { useOpenFile } from "../../src/store/openFile.ts";
import { click, fire, mount } from "../helpers/mount.ts";

const MD = "/Users/kittors/Desktop/调研-UI 参考知识库.md";
const NAME = "调研-UI 参考知识库.md";
/** 1x1 的透明 PNG——对照组那张真图片。 */
const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const calls = { read: [] as string[], openIn: [] as [string, string][], exists: [] as string[] };

Object.defineProperty(window, "lyra", {
	configurable: true,
	value: {
		host: "desktop",
		platform: "darwin",
		system: {
			openTargets: async () => [{ id: "reveal", label: "在访达中显示", aliases: [] }],
			pathExists: async (path: string) => {
				calls.exists.push(path);
				return true;
			},
			openIn: async (target: string, path: string) => {
				calls.openIn.push([target, path]);
			},
		},
		files: {
			read: async (path: string) => {
				calls.read.push(path);
				return { text: "# 调研-UI 参考知识库\n", readOnly: true, truncated: false, bytes: 24, modifiedAt: 1 };
			},
			mediaUrl: (path: string) => `ly-media://f/${encodeURIComponent(path)}`,
		},
		clipboard: { write: async () => {}, writeImage: async () => {} },
		commands: { list: async () => ({ commands: [], skills: [], agents: [] }) },
	},
});

function reset(): void {
	calls.read.length = 0;
	calls.openIn.length = 0;
	calls.exists.length = 0;
	window.localStorage.clear();
	useOpenFile.setState({ path: null, name: null, contents: null, loading: false, opening: null, tabs: [], drafts: {} });
	usePaneDock.setState({ trees: {}, sizes: {}, drag: null, maximized: {}, focused: {}, crossRatio: {}, host: null });
	provideScope(() => "s");
	usePaneDock.getState().rememberSize("s", { width: 1200, height: 900 });
}

/** 转录里那一条的形状。`kind` 可以换掉，用来模拟一份被记错门类的旧记录。 */
function mdMessage(kind = "text"): UserMessageType {
	return {
		role: "user",
		content: [
			{ type: "text", text: "参考的资料是 " },
			{ type: "text", text: `\n\n### Attached file: ${NAME}\n\`\`\`\n# 调研-UI 参考知识库\n\`\`\`\n\n` },
			{ type: "text", text: "，你仔细看看。" },
		],
		timestamp: 1790259367972,
		displayText: `参考的资料是 【${NAME}】，你仔细看看。`,
		attachments: [{ name: NAME, kind, mimeType: "text/markdown", path: MD, label: NAME }],
	};
}

function imageMessage(): UserMessageType {
	return {
		role: "user",
		content: [
			{ type: "text", text: "\n\n### Attached file: image.png\n\n" },
			{ type: "image", data: PIXEL, mimeType: "image/png" },
			{ type: "text", text: "看这张" },
		],
		timestamp: 2,
		displayText: "看【图片 1】这张",
		attachments: [{ name: "image.png", kind: "image", mimeType: "image/png", label: "图片 1" }],
	};
}

const render = (message: UserMessageType) => mount(h(I18nProvider, { locale: "zh-CN", children: h(UserMessage, { message, index: 0 }) }));

/** 等异步的那几步（先问文件在不在，再读）走完。 */
async function settle(done: () => boolean): Promise<void> {
	for (let i = 0; i < 40 && !done(); i++) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
		});
	}
}

/** 右键点一个元素，返回弹出来的菜单里那几行的字。菜单 portal 到 body 上。 */
async function menuOf(target: Element): Promise<{ rows: string[]; row(label: string): HTMLElement }> {
	await fire(target, new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
	const menu = document.body.querySelector('[role="menu"]');
	assert.ok(menu, "右键之后应当弹出菜单");
	const buttons = [...menu.querySelectorAll<HTMLElement>("button")];
	return {
		rows: buttons.map((button) => (button.textContent ?? "").trim()),
		row(label) {
			const found = buttons.find((button) => (button.textContent ?? "").trim() === label);
			assert.ok(found, `菜单里没有「${label}」`);
			return found;
		},
	};
}

test("md 附件画成句子里的一枚文件标记，气泡上方不画图", async () => {
	reset();
	const view = await render(mdMessage());
	try {
		assert.ok(!view.host.querySelector("img"), "一份 md 不该有任何 <img>");
		assert.ok(!view.host.querySelector("[data-ly-attachments]"), "气泡外那一排只摆图片，这条消息没有图片");
		const token = view.find(".ly-attachment-token");
		assert.equal(token.getAttribute("data-kind"), "text");
		assert.equal(token.textContent, NAME);
		assert.ok(!token.hasAttribute("data-bodiless"), "正文进了提示词，不是「只有文件名」");
	} finally {
		await view.unmount();
	}
});

test("md 标记的菜单：有预览、打开、在访达中显示、复制路径，没有「复制图片」", async () => {
	reset();
	const view = await render(mdMessage());
	try {
		const menu = await menuOf(view.find(".ly-attachment-token"));
		assert.deepEqual(menu.rows, ["预览", "打开", "在访达中显示", "复制路径"]);
	} finally {
		await view.unmount();
	}
});

test("菜单里的「预览」在右边的文件面板里打开它，项目外的也行", async () => {
	reset();
	const view = await render(mdMessage());
	try {
		const menu = await menuOf(view.find(".ly-attachment-token"));
		await click(menu.row("预览"));
		await settle(() => useOpenFile.getState().path === MD);
		assert.deepEqual(calls.exists, [MD], "打开之前先问文件还在不在");
		assert.deepEqual(calls.read, [MD]);
		assert.equal(useOpenFile.getState().path, MD);
		assert.equal(useOpenFile.getState().name, NAME, "标签页叫磁盘上的名字——面板按扩展名把 .md 渲染成文档");
		assert.ok(has(usePaneDock.getState().tree("s"), "file"), "文件面板要开出来");
	} finally {
		await view.unmount();
	}
});

test("左键点标记也是预览，不是去访达里指出来", async () => {
	reset();
	const view = await render(mdMessage());
	try {
		await click(view.find(".ly-attachment-token"));
		await settle(() => useOpenFile.getState().path === MD);
		assert.equal(useOpenFile.getState().path, MD);
		assert.deepEqual(calls.openIn, [], "项目外的 md 从前只能退成「在访达中显示」");
	} finally {
		await view.unmount();
	}
});

test("「打开」照旧交给外部应用", async () => {
	reset();
	const view = await render(mdMessage());
	try {
		const menu = await menuOf(view.find(".ly-attachment-token"));
		await click(menu.row("打开"));
		await settle(() => calls.openIn.length > 0);
		assert.equal(calls.openIn.length, 1);
		assert.equal(calls.openIn[0][1], MD);
	} finally {
		await view.unmount();
	}
});

test("转录里被记成图片的 md，也认得出是文件", async () => {
	reset();
	const view = await render(mdMessage("image"));
	try {
		assert.ok(!view.host.querySelector("img"), "记错了门类也不该长出一张图");
		const token = view.find(".ly-attachment-token");
		assert.equal(token.getAttribute("data-kind"), "text");
		const menu = await menuOf(token);
		assert.ok(!menu.rows.includes("复制图片"), `菜单：${menu.rows.join(" / ")}`);
		assert.ok(menu.rows.includes("预览"));
	} finally {
		await view.unmount();
	}
});

test("手机那一侧：项目外的不给「预览」，项目里的点一下照旧直接进面板", async () => {
	reset();
	const desktop = (window as unknown as { lyra: Record<string, unknown> }).lyra;
	// 手机上跑的是同一份渲染层，桥换成了那边的：读文件走同步服务、只认项目，`pathExists` 一律答空。
	Object.defineProperty(window, "lyra", { configurable: true, value: { ...desktop, host: "mobile" } });
	const previous = useApp.getState().settings;
	try {
		const outside = await render(mdMessage());
		try {
			const menu = await menuOf(outside.find(".ly-attachment-token"));
			assert.ok(!menu.rows.includes("预览"), `手机上项目外的文件读不到，不该给「预览」：${menu.rows.join(" / ")}`);
		} finally {
			await outside.unmount();
		}

		useApp.setState({ settings: { ...previous, projects: [{ id: "p", name: "p", path: "/Users/kittors/Desktop" }], editor: { defaultOpenTarget: "reveal" } } as never });
		const inside = await render(mdMessage());
		try {
			await click(inside.find(".ly-attachment-token"));
			await settle(() => useOpenFile.getState().path === MD);
			assert.equal(useOpenFile.getState().path, MD, "项目里的照旧进面板");
			assert.deepEqual(calls.exists, [], "手机上答不了「在不在」，不问——问了只会报一句「文件不在原处」");
		} finally {
			await inside.unmount();
		}
	} finally {
		useApp.setState({ settings: previous });
		Object.defineProperty(window, "lyra", { configurable: true, value: desktop });
	}
});

test("对照：真的图片照旧有缩略图，菜单里照旧能「复制图片」", async () => {
	reset();
	const view = await render(imageMessage());
	try {
		const img = view.find<HTMLImageElement>("[data-ly-attachments] img");
		assert.ok(img.getAttribute("src")?.startsWith("data:image/png;base64,"));
		const menu = await menuOf(view.find(".ly-attachment-token"));
		assert.ok(menu.rows.includes("复制图片"), `菜单：${menu.rows.join(" / ")}`);
		assert.ok(menu.rows.includes("预览"));
	} finally {
		await view.unmount();
	}
});

test("解不出来的缩略图退回成一份文件：门类图标加名字，不开查看器，不「复制图片」", async () => {
	reset();
	const opened: number[] = [];
	const view = await mount(
		h(I18nProvider, {
			locale: "zh-CN",
			children: h(AttachmentStrip, {
				files: [{ key: "1", name: NAME, kind: "image", src: `ly-media://f/${encodeURIComponent(MD)}`, path: MD }],
				onOpen: (index: number) => opened.push(index),
			}),
		}),
	);
	try {
		const tile = view.find("[data-ly-attachment]");
		assert.equal(tile.getAttribute("data-ly-shape"), "image");
		await fire(view.find("img"), new Event("error"));

		assert.ok(!view.host.querySelector("img"), "坏掉的图不该留在屏幕上");
		assert.equal(tile.getAttribute("data-ly-shape"), "file");
		assert.ok(view.text().includes("调研-UI 参考知识库"), `格子上应当写着名字：${view.text()}`);
		await click(view.find(".ly-attachment-body"));
		assert.deepEqual(opened, [], "没有像素可看，就不开查看器");

		const menu = await menuOf(tile);
		assert.ok(!menu.rows.includes("复制图片"), `菜单：${menu.rows.join(" / ")}`);
		assert.ok(menu.rows.includes("打开"));
	} finally {
		await view.unmount();
	}
});
