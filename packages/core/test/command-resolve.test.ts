/**
 * `git/commit.md` 同时以 `git:commit` 和 `commit` 可用——验收清单 08 §9。
 *
 * 菜单那边早就这么匹配了，分派那边一直是精确匹配：列表里看得见、回车却找不到。
 * 「菜单里有、按下去没反应」是这个项目里反复出现的一种断线，所以匹配逻辑收进 core 一处，
 * 菜单和分派共用。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveCommand } from "../src/commands/expand.ts";

const cmds = [{ name: "git:commit" }, { name: "git:push" }, { name: "review" }, { name: "svn:commit" }, { name: "deploy:prod" }];

test("精确命中", () => {
	assert.equal(resolveCommand(cmds, "git:commit")?.name, "git:commit");
	assert.equal(resolveCommand(cmds, "review")?.name, "review");
});

test("末段唯一时，短名找到命名空间里的那个", () => {
	assert.equal(resolveCommand(cmds, "push")?.name, "git:push");
	assert.equal(resolveCommand(cmds, "prod")?.name, "deploy:prod");
});

test("末段有歧义时不猜", () => {
	/*
	 * `git:commit` 和 `svn:commit` 同时在，`/commit` 不该悄悄选一个。它原样发给模型，
	 * 跟任何不认识的 `/xxx` 一样——歧义时不猜，是这里唯一的规则。
	 */
	assert.equal(resolveCommand(cmds, "commit"), undefined);
});

test("精确命中优先于末段匹配", () => {
	const both = [{ name: "git:commit" }, { name: "commit" }];
	assert.equal(resolveCommand(both, "commit")?.name, "commit", "顶层的 commit.md 赢，不被命名空间里的抢走");
});

test("带冒号的名字不做末段匹配", () => {
	// `/git:commi` 打错了就是打错了，不该被「末段 commi」之类的逻辑救回来。
	assert.equal(resolveCommand(cmds, "git:commi"), undefined);
});

test("大小写不敏感", () => {
	assert.equal(resolveCommand(cmds, "PUSH")?.name, "git:push");
});

test("找不到就是 undefined，不抛", () => {
	assert.equal(resolveCommand(cmds, "nothing"), undefined);
	assert.equal(resolveCommand([], "x"), undefined);
});
