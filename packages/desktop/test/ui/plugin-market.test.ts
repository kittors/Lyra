/**
 * 插件市场和它的详情页，挂载出来点：看到的是不是对的状态，点下去发出去的是不是对的请求。
 *
 * 桥是假的（`window.lyra`），数据是手写的一份索引加一次扫盘结果，其余全是真组件、真 store：
 * 卡片上的状态怎么认、搜索和分类怎么筛、钥匙怎么存、开关怎么改设置——这些都在组件和 store 里，
 * 桩只替掉进程边界那一头。
 */

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { act, createElement as h } from "react";
import { DEFAULT_SETTINGS, type McpServerConfig, type Plugin, type RegistryEntry, type Settings } from "@lyra/core";
import type { LyraApi } from "../../electron/ipc-types.ts";
import { PluginsView } from "../../src/features/plugins/PluginsView.tsx";
import { RegistrySources } from "../../src/features/plugins/RegistrySources.tsx";
import { useApp } from "../../src/store/index.ts";
import { click, fire, mount } from "../helpers/mount.ts";

type Scan = Awaited<ReturnType<LyraApi["plugins"]["list"]>>;

const REGISTRY = "https://market.example/v1/index";

const entries: RegistryEntry[] = [
	{ id: "brave-search", name: "Brave Search", kind: "mcp", repository: "https://github.com/o/r.git", path: "plugins/brave-search", category: "搜索", description: "用 Brave 搜网页", needs: [{ name: "BRAVE_API_KEY", description: "Brave 的 key" }], downloads: 40, keywords: ["web", "网页搜索"] },
	{ id: "deepwiki", name: "DeepWiki", kind: "mcp", repository: "https://github.com/o/r.git", path: "plugins/deepwiki", category: "开发", description: "读任何 GitHub 仓库的文档", downloads: 90 },
	{ id: "superpowers", name: "Superpowers", kind: "plugin", repository: "https://github.com/obra/superpowers.git", category: "工作流", description: "一套写代码的做事顺序", downloads: 300, commit: "b".repeat(40) },
	{ id: "waza", name: "Waza", kind: "skill", repository: "https://github.com/tw93/Waza.git", path: "skills", category: "工作流", description: "工程习惯", downloads: 10 },
];

function plugin(id: string, extra: Partial<Plugin> = {}): Plugin {
	return {
		id,
		dir: `/home/.lyra/plugins/${id}`,
		manifest: { name: id, version: "1.0.0" },
		source: "user",
		skills: [],
		enabled: true,
		...extra,
	};
}

function scanWith(extra: Partial<Scan> = {}): Scan {
	return { plugins: [], mcpBundles: [], skills: [], skillDiagnostics: [], shadowedSkills: [], pluginDiagnostics: [], installs: {}, ...extra };
}

interface Stub {
	installs: { id: string; replace?: boolean }[];
	saved: Settings[];
	scan: Scan;
}

let seq = 0;
function stubBridge(scan: Scan, settings: Partial<Settings> = {}): Stub {
	const stub: Stub = { installs: [], saved: [], scan };
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: {
			plugins: {
				list: async () => stub.scan,
				fetchRegistry: async () => ({ ok: true, registry: { url: REGISTRY, name: "Test", entries } }),
				icons: async () => ({}),
				environment: async () => [],
				installFromRegistry: async (entry: RegistryEntry, _from?: string, replace?: boolean) => {
					stub.installs.push({ id: entry.id, replace });
					return { ok: true, dir: `/x/${entry.id}`, kind: entry.kind, servers: 0 };
				},
				updateAll: async () => ({ outdated: [], checkedAt: 1, auto: true, updating: [], failed: [], revision: 1 }),
				uninstall: async () => {},
			},
			settings: {
				save: async (next: Settings) => {
					stub.saved.push(next);
					return next;
				},
			},
			sessions: { capabilities: async () => null },
			system: { openExternal: async () => {}, openPath: async () => {} },
		},
	});
	seq += 1;
	useApp.setState({
		// 每条测试一个不同的目录：共用的扫盘缓存按目录记，不串到下一条。
		workspace: { path: `/tmp/plugin-market-test-${seq}` } as never,
		settings: { ...DEFAULT_SETTINGS, pluginRegistries: [REGISTRY], skillRegistries: [], ...settings },
		pluginFocus: null,
		pluginUpdates: null,
		view: "plugins",
	});
	return stub;
}

