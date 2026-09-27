/**
 * 市场详情页：README 画出来、事实改成标签、内容分页。
 *
 * 桥是假的（`window.lyra`），README 由假的 `plugins.readme` 给；其余是真组件、真 store。
 * 要证的是用户看到的：README 是渲染过的，不是源码；那张「信息」表不在了，它说的东西成了名字下面
 * 的一行标签；技能不再和介绍摞在一起，而是另一个标签页。
 */

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { act, createElement as h } from "react";
import { DEFAULT_SETTINGS, type Plugin, type RegistryEntry, type Settings, type Skill } from "@lyra/core";
import type { LyraApi } from "../../electron/ipc-types.ts";
import { PluginsView } from "../../src/features/plugins/PluginsView.tsx";
import { useApp } from "../../src/store/index.ts";
import { click, mount } from "../helpers/mount.ts";

type Scan = Awaited<ReturnType<LyraApi["plugins"]["list"]>>;

const REGISTRY = "https://market.example/v1/index";

const README = [
	'<p align="center"><img src="assets/logo.png" alt="Waza logo" width="120"></p>',
	"",
	"# Waza",
	"",
	"Eight **engineering** habits, as workflows.",
	"",
	"- think",
	"- check",
	"",
	"> [!TIP]",
	"> Start with `/think`.",
	"",
	"| skill | does |",
	"| --- | --- |",
	"| hunt | finds root causes |",
].join("\n");

const entries: RegistryEntry[] = [
	{ id: "waza", name: "Waza", kind: "skill", repository: "https://github.com/tw93/Waza.git", category: "工作流", description: "工程习惯", license: "MIT", clients: ["claude-code", "lyra"] },
	{ id: "quiet", name: "Quiet", kind: "plugin", repository: "https://github.com/o/quiet.git", category: "开发", description: "没有 README 的那一个" },
];

function skill(name: string): Skill {
	return { name, description: `${name} 的说明`, path: `/home/.lyra/plugins/waza/skills/${name}/SKILL.md`, dir: `/home/.lyra/plugins/waza/skills/${name}`, source: "user", pluginId: "waza" } as Skill;
}

function scanWith(extra: Partial<Scan> = {}): Scan {
	return { plugins: [], mcpBundles: [], skills: [], skillDiagnostics: [], shadowedSkills: [], pluginDiagnostics: [], installs: {}, ...extra };
}

let seq = 0;
function stubBridge(scan: Scan, readmes: Record<string, string | null>, settings: Partial<Settings> = {}): { asked: string[] } {
	const asked: string[] = [];
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: {
			plugins: {
				list: async () => scan,
				fetchRegistry: async () => ({ ok: true, registry: { url: REGISTRY, name: "Test", entries } }),
				icons: async () => ({}),
				icon: async () => null,
				environment: async () => [],
				readme: async (query: { id: string }) => {
					asked.push(query.id);
					const markdown = readmes[query.id];
					return markdown ? { markdown, repo: "tw93/Waza", dir: "" } : null;
				},
			},
			settings: { save: async (next: Settings) => next },
			sessions: { capabilities: async () => null },
			system: { openExternal: async () => {}, openPath: async () => {}, remoteImage: async () => "data:image/png;base64,iVBORw0KGgo=" },
		},
	});
	seq += 1;
	useApp.setState({
		workspace: { path: `/tmp/plugin-detail-readme-${seq}` } as never,
		settings: { ...DEFAULT_SETTINGS, pluginRegistries: [REGISTRY], skillRegistries: [], ...settings },
		pluginFocus: null,
		pluginUpdates: null,
		view: "plugins",
	});
	return { asked };
}

