/**
 * The language catalogue on the 代码格式化 page.
 *
 * Its job is to answer, for one language, whether the options above it do anything — so the two
 * ways it can be wrong are a grammar key that colours nothing, and a formatter claim that does
 * not match what the engines actually handle.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { LANGUAGES, searchLanguages, formatterCounts } from "../src/features/settings/format-catalog.ts";
import { GRAMMARS } from "../src/lib/code/highlight.ts";
import { canFormat } from "../src/features/editor/format.ts";

test("every entry points at a grammar that exists", () => {
	// A bad key here is invisible until someone picks that language and gets a flat grey sample.
	for (const entry of LANGUAGES) {
		assert.ok(GRAMMARS[entry.key], `${entry.label} 指向了不存在的语法 ${entry.key}`);
	}
});

test("every sample is non-trivial and has a comment to colour", () => {
	for (const entry of LANGUAGES) {
		assert.ok(entry.sample.split("\n").length >= 3, `${entry.label} 的示例太短`);
		assert.ok(entry.sample.trim().length > 40, `${entry.label} 的示例内容太少`);
	}
});

test("what the catalogue calls Prettier, Prettier actually formats", async () => {
	// The claim on screen is 「这些设置对它生效」. If `format.ts` disagrees, that line is a lie.
	for (const entry of LANGUAGES.filter((e) => e.formatter === "prettier")) {
		assert.ok(canFormat(`sample.${entry.aliases[0]}`), `${entry.label} 说走 Prettier，但 canFormat 说不行`);
	}
});

test("what it calls external, Prettier does not claim", () => {
	for (const entry of LANGUAGES.filter((e) => e.formatter === "external")) {
		assert.ok(entry.tool, `${entry.label} 说走外部工具却没写是哪个`);
	}
});

test("no two entries claim the same extension", () => {
	// An extension resolving to two rows makes the picker ambiguous and the support answer random.
	const seen = new Map<string, string>();
	for (const entry of LANGUAGES) {
		for (const alias of entry.aliases) {
			const taken = seen.get(alias);
			assert.ok(!taken, `.${alias} 同时属于 ${taken} 和 ${entry.label}`);
			seen.set(alias, entry.label);
		}
	}
});

test("search finds a language by name, by extension and by tool", () => {
	assert.ok(searchLanguages("vue").some((e) => e.key === "vue"));
	assert.ok(searchLanguages("mts").some((e) => e.key === "ts"), "按扩展名搜不到");
	assert.ok(searchLanguages("gofmt").some((e) => e.key === "go"), "按工具名搜不到");
	assert.ok(searchLanguages("TYPESCRIPT").some((e) => e.key === "ts"), "大小写没忽略");
	assert.equal(searchLanguages("").length, LANGUAGES.length);
	assert.equal(searchLanguages("绝对没有这个").length, 0);
});

test("the catalogue is big enough to be worth searching", () => {
	assert.ok(LANGUAGES.length >= 40, `只有 ${LANGUAGES.length} 种`);
	const counts = formatterCounts();
	assert.ok(counts.prettier >= 10, `Prettier 只覆盖了 ${counts.prettier} 种`);
	assert.ok(counts.external >= 10, `外部工具只覆盖了 ${counts.external} 种`);
});
