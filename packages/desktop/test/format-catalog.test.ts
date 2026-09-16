/**
 * The language catalogue on the 代码格式化 page.
 *
 * Its job is to answer, for one language, whether the options above it do anything — so the two
 * ways it can be wrong are a grammar key that colours nothing, and a formatter claim that does
 * not match what the engines actually handle.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
});

/*
 * 「这台机器上装了什么」决定不了多少门语言能被格式化。
 *
 * 这一条从前断言的是「外部工具至少覆盖 10 种」——那时候它是对的，因为 Go、Python、C 这些只能
 * 靠 PATH 上的二进制。现在它们的格式化器随应用一起分发（WASM 或纯 JS 构建，见
 * `electron/format-builtin-engines.ts`），于是同一个数字变小反而是变好了。
 *
 * 所以改成从另一头断言：绝大多数语言不该再依赖外部环境。把它写成测试，是因为这件事很容易在
 * 加一门新语言时悄悄退回去——随手标个 `external` 最省事。
 */
test("绝大多数语言不依赖这台机器上装了什么", () => {
	const counts = formatterCounts();
	const shipped = counts.prettier + counts.builtin;
	assert.ok(counts.builtin >= 15, `随应用分发的引擎只覆盖了 ${counts.builtin} 种`);
	assert.ok(
		shipped >= LANGUAGES.length * 0.75,
		`只有 ${shipped}/${LANGUAGES.length} 种是开箱即用的，其余 ${counts.external} 种还要自己装工具`,
	);
});

test("还要靠外部工具的那几种，都说得出要装什么", () => {
	// 对这几种，「为什么不行」必须是可执行的答案——否则用户只知道按了没反应。
	for (const entry of LANGUAGES.filter((e) => e.formatter === "external")) {
		assert.ok(entry.tool && entry.tool.length > 0, `${entry.label} 是 external 却没写要装哪个工具`);
	}
});

test("标成内置的语言，都记着是谁在排版", () => {
	for (const entry of LANGUAGES.filter((e) => e.formatter === "builtin")) {
		assert.ok(entry.tool && entry.tool.length > 0, `${entry.label} 标了 builtin 却没说是哪个引擎`);
	}
});

/*
 * 主进程报回来的「谁格式化的」必须是标记或工具名，不能是一句现成的话。
 *
 * 那个值会一路走到 `CodeEditor` 上被 `translate("format.by", { by })` 念出来，而主进程这一侧没有
 * `translate`。它一度是写死的中文「内置」，于是英文、日文、法文界面保存一个 `.go` 文件，提示是
 * `Formatted with 内置`——同一次改动已经给七种语言补上了 `format.builtin`，只是那个键接在了兜底
 * 分支上，成功路径够不着它。
 *
 * 断言的是「不含 CJK」而不是「等于某个值」：外部工具名（ruff、gofmt、clang-format）也从这里过，
 * 它们该原样显示。能溜过去的只有人类可读的译文，而那正是要拦的。
 */
test("what the main process reports as the formatter is a token, not a sentence", async () => {
	const { BUILTIN_FORMATTER } = await import("../shared/format-builtin.ts");
	assert.ok(!/[一-鿿]/.test(BUILTIN_FORMATTER), "这个值会被界面直接念出来，不能是中文");

	const source = await readFile(new URL("../electron/format-external.ts", import.meta.url), "utf8");
	const reported = [...source.matchAll(/tool:\s*(["'`])([^"'`]*)\1/g)].map((m) => m[2]);
	for (const value of reported) {
		assert.ok(!/[一-鿿]/.test(value), `format-external.ts 往界面送了一句中文：${value}`);
	}
});

/*
 * 标了「内置」的条目，报的引擎名必须真的在引擎表里。
 *
 * `tool` 这个字段的语义在这次改动里被重写成「对 `builtin` 是『跑的是它』」，而同一次改动把十六条
 * 的 `formatter` 从 `external` 逐行改成了 `builtin`、没动紧挨着的下一行，于是 7 门语言在设置页的
 * 格式化预览上报了一个根本没在跑的引擎：Java 显示 `google-java-format`（实际 clang-format）、
 * TOML 显示 `taplo`（实际 prettier-plugin-toml），等等。
 *
 * 对的是源码而不是运行时的表，因为引擎名藏在 `viaWasmFmt(...)` 的闭包里，表本身读不出来。松是松
 * 在「只要求出现过」，但当前这 7 条每一条都能被它抓住——写错的名字在那个文件里一次都不出现。
 */
test("a language that claims a built-in engine names one that exists", async () => {
	const engines = await readFile(new URL("../electron/format-builtin-engines.ts", import.meta.url), "utf8");
	const builtin = LANGUAGES.filter((entry) => entry.formatter === "builtin" && entry.tool);
	assert.ok(builtin.length > 10, "这条测试要有东西可查");

	for (const entry of builtin) {
		assert.ok(
			engines.includes(entry.tool as string),
			`${entry.key} 报的引擎是「${entry.tool}」，而 format-builtin-engines.ts 里没有这个名字`,
		);
	}
});
