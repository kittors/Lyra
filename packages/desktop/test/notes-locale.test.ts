/**
 * 发版说明按语言分段，取出的是哪一段。
 *
 * 这套约定要同时活在两个地方——GitHub 的发布页要看到全文，客户端只看见一段——所以「没有标记
 * 时原样返回」和「标记对不上时不留白」是与正确挑中同等重要的两条。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { notesForLocale, splitNotesByLocale } from "../src/features/update/notes-locale.ts";

const MULTI = [
	"<!-- lyra:notes zh-CN -->",
	"## 修好了什么",
	"文件预览的滚动条。",
	"",
	"<!-- lyra:notes en -->",
	"## What's fixed",
	"The file preview scrollbars.",
	"",
	"<!-- lyra:notes ja -->",
	"## 修正内容",
	"ファイルプレビューのスクロールバー。",
].join("\n");

test("挑出读的人那一段，标记本身不出现在结果里", () => {
	assert.equal(notesForLocale(MULTI, "zh-CN"), "## 修好了什么\n文件预览的滚动条。");
	assert.equal(notesForLocale(MULTI, "en"), "## What's fixed\nThe file preview scrollbars.");
	assert.equal(notesForLocale(MULTI, "ja"), "## 修正内容\nファイルプレビューのスクロールバー。");
	assert.ok(!notesForLocale(MULTI, "en").includes("lyra:notes"));
});

test("没写的语言退到英文，而不是留白", () => {
	// 法语、俄语、韩语这一版都没写；英文是这群人的第二语言。
	for (const locale of ["fr", "ru", "ko"] as const) {
		assert.equal(notesForLocale(MULTI, locale), "## What's fixed\nThe file preview scrollbars.");
	}
});

test("繁体先退简体，两种中文之间比退英文近", () => {
	assert.equal(notesForLocale(MULTI, "zh-TW"), "## 修好了什么\n文件预览的滚动条。");
});

test("简体缺席时退繁体", () => {
	const onlyTraditional = "<!-- lyra:notes zh-TW -->\n## 修好了什麼\n檔案預覽的捲軸。";
	assert.equal(notesForLocale(onlyTraditional, "zh-CN"), "## 修好了什麼\n檔案預覽的捲軸。");
});

test("没有标记的正文原样返回——历史上每一个 release 都是这个形状", () => {
	const plain = "## 0.9.2\n\n- 修好了一些东西";
	assert.equal(notesForLocale(plain, "ja"), plain);
	assert.equal(notesForLocale(plain, "zh-CN"), plain);
});

test("空正文就是空的，不去编一段出来", () => {
	assert.equal(notesForLocale("", "en"), "");
	assert.equal(notesForLocale("   \n  ", "en"), "");
});

test("标记齐全但一个都对不上时，给第一段而不是空白", () => {
	const german = "<!-- lyra:notes de -->\n## Behoben\nDie Bildlaufleisten.";
	assert.equal(notesForLocale(german, "ja"), "## Behoben\nDie Bildlaufleisten.");
});

test("同一个语言码写了两次，留先到的那一段", () => {
	const duplicated = [
		"<!-- lyra:notes en -->",
		"first",
		"<!-- lyra:notes en -->",
		"second",
	].join("\n");
	assert.equal(notesForLocale(duplicated, "en"), "first");
});

test("标记之前的前言不属于任何语言，不会混进某一段里", () => {
	const withPreamble = ["感谢所有反馈。", "", "<!-- lyra:notes en -->", "Thanks."].join("\n");
	assert.equal(notesForLocale(withPreamble, "en"), "Thanks.");
});

test("切段的结果按写下的顺序排，且只含有正文的段", () => {
	const sections = splitNotesByLocale(MULTI);
	assert.deepEqual([...sections.keys()], ["zh-CN", "en", "ja"]);
	const empty = "<!-- lyra:notes en -->\n\n<!-- lyra:notes ja -->\nある。";
	assert.deepEqual([...splitNotesByLocale(empty).keys()], ["ja"]);
});

test("没有标记时切出空表，让调用方自己决定怎么办", () => {
	assert.equal(splitNotesByLocale("## 0.9.2\n- 修好了一些东西").size, 0);
});
