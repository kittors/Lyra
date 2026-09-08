import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILTIN_AGENTS, PREVIOUS_AGENT_NAME, RENAMED_AGENTS, resolveAgentName } from "../src/agents-builtin.ts";
import { agentProfile } from "../src/config/model-roles.ts";
import type { Settings } from "../src/config/settings.ts";

/*
 * 改名之后，旧名还得能找到人。
 *
 * 智能体的名字是**调用名**：模型按它派活，历史会话里存着当时那个名字，用户改过的自定义版本也是按
 * 名字挂在内置定义上的。所以 `fast` → `simple` 不是改个字符串——翻回三天前的会话，那一条 `task`
 * 指向的智能体不能凭空消失。这几条盯着的就是那张别名表还在、还对得上。
 */
test("改过名的内置智能体，旧名仍然解析得到新名", () => {
	for (const [before, after] of Object.entries(RENAMED_AGENTS)) {
		assert.ok(!BUILTIN_AGENTS.some((agent) => agent.name === before), `${before} 应该已经不在内置名单里`);
		assert.ok(BUILTIN_AGENTS.some((agent) => agent.name === after), `${after} 应该在内置名单里`);
		assert.equal(resolveAgentName(before, BUILTIN_AGENTS), after);
	}
});

test("没改过名的原样返回，不认识的也原样返回", () => {
	assert.equal(resolveAgentName("explore", BUILTIN_AGENTS), "explore");
	// 不认识的名字不在这里报错——交给调用方，它才知道该怎么说「可用的有哪些」。
	assert.equal(resolveAgentName("nope", BUILTIN_AGENTS), "nope");
});

test("名单里真有旧名时，别名不抢它", () => {
	/*
	 * 用户完全可以自己定义一个就叫 `fast` 的智能体。别名是「找不到人时再试试」，不是重定向：
	 * 先看名单里有没有这个名字，有就用它，没有才翻表。
	 */
	assert.equal(resolveAgentName("fast", [{ name: "fast" }, ...BUILTIN_AGENTS]), "fast");
});

test("内置智能体不再按模型速度命名", () => {
	/*
	 * `fast`/`deep` 说的是模型跑得多快，其余五个说的是它负责什么——同一张表里两套命名法，读的人
	 * 得先知道 `@fast` 指的是哪一种「快」。而且它们和模型角色名重名，`fast` 的定义里写着
	 * `model: "@fast"`，自己引用自己的同名角色。这条拦住它长回来。
	 */
	for (const speed of ["fast", "deep", "slow", "quick"]) {
		assert.ok(!BUILTIN_AGENTS.some((agent) => agent.name === speed), `「${speed}」是模型有多快，不是这个智能体做什么`);
	}
});

test("改名不会把用户调好的模型退回「随主会话」", () => {
	/*
	 * 派活是「拿旧名找新定义」，读设置是反过来的「拿新名找旧配置」——两个方向都得通。
	 *
	 * 用户给 `fast` 挑过的模型存在 `subAgentProfiles.fast` 里（更早的存在 `modelRoles.fast`），
	 * `simple` 要是不去那儿看一眼，一次改名就把每个人调好的模型悄悄退回默认，而界面上什么都不会说。
	 */
	assert.deepEqual(PREVIOUS_AGENT_NAME, { simple: "fast", reason: "deep" });
	for (const [before, after] of Object.entries(RENAMED_AGENTS)) {
		const byProfile = { subAgentProfiles: { [before]: { modelId: "kept/by-profile" } } } as unknown as Settings;
		assert.equal(agentProfile(byProfile, after).modelId, "kept/by-profile", `${after} 应该读得到 ${before} 的配置`);
	}
	// 更早的那层绑定（角色名和智能体名同名的年代）也要接上。
	const byRole = { modelRoles: { fast: "kept/by-role" } } as unknown as Settings;
	assert.equal(agentProfile(byRole, "simple").modelId, "kept/by-role");
	// 新名下面一旦有东西，就以新的为准——那说明已经迁过了。
	const migrated = { subAgentProfiles: { fast: { modelId: "old" }, simple: { modelId: "new" } } } as unknown as Settings;
	assert.equal(agentProfile(migrated, "simple").modelId, "new");
});
