/**
 * The provider file: what it says about itself, and what reading one does.
 *
 * Two halves worth testing separately. Writing is nearly free to get right; reading is not, because
 * the file arrives from a machine this one cannot see — so the checks that matter are the ones on
 * the way in, where a half-formed entry either stops or reaches `settings.json`.
 *
 * The import rules are the other half, and both of them are the kind that look obvious and are
 * silently wrong when they are not written down: a file usually carries ids this machine already
 * has, so most rows replace rather than add; and an entry whose key did not travel must not clear
 * the key already configured here.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelConfig, ProviderConfig } from "@lyra/core";

import {
	applyImport,
	bundleFileName,
	buildBundle,
	parseBundle,
	planImport,
	serializeBundle,
	uniqueProviderName,
} from "../src/features/settings/provider-transfer.ts";

function model(providerId: string, modelId: string, extra: Partial<ModelConfig> = {}): ModelConfig {
	return {
		id: `${providerId}/${modelId}`,
		providerId,
		modelId,
		name: modelId,
		contextWindow: 200_000,
		maxOutputTokens: 16_384,
		supportsThinking: false,
		supportsImages: false,
		supportsTools: true,
		...extra,
	};
}

function provider(id: string, extra: Partial<ProviderConfig> = {}): ProviderConfig {
	return {
		id,
		name: id.toUpperCase(),
		baseUrl: `https://${id}.example.com`,
		api: "anthropic-messages",
		apiKey: `sk-${id}`,
		enabled: true,
		models: [model(id, `${id}-pro`)],
		...extra,
	};
}

function roundTrip(providers: ProviderConfig[]) {
	const parsed = parseBundle(serializeBundle(buildBundle(providers)));
	assert.ok(parsed.ok, "a file this build wrote must be one it can read");
	return parsed;
}

test("a file written here reads back as the same providers", () => {
	const providers = [provider("glm"), provider("deer", { enabled: false, headers: { "x-tenant": "acme" } })];
	const parsed = roundTrip(providers);

	assert.deepEqual(parsed.bundle.providers, providers);
	assert.equal(parsed.dropped, 0);
});

test("what is expensive to derive again travels with the model", () => {
	// A relay alias has no catalogue entry, so pricing worked out here is not recoverable there.
	const priced = model("relay", "gpt-5.6-terra", {
		pricing: { input: 1.25, output: 10, source: "manual" },
		catalogRef: { providerId: "openai", modelId: "gpt-5.6" },
		metadataSource: "manual",
		samplingParams: { top_p: 0.95 },
	});
	const parsed = roundTrip([provider("relay", { models: [priced] })]);

	assert.deepEqual(parsed.bundle.providers[0].models[0], priced);
});

test("the file says whether it is worth stealing", () => {
	assert.equal(buildBundle([provider("glm")]).containsSecrets, true);
	assert.equal(buildBundle([provider("glm", { apiKey: "" })]).containsSecrets, false);
	assert.equal(buildBundle([provider("glm", { apiKey: "   " })]).containsSecrets, false, "whitespace is not a key");
});

test("the name is sortable by eye", () => {
	assert.equal(bundleFileName(new Date(2026, 8, 9, 15, 4)), "lyra-providers-20260909-1504.json");
});

test("anything that is not one of our files is refused, and says which way", () => {
	assert.deepEqual(parseBundle("not json at all"), { ok: false, problem: "not-json" });
	assert.deepEqual(parseBundle('{"providers":[]}'), { ok: false, problem: "not-a-bundle" });
	assert.deepEqual(
		parseBundle(JSON.stringify({ kind: "lyra.providers", version: 99, providers: [provider("glm")] })),
		{ ok: false, problem: "too-new" },
		"a newer file is refused rather than read for the parts this build happens to understand",
	);
	assert.deepEqual(
		parseBundle(JSON.stringify({ kind: "lyra.providers", version: 1, providers: [] })),
		{ ok: false, problem: "no-providers" },
	);
});

test("an entry missing what a provider needs is dropped, and counted", () => {
	/*
	 * Dropped rather than repaired: a provider with no address is not a provider, and inventing one
	 * puts a row in the model picker that can never answer.
	 */
	const parsed = parseBundle(
		JSON.stringify({
			kind: "lyra.providers",
			version: 1,
			providers: [provider("glm"), { name: "no id or url" }, { id: "x" }],
		}),
	);

	assert.ok(parsed.ok);
	assert.equal(parsed.bundle.providers.length, 1);
	assert.equal(parsed.dropped, 2, "the window says the file was not entirely understood");
});