async function settle(): Promise<void> {
	for (let i = 0; i < 6; i += 1) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

async function open(view: Awaited<ReturnType<typeof mount>>, name: string): Promise<void> {
	const card = view.all<HTMLElement>("[data-card]").find((el) => el.textContent?.includes(name));
	assert.ok(card, `找不到「${name}」的卡片`);
	await click(card.querySelector("button")!);
	await settle();
}

afterEach(() => {
	useApp.setState({ pluginFocus: null });
});

test("详情页画的是 README 本身：标题、列表、提示块、表格，没有一个字的源码漏出来", async () => {
	const { asked } = stubBridge(scanWith(), { waza: README });
	const view = await mount(h(PluginsView));
	try {
		await settle();
		await open(view, "Waza");
		assert.deepEqual(asked, ["waza"], "按条目的 id 去要");
		const readme = view.find<HTMLElement>("[data-readme]");
		assert.equal(readme.querySelector("h1")?.textContent?.trim(), "Waza");
		assert.equal(readme.querySelectorAll("li").length, 2);
		assert.ok(readme.querySelector("strong"), "**engineering** 画成了粗体");
		assert.ok(readme.querySelector("table"), "表格画成了表格");
		assert.match(readme.textContent ?? "", /提示/, "[!TIP] 是一个带标题的提示块");
		assert.doesNotMatch(readme.textContent ?? "", /<p|\*\*|\[!TIP\]|\| ---/, "源码一个字都不该出现");
	} finally {
		await view.unmount();
	}
});

test("那张信息表没有了：类别、许可、能装进的客户端成了一行标签，仓库是一个图标", async () => {
	stubBridge(scanWith(), { waza: README });
	const view = await mount(h(PluginsView));
	try {
		await settle();
		await open(view, "Waza");
		const tags = view.find<HTMLElement>("[data-detail-tags]");
		for (const word of ["工作流", "MIT", "Claude Code", "Lyra"]) assert.match(tags.textContent ?? "", new RegExp(word));
		assert.ok(tags.querySelector('button[aria-label="仓库"]'), "仓库是标签行末尾的一个图标按钮");
		const page = view.find<HTMLElement>("[data-plugin-detail]").textContent ?? "";
		assert.doesNotMatch(page, /开发者|来源|适用于/, "信息表里的那几行都不在了");
	} finally {
		await view.unmount();
	}
});

test("装好的技能集合：介绍和技能是两个标签页，切过去才是技能列表", async () => {
	const installed: Plugin = {
		id: "waza",
		dir: "/home/.lyra/plugins/waza",
		manifest: { name: "waza", version: "3.0.0" },
		source: "user",
		skills: [skill("think"), skill("check")],
		enabled: true,
	};
	stubBridge(scanWith({ plugins: [installed] }), { waza: README });
	const view = await mount(h(PluginsView));
	try {
		await settle();
		await open(view, "Waza");
		const tabs = view.all<HTMLButtonElement>("[data-plugin-detail] [role=tab]").map((tab) => tab.textContent?.replace(/\s+/g, ""));
		assert.deepEqual(tabs, ["介绍", "技能2"]);
		assert.ok(view.find("[data-readme]"), "先看到的是介绍");
		await click(view.all<HTMLButtonElement>("[data-plugin-detail] [role=tab]")[1]!);
		await settle();
		assert.equal(view.find("[data-detail-tab]").getAttribute("data-detail-tab"), "skills");
		assert.match(view.find("[data-detail-tab]").textContent ?? "", /think[\s\S]*check/);
	} finally {
		await view.unmount();
	}
});

test("没有 README 的：用它自己的描述，不留一块空白，也不挂骨架", async () => {
	stubBridge(scanWith(), { quiet: null });
	const view = await mount(h(PluginsView));
	try {
		await settle();
		await open(view, "Quiet");
		const body = view.find<HTMLElement>("[data-detail-tab]");
		assert.equal(body.querySelector("[data-readme]"), null);
		assert.equal(body.querySelector("[aria-busy]"), null, "不在加载中");
		assert.equal(view.all("[data-plugin-detail] [role=tab]").length, 0, "只有介绍一页时不画标签条");
	} finally {
		await view.unmount();
	}
});