/** 等扫盘和索引都回来、画完。 */
async function settle(): Promise<void> {
	for (let i = 0; i < 4; i += 1) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

function card(view: Awaited<ReturnType<typeof mount>>, name: string): HTMLElement {
	const found = view.all<HTMLElement>("[data-card]").find((el) => el.textContent?.includes(name));
	assert.ok(found, `找不到「${name}」的卡片：${view.text().slice(0, 300)}`);
	return found;
}

afterEach(() => {
	useApp.setState({ pluginFocus: null });
});

test("一个网格：标签数对得上，没装的是「安装」，要钥匙的写着「需要密钥」，本机的有自己一排", async () => {
	stubBridge(scanWith({ plugins: [plugin("my-local-plugin", { manifest: { name: "我的插件" } })] }));
	const view = await mount(h(PluginsView));
	try {
		await settle();
		const tabs = view.all<HTMLButtonElement>("[data-market] [role=tab]").map((tab) => tab.textContent?.replace(/\s+/g, ""));
		assert.deepEqual(tabs, ["全部5", "插件2", "MCP2", "技能1"]);
		assert.match(card(view, "Superpowers").textContent ?? "", /安装/);
		assert.match(card(view, "Brave Search").textContent ?? "", /需要密钥/);
		assert.doesNotMatch(card(view, "DeepWiki").textContent ?? "", /需要密钥/);
		const local = view.find("[data-shelf=local]");
		assert.match(local.textContent ?? "", /我的插件/);
		assert.match(local.textContent ?? "", /本机添加/);
		// 公开 / 个人那一排没有了：它和卡片上的「已安装」说的是同一件事。
		assert.doesNotMatch(view.text(), /公开\s*\d|个人\s*\d/);
	} finally {
		await view.unmount();
	}
});

test("搜索按关键词也找得到，分类一点只剩那一类", async () => {
	stubBridge(scanWith());
	const view = await mount(h(PluginsView));
	try {
		await settle();
		const input = view.find<HTMLInputElement>("[data-market] input");
		await act(async () => {
			const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
			set.call(input, "网页搜索");
			input.dispatchEvent(new window.Event("input", { bubbles: true }));
		});
		await settle();
		assert.deepEqual(view.all("[data-card]").map((el) => el.textContent?.includes("Brave Search")), [true], "只剩 Brave——它的关键词里有「网页搜索」");
		await act(async () => {
			const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
			set.call(input, "");
			input.dispatchEvent(new window.Event("input", { bubbles: true }));
		});
		await settle();
		const chip = view.all<HTMLButtonElement>("[data-market] [role=group] button").find((b) => b.textContent?.startsWith("工作流"));
		assert.ok(chip);
		await click(chip);
		const names = view.all("[data-card-name]").map((el) => el.textContent);
		assert.deepEqual(names.sort(), ["Superpowers", "Waza"]);
	} finally {
		await view.unmount();
	}
});

test("点「安装」发出安装，扫盘一回来卡片就是「已安装」；装过又落后了的是「更新」", async () => {
	const stub = stubBridge(scanWith());
	const view = await mount(h(PluginsView));
	try {
		await settle();
		const install = [...card(view, "Superpowers").querySelectorAll("button")].find((b) => b.textContent === "安装");
		assert.ok(install);
		stub.scan = scanWith({ plugins: [plugin("superpowers", { origin: { id: "superpowers", commit: "b".repeat(40), installedAt: "x" } })] });
		await click(install);
		await settle();
		assert.deepEqual(stub.installs, [{ id: "superpowers", replace: false }]);
		assert.match(card(view, "Superpowers").textContent ?? "", /已安装/);

		// 市场上的提交往前走了一步：同一张卡片变成「更新」，点下去是 replace。
		stub.scan = scanWith({ plugins: [plugin("superpowers", { origin: { id: "superpowers", commit: "a".repeat(40), installedAt: "x" } })] });
		useApp.getState().bumpExtensions();
		await settle();
		const update = [...card(view, "Superpowers").querySelectorAll("button")].find((b) => b.textContent?.includes("更新"));
		assert.ok(update, card(view, "Superpowers").textContent ?? "");
		assert.match(view.find("[data-market-updates]").textContent ?? "", /1 个有新版本/);
		await click(update);
		await settle();
		assert.deepEqual(stub.installs.at(-1), { id: "superpowers", replace: true });
	} finally {
		await view.unmount();
	}
});

test("装好的 MCP 缺钥匙：卡片是「待配置」，详情页里填上就存进这台服务的 env，开关一次管它全部的服务", async () => {
	const server: McpServerConfig = {
		id: "brave-search__brave-search",
		name: "brave-search",
		transport: "stdio",
		command: "npx",
		args: ["-y", "@brave/brave-search-mcp-server"],
		env: { BRAVE_API_KEY: "${BRAVE_API_KEY}" },
		needs: [{ name: "BRAVE_API_KEY", description: "Brave 的 key", url: "https://brave.com/search/api/" }],
		enabled: false,
		origin: { bundle: "brave-search" },
	};
	const bundle = { id: "brave-search", dir: "/home/.lyra/mcp/brave-search", manifest: { name: "brave-search" }, source: "user" as const, servers: [server] };
	const stub = stubBridge(scanWith({ mcpBundles: [bundle] }), { mcpServers: [server] });
	const view = await mount(h(PluginsView));
	try {
		await settle();
		assert.match(card(view, "Brave Search").textContent ?? "", /待配置/);
		await click(card(view, "Brave Search").querySelector("button")!);
		await settle();
		const keys = view.find("[data-detail-keys]");
		assert.match(keys.textContent ?? "", /BRAVE_API_KEY/);
		assert.match(keys.textContent ?? "", /还缺 1 项/);

		const input = keys.querySelector<HTMLInputElement>("input")!;
		await act(async () => {
			const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
			set.call(input, "bsa-typed-key");
			input.dispatchEvent(new window.Event("input", { bubbles: true }));
		});
		await fire(input, new window.FocusEvent("focusout", { bubbles: true }));
		await fire(input, new window.FocusEvent("blur"));
		await settle();
		const afterKey = stub.saved.at(-1);
		assert.ok(afterKey, "失焦就存");
		assert.equal(afterKey.mcpServers[0]?.transport === "stdio" && afterKey.mcpServers[0].env?.BRAVE_API_KEY, "bsa-typed-key");

		const toggle = view.find<HTMLButtonElement>("[data-plugin-detail] [role=switch]");
		await click(toggle);
		await settle();
		assert.equal(stub.saved.at(-1)?.mcpServers[0]?.enabled, true);
	} finally {
		await view.unmount();
	}
});

test("详情页的开关遇到 `*`：只打开这一个，别的都点名关着——从前它把全部都打开了", async () => {
	const mine = plugin("superpowers", { enabled: false });
	const other = plugin("other-one", { enabled: false });
	const stub = stubBridge(scanWith({ plugins: [mine, other] }), { disabledPlugins: ["*"] });
	useApp.setState({ pluginFocus: "superpowers" });
	const view = await mount(h(PluginsView));
	try {
		await settle();
		await click(view.find<HTMLButtonElement>("[data-plugin-detail] [role=switch]"));
		await settle();
		const disabled = stub.saved.at(-1)?.disabledPlugins ?? [];
		assert.equal(disabled.includes("*"), false);
		assert.equal(disabled.includes("superpowers"), false);
		assert.equal(disabled.includes("other-one"), true, "别的插件没有被顺手打开");
	} finally {
		await view.unmount();
	}
});

test("来源对话框：删一个技能来源只删技能那张单子，插件来源一个字不动", async () => {
	const stub = stubBridge(scanWith(), { pluginRegistries: [REGISTRY], skillRegistries: [`${REGISTRY}?kind=skill`] });
	const view = await mount(h(RegistrySources, { errors: [], onClose: () => {} }));
	try {
		// 对话框画在 portal 里，不在挂载的那个节点下面。
		const rows = [...document.querySelectorAll<HTMLElement>("[data-row-actions]")];
		assert.equal(rows.length, 2);
		const skillRow = rows.find((row) => row.textContent?.includes("kind=skill"))!;
		await click(skillRow.querySelector("button[aria-label^='移除']")!);
		const confirm = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "移除");
		assert.ok(confirm, "要先确认");
		await click(confirm);
		// 确认的回调挂在退场动画的 animationend 上，happy-dom 不播动画，得手动送这一帧。
		await act(async () => {
			document.querySelector(".ly-dialog-out")?.dispatchEvent(new window.Event("animationend", { bubbles: true }));
		});
		const saved = stub.saved.at(-1);
		assert.deepEqual(saved?.pluginRegistries, [REGISTRY]);
		assert.deepEqual(saved?.skillRegistries, []);
	} finally {
		await view.unmount();
	}
});