test("a hand-edited entry is filled in rather than trusted", () => {
	const parsed = parseBundle(
		JSON.stringify({
			kind: "lyra.providers",
			version: 1,
			providers: [
				{
					id: "glm",
					baseUrl: "https://open.bigmodel.cn/api/anthropic",
					api: "carrier-pigeon",
					enabled: "yes please",
					headers: { ok: "1", bad: 2 },
					models: [{ modelId: "glm-5.3" }, { name: "no id" }],
				},
			],
		}),
	);

	assert.ok(parsed.ok);
	const [one] = parsed.bundle.providers;
	assert.equal(one.api, "openai-responses", "an unknown wire format falls back rather than reaching the adapter");
	assert.equal(one.enabled, true);
	assert.equal(one.apiKey, "");
	assert.equal(one.headers, undefined, "a header map with a non-string in it is not a header map");
	assert.deepEqual(
		one.models.map((m) => m.id),
		["glm/glm-5.3"],
		"the model with no id is dropped; the one without a local id gets the derived one",
	);
});

test("the plan says which rows replace something", () => {
	const here = [provider("glm"), provider("deer")];
	const entries = planImport([provider("glm", { name: "GLM 新" }), provider("xiaoji")], here);

	assert.deepEqual(
		entries.map((entry) => [entry.provider.id, entry.kind]),
		[
			["glm", "replace"],
			["xiaoji", "new"],
		],
	);
});

test("a key that did not travel is noticed before the import, not after", () => {
	const here = [provider("glm")];
	const [replacing, adding] = planImport([provider("glm", { apiKey: "" }), provider("new", { apiKey: "" })], here);

	assert.deepEqual(
		{ hasKey: replacing.hasKey, keepsLocalKey: replacing.keepsLocalKey },
		{ hasKey: false, keepsLocalKey: true },
	);
	assert.deepEqual(
		{ hasKey: adding.hasKey, keepsLocalKey: adding.keepsLocalKey },
		{ hasKey: false, keepsLocalKey: false },
		"nothing here to keep, so this one arrives unusable and the window has to say so",
	);
});

test("importing replaces by id, appends the rest, and keeps the order it had", () => {
	const here = [provider("glm"), provider("deer")];
	const { providers } = applyImport(here, [provider("deer", { name: "Deer 2" }), provider("xiaoji")], null);

	assert.deepEqual(
		providers.map((one) => one.name),
		["GLM", "Deer 2", "XIAOJI"],
		"a replaced provider stays where it was; new ones go on the end",
	);
});

test("an empty key in the file means 'not exported', never 'clear mine'", () => {
	const here = [provider("glm", { apiKey: "sk-live" })];
	const { providers } = applyImport(here, [provider("glm", { apiKey: "", name: "GLM" })], null);

	assert.equal(providers[0].apiKey, "sk-live");
});

test("a default model the import removed does not stay selected", () => {
	// Same rule as deleting a provider by hand: the next message would otherwise be sent with
	// nothing chosen.
	const here = [provider("glm")];
	const replaced = applyImport(here, [provider("glm", { models: [model("glm", "glm-6")] })], "glm/glm-pro");
	assert.equal(replaced.defaultModelId, "glm/glm-6", "it falls to what is there rather than to nothing");

	const kept = applyImport(here, [provider("xiaoji")], "glm/glm-pro");
	assert.equal(kept.defaultModelId, "glm/glm-pro", "an import that did not touch it leaves it alone");
});

/*
 * 两个同名的供应商，是两行谁也认不出谁。
 *
 * 而且损失会传下去：两个模型同名时，选择器是靠**供应商名**把它们分开的——供应商一旦重名，最后
 * 那点能区分的东西也没了。两个入口都会造出重名：「新供应商」每次按都是同一个名字，而导入带来的
 * 条目在这台机器上 id 是新的、名字却是从另一台带过来的。
 */
test("导入进来的重名供应商会被编号，不会变成两行一模一样的", () => {
	const here = [provider("relay", { name: "Relay" })];
	const { providers } = applyImport(here, [provider("relay-2", { name: "Relay" })], null);

	assert.equal(providers.length, 2);
	assert.equal(providers[0].name, "Relay", "这台机器上原有的那个不改名");
	assert.equal(providers[1].name, "Relay 2");
});

test("同一次导入里带进来的几个同名，彼此之间也要分得开", () => {
	const { providers } = applyImport(
		[],
		[provider("a", { name: "Relay" }), provider("b", { name: "Relay" }), provider("c", { name: "Relay" })],
		null,
	);

	assert.deepEqual(
		providers.map((one) => one.name),
		["Relay", "Relay 2", "Relay 3"],
	);
});

test("覆盖同一个 id 的那条留着自己的名字——它就是那一个，不是重名", () => {
	const here = [provider("relay", { name: "Relay" })];
	const { providers } = applyImport(here, [provider("relay", { name: "Relay" })], null);

	assert.equal(providers.length, 1);
	assert.equal(providers[0].name, "Relay", "别把它跟自己算成重名，改成了「Relay 2」");
});

test("没被占用的名字原样返回，占用了才编号", () => {
	assert.equal(uniqueProviderName([], "新供应商"), "新供应商");
	assert.equal(uniqueProviderName(["新供应商"], "新供应商"), "新供应商 2");
	assert.equal(uniqueProviderName(["新供应商", "新供应商 2"], "新供应商"), "新供应商 3");
	// 前后空格不算另一个名字：列表里看着一样，就是一样。
	assert.equal(uniqueProviderName([" Relay "], "Relay"), "Relay 2");
});
