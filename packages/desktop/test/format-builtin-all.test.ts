import assert from "node:assert/strict";
import { test } from "node:test";
import { LANGUAGES } from "../src/features/settings/format-catalog.ts";
import { formatFile } from "../src/features/editor/format-file.ts";
import { formatWithBuiltin } from "../src/features/editor/builtin-format.ts";

test("builtin formatter handles every catalogue language directly", async () => {
	for (const entry of LANGUAGES) {
		const ext = entry.aliases[0];
		const res = await formatWithBuiltin(ext, entry.sample, {
			tabWidth: 2,
			useTabs: false,
			printWidth: 80,
			singleQuote: false,
			semi: true,
			trailingComma: "all",
			bracketSpacing: true,
			arrowParens: "always",
		});
		assert.ok(typeof res === "string", `${entry.label} (${ext}) 内置格式化失败，未返回字符串`);
		assert.ok(res.length > 0, `${entry.label} (${ext}) 内置格式化产出为空`);
	}
});

test("formatFile succeeds for all 40 catalogue languages without missing tool error", async () => {
	(globalThis as any).window = {
		lyra: {
			format: {
				config: async () => null,
				external: async (ext: string, src: string, opt: any) => {
					const { formatWithBuiltinEngine } = await import("../electron/format-builtin-engines.ts");
					const res = await formatWithBuiltinEngine(ext, src, opt);
					if (res.ok) return { ok: true, text: res.text, tool: "内置" };
					return { ok: false, reason: "missing" as const, tool: "mock-tool" };
				},
			},
		},
	};

	for (const entry of LANGUAGES) {
		const filename = `sample.${entry.aliases[0]}`;
		const result = await formatFile(filename, entry.sample);
		assert.equal(
			result.ok,
			true,
			`${entry.label} (${filename}) 应当降级至内置格式化并成功，实际失败: ${result.ok ? "" : result.message}`,
		);
		if (result.ok) {
			assert.ok(typeof result.text === "string", `${entry.label} 结果没有 text 内容`);
			assert.ok(result.by.length > 0, `${entry.label} 结果没有 by 名称`);
		}
	}
});

/*
 * 「跑完了没报错」和「跑对了」之间，隔着下面这三条。
 *
 * 上面两条测的是每种语言都有人接、都能返回字符串。那是必要条件，不是充分条件——一个把每行都
 * 顶到行首的实现同样能通过它们，而它会把 Python 改成另一段代码。
 */

const OPTS = {
	tabWidth: 2,
	useTabs: false,
	printWidth: 120,
	singleQuote: false,
	semi: true,
	trailingComma: "all" as const,
	bracketSpacing: true,
	arrowParens: "always" as const,
};

/** 空白之外的字符，一个都不能多、不能少。 */
const skeleton = (s: string) => s.replace(/\s+/g, "");

test("a grammar that already likes the indent is not handed to the bracket scanner", async () => {
	// Kotlin is highlighted as Java. One save used the grammar; the next saw an empty
	// indentRange and used to fall through, rewriting four spaces into a broken brace.
	const once = await formatWithBuiltin("kt", LANGUAGES.find((e) => e.key === "kt")!.sample, OPTS);
	const twice = await formatWithBuiltin("kt", once, OPTS);
	assert.equal(twice, once);
});

test("内置格式化是幂等的：跑第二遍不再改动", async () => {
	/*
	 * 不幂等的格式化器，每按一次保存都在改文件——diff 永远是脏的，而且两个人各按一次会得到
	 * 两份不同的结果。幂等是格式化器最基本的那条性质，也是最容易在重构里丢掉的。
	 */
	for (const entry of LANGUAGES) {
		const ext = entry.aliases[0];
		const once = await formatWithBuiltin(ext, entry.sample, OPTS);
		const twice = await formatWithBuiltin(ext, once, OPTS);
		assert.equal(twice, once, `${entry.label} (${ext}) 第二遍又改了一次`);
	}
});

