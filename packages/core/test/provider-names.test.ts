/**
 * 供应商的名字，活过删除它的那一下。
 *
 * 用量是按 `providerId` 记的账，名字却只活在 `providers` 里。删掉一个供应商，它花过的钱一分不少
 * 地留在日志里，用量页上却只剩 `provider-mttnetnn` 这么一串——这一整个文件是为那一串写的。
 *
 * 这里问的全是「什么时候记、什么时候不记、谁压过谁」，因为记错的代价不是报错：是一个名字被悄悄
 * 换成另一个，而页面照样显示得理直气壮。
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";

import { DEFAULT_SETTINGS, loadSettings, rememberProviderNames, saveSettings, type Settings } from "../src/config/settings.ts";
import { resetVault } from "../src/config/vault.ts";
import type { ProviderConfig } from "../src/types.ts";

let home: string;
const made: string[] = [];
const previous = { home: process.env.LYRA_HOME, userProfile: process.env.USERPROFILE };

beforeEach(async () => {
	home = await mkdtemp(join(tmpdir(), "lyra-names-"));
	made.push(home);
	process.env.LYRA_HOME = home;
	process.env.USERPROFILE = home;
	resetVault();
});

after(async () => {
	if (previous.home === undefined) delete process.env.LYRA_HOME;
	else process.env.LYRA_HOME = previous.home;
	if (previous.userProfile === undefined) delete process.env.USERPROFILE;
	else process.env.USERPROFILE = previous.userProfile;
	await Promise.all(made.map((dir) => rm(dir, { recursive: true, force: true })));
});

function provider(id: string, name: string): ProviderConfig {
	return { id, name, baseUrl: "https://example.invalid", api: "openai-responses", apiKey: "", enabled: true, models: [] };
}

function settings(over: Partial<Settings> = {}): Settings {
	return { ...DEFAULT_SETTINGS, ...over };
}

test("保存设置时，当前每个供应商的名字都进档案", () => {
	const named = rememberProviderNames(settings({ providers: [provider("provider-a", "公司中转"), provider("relay", "Relay")] }));
	assert.deepEqual(named, { "provider-a": "公司中转", relay: "Relay" });
});

test("供应商删掉之后，它的名字留在档案里", async () => {
	await saveSettings(settings({ providers: [provider("provider-a", "公司中转"), provider("provider-b", "deerGpt")] }));
	const withBoth = await loadSettings();
	assert.deepEqual(withBoth.providerNames, { "provider-a": "公司中转", "provider-b": "deerGpt" });

	// 删掉一个——`providers` 里没了，账上还有它花的钱，所以名字得留着。
	await saveSettings({ ...withBoth, providers: withBoth.providers.filter((each) => each.id !== "provider-b") });
	const after = await loadSettings();
	assert.equal(after.providers.length, 1);
	assert.deepEqual(after.providerNames, { "provider-a": "公司中转", "provider-b": "deerGpt" });
});

test("改名之后档案记的是新名字", () => {
	const named = rememberProviderNames({
		providers: [provider("provider-a", "新名字")],
		providerNames: { "provider-a": "旧名字" },
	});
	assert.equal(named["provider-a"], "新名字", "档案记的是最后见过的那个名字，不是第一次见到的");
});

test("用量页给已删除的供应商起的名字不会被下一次保存抹掉", () => {
	// 页面写进档案的那一行，其 id 不在 `providers` 里——合并只覆盖当前配着的那些，别的原样留着。
	const named = rememberProviderNames({
		providers: [provider("provider-a", "公司中转")],
		providerNames: { "provider-gone": "去年那个中转" },
	});
	assert.deepEqual(named, { "provider-gone": "去年那个中转", "provider-a": "公司中转" });
});

test("没填名字的供应商不占一行", () => {
	// 刚点了「添加」还没起名的那个，记进去就是档案里一行叫「」，比没有这一行更糟。
	const named = rememberProviderNames({ providers: [provider("provider-new", "   ")], providerNames: {} });
	assert.deepEqual(named, {});
});

test("读设置时，档案里的空名字被丢掉", async () => {
	await saveSettings(settings({ providers: [], providerNames: { good: "留着", blank: "  " } }));
	const loaded = await loadSettings();
	assert.deepEqual(loaded.providerNames, { good: "留着" }, "一行 `undefined` 比没有那一行更糟");
});
