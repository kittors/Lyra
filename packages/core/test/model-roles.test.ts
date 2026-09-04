/**
 * Model roles: what `@fast` means here, and what happens when it means nothing.
 *
 * The failure worth designing against is a shared agent definition that names a model the person
 * who installed it does not have. Falling through to the session's model is deliberate — a
 * definition listing three preferences, none configured, should still run rather than fail on a
 * preference.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseModelRef, resolveModelRef, roleStatus } from "../src/config/model-roles.ts";
import { DEFAULT_SETTINGS, type Settings } from "../src/config/settings.ts";
import type { ModelConfig, ProviderConfig } from "../src/types.ts";

function model(id: string): ModelConfig {
	return {
		id,
		providerId: "p",
		modelId: id.split("/").pop()!,
		name: id,
		contextWindow: 100_000,
		maxOutputTokens: 4096,
		supportsThinking: true,
		supportsImages: false,
		supportsTools: true,
	};
}

const PROVIDER: ProviderConfig = {
	id: "p",
	name: "P",
	baseUrl: "http://localhost",
	api: "openai-responses",
	apiKey: "x",
	enabled: true,
	models: [model("p/big"), model("p/small"), model("p/other-family"), model("p/kimi:256k")],
};

function settings(roles?: Settings["modelRoles"]): Settings {
	return { ...DEFAULT_SETTINGS, providers: [PROVIDER], mcpServers: [], modelRoles: roles };
}

const FALLBACK = { provider: PROVIDER, model: model("p/session") };

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

test("@role is a role; anything else is an id", () => {
	assert.deepEqual(parseModelRef("@fast"), { role: "fast", thinking: undefined });
	assert.deepEqual(parseModelRef("p/big"), { id: "p/big" });
});

test("a thinking suffix is split off", () => {
	assert.deepEqual(parseModelRef("@deep:high"), { role: "deep", thinking: "high" });
	assert.deepEqual(parseModelRef("p/big:low"), { id: "p/big", thinking: "low" });
});

test("a colon inside a model id is not a thinking suffix", () => {
	/*
	 * `kimi-k3:256k` is a real id on this machine. Taking every colon as a suffix would turn a
	 * valid model into one that cannot be found, which surfaces as a sub-agent silently running on
	 * the wrong model.
	 */
	assert.deepEqual(parseModelRef("p/kimi:256k"), { id: "p/kimi:256k" });
});

test("@ followed by something that is not a role is treated as an id", () => {
	assert.deepEqual(parseModelRef("@nonsense"), { id: "nonsense", thinking: undefined });
});

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

test("a configured role resolves to its model", () => {
	const resolved = resolveModelRef(settings({ fast: "p/small" }), "@fast", FALLBACK);
	assert.equal(resolved.model.id, "p/small");
	assert.equal(resolved.via, "@fast");
});

test("an unconfigured role falls through to the session's model", () => {
	const resolved = resolveModelRef(settings({}), "@fast", FALLBACK);
	assert.equal(resolved.model.id, "p/session");
	assert.match(resolved.via, /会话/);
});

test("a role pointing at a model that no longer exists falls through too", () => {
	/*
	 * A provider can be removed after a role was set. Failing the dispatch over it would break
	 * delegation for a preference, so the run continues on the session's model.
	 */
	const resolved = resolveModelRef(settings({ fast: "p/deleted" }), "@fast", FALLBACK);
	assert.equal(resolved.model.id, "p/session");
});

test("a list is tried in order, and the first that exists wins", () => {
	const resolved = resolveModelRef(settings({}), ["@fast", "p/missing", "p/big"], FALLBACK);
	assert.equal(resolved.model.id, "p/big", "the role is unset and the second entry is absent");
	assert.equal(resolved.via, "p/big");
});

test("no reference at all is the session's model", () => {
	assert.equal(resolveModelRef(settings({}), undefined, FALLBACK).model.id, "p/session");
});

test("the thinking suffix survives resolution", () => {
	const resolved = resolveModelRef(settings({ deep: "p/big" }), "@deep:high", FALLBACK);
	assert.equal(resolved.model.id, "p/big");
	assert.equal(resolved.thinking, "high");
});

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

test("a role pointing nowhere is reported as not resolving", () => {
	/*
	 * Worse than an empty role: the settings page shows a model, the agents fall through to a
	 * different one, and nothing says the two disagree.
	 */
	const status = roleStatus(settings({ fast: "p/deleted", deep: "p/big" }));
	assert.equal(status.find((s) => s.role === "fast")?.resolves, false);
	assert.equal(status.find((s) => s.role === "deep")?.resolves, true);
	assert.equal(status.find((s) => s.role === "review")?.id, undefined);
});
