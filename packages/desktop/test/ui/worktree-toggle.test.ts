/**
 * 新会话这一次用不用工作树：在输入框上选，设置只是起点。
 *
 * 从前只能在设置里一次定下「以后的会话都开工作树」，开新会话的时候没有地方说「这个要」「这个不要」。
 * 开关只在还没发出第一条的新会话、而且项目是 Git 仓库时出现——会话跑起来以后就挪不进副本了。
 */

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { act, createElement as h } from "react";
import { DEFAULT_SETTINGS } from "@lyra/core";
import { Composer } from "../../src/features/composer/Composer.tsx";
import { LayoutProvider } from "../../src/app/layout.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useApp, type AppState } from "../../src/store/index.ts";
import { click, mount, type Mounted } from "../helpers/mount.ts";

let view: Mounted | undefined;
let previous: AppState | undefined;
let sent: Array<Parameters<AppState["send"]>[1]> = [];

afterEach(async () => {
	await view?.unmount();
	view = undefined;
	if (previous) useApp.setState(previous, true);
	previous = undefined;
	sent = [];
});

async function blank({ gitRepo = true, byDefault = false, sessionId = null }: { gitRepo?: boolean; byDefault?: boolean; sessionId?: string | null } = {}) {
	previous = useApp.getState();
	const path = "/repo";
	useApp.setState({
		activeSessionId: sessionId,
		meta: null,
		workspace: { path, name: "repo", isGitRepo: gitRepo, branch: gitRepo ? "main" : null },
		scratchCwd: null,
		settings: { ...DEFAULT_SETTINGS, worktrees: { autoCreateOnNewSession: byDefault } },
		messages: [],
		running: false,
		drafts: { [sessionId ?? `new:project:${path}`]: { text: "改一下登录页", attachments: [], sessionRefs: [] } },
		send: async (_content, options) => {
			sent.push(options);
			return true;
		},
	});
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: {
			commands: { list: async () => ({ commands: [], skills: [], agents: [] }) },
			git: { stat: async () => null, status: async () => null },
		},
	});
	view = await mount(h(I18nProvider, { locale: "zh-CN", children: h(LayoutProvider, { children: h(Composer) }) }));
	return view;
}

const toggle = () => view!.all<HTMLButtonElement>("[data-ly-worktree-toggle]")[0];
const send = () => click(view!.find('[aria-label="发送"]'));

test("默认关着：点一下就是这一次用工作树，发出去带着它", async () => {
	await blank();
	assert.equal(toggle().getAttribute("aria-pressed"), "false");
	assert.equal(toggle().textContent, "", "off is the mark alone");
	await click(toggle());
	assert.equal(toggle().getAttribute("aria-pressed"), "true");
	assert.equal(toggle().textContent, "工作树");
	await send();
	assert.equal(sent[0]?.worktree, true);
});

test("设置里默认开着：不碰就用，点一下这一次就不用", async () => {
	await blank({ byDefault: true });
	assert.equal(toggle().getAttribute("aria-pressed"), "true");
	await click(toggle());
	await send();
	assert.equal(sent[0]?.worktree, false, "this conversation's answer, not the setting's");
});

test("换到另一个项目的新会话：从设置重新起步，不带着上一个的选择", async () => {
	await blank();
	await click(toggle());
	assert.equal(toggle().getAttribute("aria-pressed"), "true");
	await act(async () => {
		useApp.setState({ workspace: { path: "/other", name: "other", isGitRepo: true, branch: "main" } });
	});
	assert.equal(toggle().getAttribute("aria-pressed"), "false");
});

test("不是 Git 仓库没有这个开关，发出去也不带这一项", async () => {
	await blank({ gitRepo: false });
	assert.equal(toggle(), undefined);
	await send();
	assert.equal(Object.hasOwn(sent[0] ?? {}, "worktree"), false);
});

test("已经在跑的会话没有这个开关：它挪不进副本了", async () => {
	await blank({ sessionId: "running-one" });
	assert.equal(toggle(), undefined);
});
