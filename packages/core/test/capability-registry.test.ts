/**
 * The merge rules, with providers that return fixed lists.
 *
 * Real directories belong in the provider tests. What is under test here is the arithmetic —
 * who wins, who is recorded as having lost, which removals hold a name and which release it —
 * and a fixture on disk would only make those assertions slower to read and no more true.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { CapabilityRegistry } from "../src/capability/registry.ts";
import type { CapabilityId, CapabilityProvider, DiscoveryContext, Sourced } from "../src/capability/types.ts";

interface Named {
	name: string;
	body?: string;
}

function registry(): CapabilityRegistry {
	return new CapabilityRegistry({ home: "/home/.lyra", userHome: "/home", repoRoot: () => null });
}

/** A provider that hands back the names it was built with. */
function fake(
	id: string,
	priority: number,
	names: string[],
	extra?: Partial<CapabilityProvider<Named>> & { scope?: "builtin" | "user" | "project" },
): CapabilityProvider<Named> {
	return {
		id,
		label: id,
		describe: id,
		priority,
		supplies: ["skill"],
		...extra,
		async load(_kind: CapabilityId, ctx: DiscoveryContext) {
			if (extra?.load) return extra.load(_kind, ctx);
			return {
				items: names.map(
					(name) =>
						({
							name,
							body: id,
							source: { provider: id, providerLabel: id, path: `/${id}/${name}.md`, scope: extra?.scope ?? "project" },
						}) as Sourced<Named>,
				),
			};
		},
	};
}

test("the higher priority provider wins, and the loser points at the winner", async () => {
	const reg = registry();
	reg.register(fake("low", 10, ["deploy"]));
	reg.register(fake("high", 100, ["deploy"]));

	const result = await reg.load<Named>("skill", { cwd: "/p" });

	assert.equal(result.items.length, 1);
	assert.equal(result.items[0].source.provider, "high");
	const loser = result.all.find((item) => item.source.provider === "low");
	assert.ok(loser, "the loser is still listed");
	assert.equal(loser.shadowedBy?.provider, "high", "and names who took it");
	assert.equal(loser.shadowedBy?.path, "/high/deploy.md", "by path, not just by provider");
});

test("equal priorities keep registration order", async () => {
	const reg = registry();
	reg.register(fake("first", 10, ["x"]));
	reg.register(fake("second", 10, ["x"]));

	const result = await reg.load<Named>("skill", { cwd: "/p" });
	assert.equal(result.items[0].source.provider, "first");
});

test("switching off an item id switches off the name, not one file of that name", async () => {
	/*
	 * `disabledItems` is keyed by `skill:deploy`, which every `deploy` shares. That is the intended
	 * reading: the user turned off a name, and promoting a different definition of the same name
	 * would be answering "stop doing this" with "here is someone else's version of it".
	 */
	const reg = registry();
	reg.register(fake("low", 10, ["deploy"]));
	reg.register(fake("high", 100, ["deploy"]));

	const result = await reg.load<Named>("skill", {
		cwd: "/p",
		disabledItems: new Set(["skill:deploy"]),
	});

	assert.equal(result.items.length, 0, "both are gone");
});

test("exclude releases the name; suppress holds it", async () => {
	/*
	 * The distinction that justifies having both. Excluding the winner for an unrelated reason
	 * should let the runner-up serve. Suppressing it should not — the name is spoken for.
	 */
	const a = registry();
	a.register(fake("low", 10, ["deploy"]));
	a.register(fake("high", 100, ["deploy"]));
	const viaExclude = await a.load<Named>("skill", { cwd: "/p", exclude: (item) => item.source.provider === "high" });
	assert.equal(viaExclude.items.length, 1, "the runner-up serves");
	assert.equal(viaExclude.items[0].source.provider, "low");

	const b = registry();
	b.register(fake("low", 10, ["deploy"]));
	b.register(fake("high", 100, ["deploy"]));
	const viaSuppress = await b.load<Named>("skill", { cwd: "/p", suppress: (item) => item.source.provider === "high" });
	assert.equal(viaSuppress.items.length, 0, "the name stays spoken for, so nothing takes its place");
	assert.ok(
		viaSuppress.all.some((item) => item.source.provider === "low" && item.shadowedBy?.provider === "high"),
		"and the runner-up is recorded as shadowed by the suppressed one",
	);
});

test("a provider that throws costs only its own items", async () => {
	const reg = registry();
	reg.register(fake("good", 100, ["a", "b"]));
	reg.register({
		id: "broken",
		label: "坏掉的来源",
		describe: "x",
		priority: 50,
		supplies: ["skill"],
		async load() {
			throw new Error("directory is on fire");
		},
	});

	const result = await reg.load<Named>("skill", { cwd: "/p" });

	assert.deepEqual(
		result.items.map((i) => i.name),
		["a", "b"],
		"the healthy provider is unaffected",
	);
	const reported = result.diagnostics.find((d) => d.path === "broken");
	assert.ok(reported, "the failure is reported");
	assert.equal(reported.severity, "error");
	assert.match(reported.message, /on fire/, "with the reason");
	assert.match(reported.message, /坏掉的来源/, "and the human name of the source");
});

test("only: restricts to the named providers", async () => {
	const reg = registry();
	reg.register(fake("native", 100, ["a"]));
	reg.register(fake("cursor", 50, ["b"], { foreign: true }));

	const result = await reg.load<Named>("skill", { cwd: "/p", only: new Set(["cursor"]) });
	assert.deepEqual(
		result.items.map((i) => i.name),
		["b"],
	);
});

