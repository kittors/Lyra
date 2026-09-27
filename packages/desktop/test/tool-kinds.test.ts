/**
 * The one-line summary of a run of tool calls, in each interface language.
 *
 * The parts used to be joined with 「、」 whatever the window was set to, so the English interface read
 * "Read files merge.ts、Created files merge.test.ts" — a Chinese enumeration comma between English
 * words. The Chinese line has to stay exactly as it was; every other language takes its own list
 * punctuation, and none of them gains an "and" before the last part.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ResolvedUiLocale } from "../src/i18n/messages/index.ts";
import { setActiveLocale } from "../src/i18n/translate.ts";
import { describeRun } from "../src/lib/tool-kinds.ts";

const MERGE = [
	{ toolName: "read", subject: "merge.ts" },
	{ toolName: "write", subject: "merge.test.ts" },
];

/** Three kinds, so a conjunction before the last part would have somewhere to appear. */
const THREE = [...MERGE, { toolName: "bash" }, { toolName: "bash" }];

function describedIn(locale: ResolvedUiLocale, calls: { toolName: string; subject?: string }[]): string {
	setActiveLocale(locale);
	try {
		return describeRun(calls);
	} finally {
		setActiveLocale("zh-CN");
	}
}

test("Chinese keeps its enumeration comma", () => {
	assert.equal(describedIn("zh-CN", MERGE), "读取文件 merge.ts、创建文件 merge.test.ts");
	assert.equal(describedIn("zh-CN", THREE), "读取文件 merge.ts、创建文件 merge.test.ts、执行命令 2 个");
});

test("English joins the parts with a comma, not 「、」", () => {
	assert.equal(describedIn("en", MERGE), "Read files merge.ts, Created files merge.test.ts");
	assert.equal(describedIn("en", THREE), "Read files merge.ts, Created files merge.test.ts, Ran commands ×2");
});

test("Japanese and Korean use their own list punctuation", () => {
	assert.equal(describedIn("ja", MERGE), "ファイルを読み取り merge.ts、ファイルを作成 merge.test.ts");
	// Korean writes lists with a Latin comma; `Intl.ListFormat` would put 「및」 before the last part.
	assert.equal(describedIn("ko", THREE), "파일 읽기 merge.ts, 파일 생성 merge.test.ts, 명령 실행 2개");
});

test("Traditional Chinese does not end the line with 「和」", () => {
	assert.equal(describedIn("zh-TW", THREE), "讀取檔案 merge.ts、建立檔案 merge.test.ts、執行命令 2 個");
});

test("French and Russian take the Latin comma too", () => {
	assert.equal(describedIn("fr", MERGE), "Fichiers lus merge.ts, Fichiers créés merge.test.ts");
	assert.equal(describedIn("ru", MERGE), "Чтение файлов merge.ts, Создание файлов merge.test.ts");
});
