/**
 * `/skill:<name>`：行首认，嵌在句中也认，另一个命令开头的草稿里不认（07 §4）。
 *
 * 以前只有行首的 `/<name>` 一种写法能到技能——计划写的 `/skill:` 前缀两种形式都不认识。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseInvocation, parseSkillMention, skillNameOf } from "../src/commands/expand.ts";

test("行首：/skill:pdf 后面全是参数，名字去掉前缀后就是技能名", () => {
	const at = parseInvocation("/skill:pdf 把这份合同转成 markdown");
	assert.deepEqual(at, { name: "skill:pdf", rest: "把这份合同转成 markdown" });
	assert.equal(skillNameOf(at!), "pdf");
	assert.equal(skillNameOf({ name: "pdf", rest: "" }), "pdf", "the bare form is unchanged");
});

test("句中：token 拿掉，其余的话就是要求", () => {
	const mid = parseSkillMention("帮我 /skill:pdf 处理一下这个文件");
	assert.deepEqual(mid, { name: "skill:pdf", rest: "帮我 处理一下这个文件" });
	assert.deepEqual(parseSkillMention("最后再 /skill:review"), { name: "skill:review", rest: "最后再" });
	assert.deepEqual(parseSkillMention("/skill:pdf 在行首时不归这里管"), null, "the line-start form is parseInvocation's");
});

test("以另一个 slash 命令开头的草稿里不认", () => {
	assert.equal(parseSkillMention("/commit 用了 /skill:x 的产物"), null);
	assert.deepEqual(parseInvocation("/commit 用了 /skill:x 的产物"), { name: "commit", rest: "用了 /skill:x 的产物" });
});

test("不是 token 的不认：粘在别的字符上、或根本不是 skill 前缀", () => {
	assert.equal(parseSkillMention("路径是 a/skill:pdf 这种"), null);
	assert.equal(parseSkillMention("看看 /skills 目录"), null);
	assert.equal(parseSkillMention("没有任何命令"), null);
});
