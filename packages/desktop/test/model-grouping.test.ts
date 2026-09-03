/**
 * Which model is whose, as rules rather than as JSX.
 *
 * The case that motivates all of this is two relays serving the same model under the same name:
 * the menu drew two identical rows and picking either was a coin toss. Every assertion here is
 * about that being impossible now.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ModelConfig, ProviderConfig, Settings } from "@lyra/core";
import {
	ambiguousNames,
	favouriteRows,
	filterGroups,
	flattenGroups,
	groupModels,
	modelIdentity,
	modelTooltip,
	toggleFavourite,
} from "../src/lib/model-grouping.ts";

function model(providerId: string, modelId: string, name: string, extra: Partial<ModelConfig> = {}): ModelConfig {
	return {
		id: `${providerId}/${modelId}`,
		providerId,
		modelId,
		name,
		contextWindow: 128_000,
		maxOutputTokens: 8192,
		supportsThinking: true,
		supportsImages: false,
		supportsTools: true,
		...extra,
	};
}

function provider(id: string, name: string, models: ModelConfig[], enabled = true): ProviderConfig {
	return { id, name, baseUrl: "http://x", api: "openai-responses", apiKey: "k", enabled, models };
}

const BIG = provider("big", "BigModel", [model("big", "glm-5.3", "GLM-5.3"), model("big", "glm-5-turbo", "GLM-5-Turbo")]);
const DEER = provider("deer", "deerGpt", [model("deer", "grok-4.6", "grok-4.6")]);
const RELAY = provider("relay", "Relay", [model("relay", "grok-4.6", "grok-4.6", { supportsImages: true })]);

describe("groupModels", () => {
	it("keeps the configured order rather than inventing one", () => {
		const groups = groupModels([BIG, DEER]);
		assert.deepEqual(
			groups.map((g) => g.provider.id),
			["big", "deer"],
		);
	});

	it("leaves out providers that are switched off", () => {
		const groups = groupModels([BIG, provider("off", "Disabled", [model("off", "m", "M")], false)]);
		assert.deepEqual(
			groups.map((g) => g.provider.id),
			["big"],
		);
	});

	it("leaves out a provider with no models, rather than drawing an empty heading", () => {
		const groups = groupModels([BIG, provider("empty", "Empty", [])]);
		assert.equal(groups.length, 1);
	});

	it("survives having no providers at all", () => {
		assert.deepEqual(groupModels(undefined), []);
		assert.deepEqual(groupModels([]), []);
	});
});

describe("flattenGroups", () => {
	it("walks the groups in drawing order, which is what the number keys count", () => {
		const rows = flattenGroups(groupModels([BIG, DEER]));
		assert.deepEqual(
			rows.map((r) => r.model.id),
			["big/glm-5.3", "big/glm-5-turbo", "deer/grok-4.6"],
		);
		// Each row knows its house, so a pick can never be attributed to the wrong one.
		assert.equal(rows[2].provider.name, "deerGpt");
	});
});

describe("filterGroups", () => {
	const groups = groupModels([BIG, DEER, RELAY]);

	it("an empty query changes nothing, and returns the same groups", () => {
		assert.equal(filterGroups(groups, "").length, 3);
		assert.equal(filterGroups(groups, "   ").length, 3);
	});

	it("matches the model name", () => {
		const found = filterGroups(groups, "turbo");
		assert.deepEqual(found.map((g) => g.provider.id), ["big"]);
		assert.deepEqual(found[0].models.map((m) => m.name), ["GLM-5-Turbo"]);
	});

	it("matches the provider name, keeping all of its models", () => {
		const found = filterGroups(groups, "bigmodel");
		assert.equal(found.length, 1);
		assert.equal(found[0].models.length, 2, "searching for a house shows what the house offers");
	});

	it("ignores case, spaces, dashes and underscores, because ids are written every which way", () => {
		assert.equal(filterGroups(groups, "GLM 5.3")[0]?.models[0]?.name, "GLM-5.3");
		assert.equal(filterGroups(groups, "glm_5.3")[0]?.models[0]?.name, "GLM-5.3");
	});

	it("matches the wire id as well as the label", () => {
		const named = provider("x", "X", [model("x", "claude-opus-5", "写作模型")]);
		const found = filterGroups(groupModels([named]), "opus");
		assert.equal(found[0]?.models[0]?.name, "写作模型");
	});

	it("no match is an empty list, not everything", () => {
		assert.deepEqual(filterGroups(groups, "zzzz"), []);
	});
});

describe("ambiguousNames", () => {
	it("names offered by two providers are flagged", () => {
		const clashes = ambiguousNames(groupModels([DEER, RELAY]));
		assert.ok(clashes.has("grok-4.6"));
	});

	it("a name offered by one provider is not", () => {
		const clashes = ambiguousNames(groupModels([BIG, DEER]));
		assert.equal(clashes.size, 0);
	});

	it("the same provider listing a name twice is not a clash — it is one house either way", () => {
		const twice = provider("dup", "Dup", [model("dup", "a", "Same"), model("dup", "b", "Same")]);
		assert.equal(ambiguousNames(groupModels([twice])).size, 0);
	});

	it("compares on what is displayed, so case and padding do not hide a clash", () => {
		const a = provider("a", "A", [model("a", "m", "Grok 4.6")]);
		const b = provider("b", "B", [model("b", "m", " grok 4.6 ")]);
		assert.equal(ambiguousNames(groupModels([a, b])).size, 1);
	});
});

describe("modelIdentity", () => {
	const settings = { providers: [BIG, DEER, RELAY] } as unknown as Settings;

	it("finds the model and the provider it belongs to", () => {
		const found = modelIdentity(settings, "deer/grok-4.6");
		assert.equal(found?.provider.name, "deerGpt");
		assert.equal(found?.model.name, "grok-4.6");
	});

	it("says when the name alone would not identify it", () => {
		assert.equal(modelIdentity(settings, "deer/grok-4.6")?.ambiguous, true);
		assert.equal(modelIdentity(settings, "relay/grok-4.6")?.ambiguous, true);
		assert.equal(modelIdentity(settings, "big/glm-5.3")?.ambiguous, false);
	});

	it("an id that is not configured is null rather than a guess", () => {
		assert.equal(modelIdentity(settings, "gone/model"), null);
		assert.equal(modelIdentity(settings, null), null);
		assert.equal(modelIdentity(null, "big/glm-5.3"), null);
	});
});

describe("modelTooltip", () => {
	const settings = { providers: [BIG] } as unknown as Settings;

	it("says house, model and window", () => {
		const identity = modelIdentity(settings, "big/glm-5.3");
		assert.equal(modelTooltip(identity, (n) => `${n / 1000}K`), "BigModel · GLM-5.3 · 128K 上下文");
	});

	it("with nothing chosen it asks for a choice", () => {
		assert.equal(modelTooltip(null, String), "选择模型");
	});
});

describe("favouriteRows", () => {
	const groups = groupModels([BIG, DEER]);

	it("keeps the order they were starred in, not the order they are configured in", () => {
		const rows = favouriteRows(groups, ["deer/grok-4.6", "big/glm-5.3"]);
		assert.deepEqual(rows.map((r) => r.model.id), ["deer/grok-4.6", "big/glm-5.3"]);
	});

	it("each row still knows its house, so the shortlist can name it", () => {
		const [row] = favouriteRows(groups, ["deer/grok-4.6"]);
		assert.equal(row.provider.name, "deerGpt");
	});

	it("a star on a model that is no longer configured is skipped, not drawn dead", () => {
		const rows = favouriteRows(groups, ["gone/model", "big/glm-5.3"]);
		assert.deepEqual(rows.map((r) => r.model.id), ["big/glm-5.3"]);
	});

	it("nothing starred is an empty list, which is what hides the section", () => {
		assert.deepEqual(favouriteRows(groups, []), []);
		assert.deepEqual(favouriteRows(groups, undefined), []);
	});

	it("a provider switched off takes its stars out of the shortlist without losing them", () => {
		const off = { ...DEER, enabled: false };
		const rows = favouriteRows(groupModels([BIG, off]), ["deer/grok-4.6", "big/glm-5.3"]);
		assert.deepEqual(rows.map((r) => r.model.id), ["big/glm-5.3"]);
	});
});

describe("toggleFavourite", () => {
	it("adds at the end, so starring something does not reorder what is already there", () => {
		assert.deepEqual(toggleFavourite(["a"], "b"), ["a", "b"]);
	});

	it("removes what is already starred", () => {
		assert.deepEqual(toggleFavourite(["a", "b", "c"], "b"), ["a", "c"]);
	});

	it("starts a list when there is none", () => {
		assert.deepEqual(toggleFavourite(undefined, "a"), ["a"]);
	});

	it("does not mutate the array it was given", () => {
		const before = ["a"];
		toggleFavourite(before, "b");
		assert.deepEqual(before, ["a"]);
	});
});