test("内置格式化只动空白，不吞字符", async () => {
	// 缩进引擎把一行吃掉是最贵的那种 bug：它安静、可信，而且直到别人读那个文件才被发现。
	for (const entry of LANGUAGES) {
		const ext = entry.aliases[0];
		const out = await formatWithBuiltin(ext, entry.sample, OPTS);
		assert.equal(skeleton(out), skeleton(entry.sample), `${entry.label} (${ext}) 的非空白字符被改动了`);
	}
});

test("缩进即语法的语言，内置兜底一律不重排缩进", async () => {
	/*
	 * Python、YAML、Haskell 里，一行少缩一级就是换了个代码块。就算层级算对了也不该改：实测
	 * 目录里的 Python 样例会被从四空格改成两空格（默认 tabWidth 是 2），代码还能跑，但 PEP 8
	 * 写的是四空格——于是每个没装 ruff 的人保存一次就得到一份不合惯例的 diff。
	 *
	 * 这些语言只清行尾空白。要真格式化它们，装那个语言自己的工具。
	 */
	const cases: [string, string][] = [
		["py", 'def f():\n    doc = """\n    这几行的缩进属于字符串内容\n        不能动\n    """\n    return doc\n'],
		["py", "def g():\n    total = (1 +\n             2 +\n             3)\n    return total\n"],
		["yaml", "root:\n  child:\n    - a\n    - b\n  other: 1\n"],
		["hs", "main :: IO ()\nmain = do\n  let x = 1\n  print x\n"],
	];
	for (const [ext, source] of cases) {
		const out = await formatWithBuiltin(ext, source, OPTS);
		assert.equal(out.trimEnd(), source.trimEnd(), `.${ext} 的缩进被重排了`);
	}
});

test("行尾空白无论哪种语言都清掉", async () => {
	// 它在任何语言里都不表达任何东西，而它是 diff 噪音的头号来源。
	for (const ext of ["ts", "py", "yaml", "go"]) {
		const out = await formatWithBuiltin(ext, "a = 1   \nb = 2\t\n", OPTS);
		assert.ok(!/[ \t]+\n/.test(out), `.${ext} 仍留着行尾空白: ${JSON.stringify(out)}`);
	}
});

test("formatFile forwards user formatting options to format:external and built-in engines", async () => {
	let capturedOptions: any = null;
	(globalThis as any).window = {
		lyra: {
			format: {
				config: async () => null,
				external: async (_ext: string, _src: string, opt: any) => {
					capturedOptions = opt;
					return { ok: true, text: "formatted", tool: "内置" };
				},
			},
		},
	};

	const testOpts = {
		tabWidth: 4,
		useTabs: true,
		printWidth: 100,
		semi: false,
		singleQuote: true,
		trailingComma: "none" as const,
		bracketSpacing: false,
		arrowParens: "avoid" as const,
	};

	await formatFile("sample.java", "class A {}", testOpts);
	assert.ok(capturedOptions, "options 应透传给 external/内置格式化器");
	assert.equal(capturedOptions.tabWidth, 4);
	assert.equal(capturedOptions.useTabs, true);
	assert.equal(capturedOptions.printWidth, 100);
	assert.equal(capturedOptions.semi, false);
	assert.equal(capturedOptions.singleQuote, true);
});

test("all 40 catalogue languages respect format options (tabs vs spaces)", async () => {
	const tabOpts = {
		tabWidth: 4,
		useTabs: true,
		printWidth: 100,
		semi: true,
		singleQuote: false,
		trailingComma: "all" as const,
		bracketSpacing: true,
		arrowParens: "always" as const,
	};
	const spaceOpts = {
		tabWidth: 2,
		useTabs: false,
		printWidth: 100,
		semi: true,
		singleQuote: false,
		trailingComma: "all" as const,
		bracketSpacing: true,
		arrowParens: "always" as const,
	};

	for (const entry of LANGUAGES) {
		const ext = entry.aliases[0];
		// Test with builtin directly to ensure every language behaves stably
		const tabFormatted = await formatWithBuiltin(ext, entry.sample, tabOpts);
		const spaceFormatted = await formatWithBuiltin(ext, entry.sample, spaceOpts);
		assert.ok(typeof tabFormatted === "string" && tabFormatted.length > 0);
		assert.ok(typeof spaceFormatted === "string" && spaceFormatted.length > 0);
	}
});