test("a foreign provider is told whether its user-level directory is in play", async () => {
	const seen: boolean[] = [];
	const probe: CapabilityProvider<Named> = {
		id: "cursor",
		label: "Cursor",
		describe: "x",
		priority: 50,
		supplies: ["skill"],
		foreign: true,
		async load(_kind, ctx) {
			seen.push(ctx.userSourceEnabled);
			return { items: [] };
		},
	};

	const off = registry();
	off.register(probe);
	await off.load<Named>("skill", { cwd: "/p" });
	assert.equal(seen.at(-1), false, "off by default — your private Cursor rules do not follow you into a repo");

	const on = registry();
	on.register(probe);
	await on.load<Named>("skill", { cwd: "/p", enabledUserSources: new Set(["cursor"]) });
	assert.equal(seen.at(-1), true, "on once opted into");

	const named = registry();
	named.register(probe);
	await named.load<Named>("skill", { cwd: "/p", only: new Set(["cursor"]) });
	assert.equal(seen.at(-1), true, "asking for it by name is asking to look at it");
});

test("a native provider always reads its user-level directory", async () => {
	let seen: boolean | undefined;
	const reg = registry();
	reg.register({
		id: "native",
		label: "Lyra",
		describe: "x",
		priority: 100,
		supplies: ["skill"],
		async load(_kind, ctx) {
			seen = ctx.userSourceEnabled;
			return { items: [] };
		},
	});
	await reg.load<Named>("skill", { cwd: "/p" });
	assert.equal(seen, true, "our own home directory is not an import from a foreign tool");
});

test("an item with no source is dropped and reported rather than crashing the merge", async () => {
	const reg = registry();
	reg.register({
		id: "sloppy",
		label: "Sloppy",
		describe: "x",
		priority: 10,
		supplies: ["skill"],
		async load() {
			return { items: [{ name: "x" } as unknown as Sourced<Named>] };
		},
	});

	const result = await reg.load<Named>("skill", { cwd: "/p" });
	assert.equal(result.items.length, 0);
	assert.ok(result.diagnostics.some((d) => /没有 source/.test(d.message)));
});

test("an invalid item is reported and still holds its name", async () => {
	/*
	 * Letting a lower-priority definition serve in place of a rejected one answers "why is my
	 * broken skill not running" by running a different skill, which is worse than running none.
	 */
	const reg = new CapabilityRegistry({
		home: "/h",
		userHome: "/home",
		repoRoot: () => null,
		capabilities: {
			skill: {
				id: "skill",
				key: (item: Named) => item.name,
				itemId: (item: Named) => `skill:${item.name}`,
				validate: (item: Named) => (item.body === "high" ? "这个技能缺少必需的字段。" : undefined),
			} as never,
		},
	});
	reg.register(fake("low", 10, ["deploy"]));
	reg.register(fake("high", 100, ["deploy"]));

	const result = await reg.load<Named>("skill", { cwd: "/p" });

	assert.equal(result.items.length, 0, "the runner-up does not quietly serve in the rejected one's place");
	const reported = result.diagnostics.find((d) => d.path === "/high/deploy.md");
	assert.ok(reported, "the invalid one is named by path");
	assert.equal(reported.severity, "error");
	assert.ok(
		result.all.some((item) => item.source.provider === "low" && item.shadowedBy?.provider === "high"),
		"and the runner-up is listed as shadowed by it, so the settings page can explain the silence",
	);
});

test("contributors, timings and watched directories come back", async () => {
	const reg = registry();
	reg.register({
		id: "native",
		label: "Lyra",
		describe: "x",
		priority: 100,
		supplies: ["skill"],
		async load() {
			return {
				items: [{ name: "a", source: { provider: "native", providerLabel: "Lyra", path: "/a", scope: "project" } } as Sourced<Named>],
				watched: ["/p/.lyra/skills"],
			};
		},
	});
	reg.register(fake("empty", 50, []));

	const result = await reg.load<Named>("skill", { cwd: "/p" });

	assert.deepEqual(result.contributors, ["native"], "a provider that found nothing did not contribute");
	assert.deepEqual(result.watched, ["/p/.lyra/skills"]);
	assert.equal(result.timings.length, 2, "both were timed, including the one that found nothing");
	assert.ok(result.elapsedMs >= 0);
});

test("registering the same provider id twice is refused", async () => {
	const reg = registry();
	reg.register(fake("native", 100, []));
	assert.throws(() => reg.register(fake("native", 90, [])), /already registered/);
});

test("a disposer removes the provider", async () => {
	const reg = registry();
	const off = reg.register(fake("native", 100, ["a"]));
	assert.equal((await reg.load<Named>("skill", { cwd: "/p" })).items.length, 1);
	off();
	assert.equal((await reg.load<Named>("skill", { cwd: "/p" })).items.length, 0);
});

test("providers are listed per kind", async () => {
	const reg = registry();
	reg.register(fake("native", 100, [], { supplies: ["skill", "command"] }));
	reg.register(fake("cursor", 50, [], { supplies: ["rule"], foreign: true }));

	assert.deepEqual(
		reg.providersFor("skill").map((p) => p.id),
		["native"],
	);
	assert.deepEqual(
		reg.providersFor("rule").map((p) => p.id),
		["cursor"],
	);
	assert.equal(reg.providersFor("rule")[0].foreign, true);
	assert.equal(reg.providersFor().length, 2, "no kind means all of them");
});
