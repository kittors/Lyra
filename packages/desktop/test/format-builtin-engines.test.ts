/**
 * 内置引擎：不问这台机器装了什么，每种语言都得真的被格式化。
 *
 * 「没报错」不算通过。这里每一条都喂一段**故意写丑**的代码，然后要求输出和输入不同、而且是朝
 * 着规整的方向不同——否则一个原样返回输入的实现也能拿满分，而它在界面上的表现是「点了格式化，
 * 什么也没发生」。
 *
 * 跑得比别的测试慢：第一次碰到某个语言要实例化那个语言的 WASM 模块。这个代价一个会话里只付
 * 一次（`load` 里缓存着），而它换来的是不依赖任何外部二进制。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { builtinEngineExtensions, formatWithBuiltinEngine, hasBuiltinEngine } from "../electron/format-builtin-engines.ts";

const OPTS = { tabWidth: 2, useTabs: false, printWidth: 100 };

/** 一段丑代码，和一个「格式化之后必须出现」的片段。 */
const CASES: [ext: string, label: string, ugly: string, expect: RegExp][] = [
	["py", "Python", "def  f( a,b ):\n  x=[1,2,  3]\n  if a>b :\n        return   x\n  return None\n", /def f\(a, b\):/],
	["go", "Go", 'package main\nimport "fmt"\nfunc main(){x:=1\nfmt.Println( x )}\n', /func main\(\) \{/],
	["c", "C", "int main(){int x=1;if(x>0){return  x;}return 0;}\n", /int main\(\) \{/],
	["cpp", "C++", "#include <vector>\nint main(){std::vector<int> v={1,2,3};return 0;}\n", /int main\(\) \{/],
	["cs", "C#", "class A{public int F(){int x=1;return x;}}\n", /class A \{/],
	["java", "Java", "class A{public static void main(String[] a){int x=1;}}\n", /class A \{/],
	["proto", "Protobuf", 'syntax="proto3";message User{string id=1;}\n', /syntax = "proto3";/],
	["m", "Objective-C", '@implementation A\n-(void)f{int x=1;}\n@end\n', /- \(void\)f \{/],
	["dart", "Dart", "void main(){var x=[1,2,3];for(var i in x){print( i );}}\n", /void main\(\) \{/],
	["lua", "Lua", "local function f(a,b)\nif a>b then\nreturn a\nend\nreturn b\nend\n", /local function f\(a, b\)/],
	["swift", "Swift", "func f(a:Int,b:Int)->Int{if a>b{return a}\nreturn b}\n", /func f\(a: Int, b: Int\) -> Int \{/],
	["php", "PHP", "<?php\nfunction f($a,$b){if($a>$b){return $a;}return $b;}\n", /function f\(\$a, \$b\)/],
	["toml", "TOML", "[a]\nx=1\ny   =    2\n", /x = 1/],
	["sh", "Shell", "if [ 1 -gt 0 ];then\necho hi\nfi\n", /if \[ 1 -gt 0 \]; then/],
	["clj", "Clojure", "(defn f[a b](if(> a b) a b))\n", /\(defn f/],
	["tex", "LaTeX", "\\documentclass{article}\n\\begin{document}\nhi\n\\end{document}\n", /\\begin\{document\}/],
];

test("每种语言都有内置引擎认领，不看这台机器装了什么", () => {
	for (const [ext, label] of CASES) {
		assert.ok(hasBuiltinEngine(ext), `${label} (.${ext}) 没有内置引擎`);
	}
	// 顺带把别名也点一遍：同一门语言换个后缀不该突然没人管。
	for (const ext of ["pyi", "hpp", "cc", "cxx", "h", "mm", "bash", "zsh", "cljs", "latex", "protobuf", "python"]) {
		assert.ok(hasBuiltinEngine(ext), `.${ext} 没有内置引擎`);
	}
});

test("每种语言都被真的格式化了，不是原样退回", async () => {
	for (const [ext, label, ugly, expect] of CASES) {
		const result = await formatWithBuiltinEngine(ext, ugly, OPTS);
		assert.equal(result.ok, true, `${label} (.${ext}) 格式化失败：${result.ok ? "" : ("message" in result ? result.message : result.reason)}`);
		if (!result.ok) continue;
		assert.notEqual(result.text.trim(), ugly.trim(), `${label} 原样退回了输入——等于什么也没做`);
		assert.match(result.text, expect, `${label} 的输出不像被格式化过:\n${result.text.slice(0, 200)}`);
	}
});

test("格式化是幂等的：第二遍不再改动", async () => {
	/*
	 * 不幂等的格式化器每按一次保存都在改文件，diff 永远是脏的。这一条比「输出好不好看」更
	 * 基本，也更容易在换引擎时悄悄丢掉。
	 */
	for (const [ext, label, ugly] of CASES) {
		const once = await formatWithBuiltinEngine(ext, ugly, OPTS);
		if (!once.ok) continue;
		const twice = await formatWithBuiltinEngine(ext, once.text, OPTS);
		assert.equal(twice.ok, true, `${label} 第二遍失败了`);
		if (twice.ok) assert.equal(twice.text, once.text, `${label} (.${ext}) 第二遍又改了一次`);
	}
});

test("会解析的引擎遇到坏语法，给一句带话的失败而不是崩溃", async () => {
	/*
	 * 只挑真的会解析的那几个。
	 *
	 * 引擎在这件事上分两派，而且都是有意为之：`ruff` 和 `gofmt` 建完整的语法树，坏代码进不去，
	 * 报错带行号；`clang-format` 从设计上就容忍不完整的片段——它常被用来格式化一个函数体、一段
	 * 从别处粘来的代码，所以它尽力排版，不做语法校验。
	 *
	 * 这条测试断言的是前一派的行为。对 clang-format 一族断言「必须拒绝」会是在要求它变成另一个
	 * 工具，而那不会让任何人的文件变好。
	 */
	const strict: [string, string][] = [
		["py", "def f(:\n  return"],
		["go", "package main\nfunc main( {"],
	];
	for (const [ext, source] of strict) {
		const result = await formatWithBuiltinEngine(ext, source, OPTS);
		assert.equal(result.ok, false, `.${ext} 的坏语法被当成成功了`);
		if (!result.ok) {
			assert.equal(result.reason, "failed", `.${ext} 应当报 failed`);
			assert.ok("message" in result && result.message.length > 0, `.${ext} 的失败没带任何说明`);
		}
	}
});

test("宽容派引擎不会因为片段不完整就罢工", async () => {
	// clang-format 一族的既定行为：排版一段不完整的代码是它的正当用途，不是它没发现问题。
	const result = await formatWithBuiltinEngine("c", "int main( { return", OPTS);
	assert.equal(result.ok, true, "clang-format 应当尽力排版而不是拒绝");
});

test("没人认领的扩展名明确说 unsupported", async () => {
	const result = await formatWithBuiltinEngine("xyzzy", "whatever", OPTS);
	assert.equal(result.ok, false);
	if (!result.ok) assert.equal(result.reason, "unsupported");
});

test("认领的扩展名清单里没有重复", () => {
	const all = builtinEngineExtensions();
	assert.equal(new Set(all).size, all.length, "扩展名有重复");
	assert.ok(all.length >= 25, `认领的扩展名只有 ${all.length} 个，少于预期`);
});

test("内置引擎尊重传入的格式化选项（缩进与制表符）", async () => {
	// Java (clang-format)
	const javaCode = "class A { void foo() { int x = 1; } }";
	const javaTabs = await formatWithBuiltinEngine("java", javaCode, { tabWidth: 4, useTabs: true, printWidth: 100 });
	assert.equal(javaTabs.ok, true);
	if (javaTabs.ok) assert.ok(javaTabs.text.includes("\t"), "Java 使用制表符应产生 \\t 缩进");

	const javaSpaces = await formatWithBuiltinEngine("java", javaCode, { tabWidth: 2, useTabs: false, printWidth: 100 });
	assert.equal(javaSpaces.ok, true);
	if (javaSpaces.ok) assert.ok(!javaSpaces.text.includes("\t") && javaSpaces.text.includes("  "), "Java 2空格缩进应生效");

	// Python (ruff_fmt)
	const pyCode = "def foo():\n  x = 1\n  return x\n";
	const pyTabs = await formatWithBuiltinEngine("py", pyCode, { tabWidth: 4, useTabs: true, printWidth: 100 });
	assert.equal(pyTabs.ok, true);
	if (pyTabs.ok) assert.ok(pyTabs.text.includes("\t"), "Python tab 缩进应生效");

	const pySpaces = await formatWithBuiltinEngine("py", pyCode, { tabWidth: 2, useTabs: false, printWidth: 100 });
	assert.equal(pySpaces.ok, true);
	if (pySpaces.ok) assert.ok(pySpaces.text.includes("  x = 1"), "Python 2空格缩进应生效");

	// C++ (clang-format)
	const cppCode = "int main() { int x = 1; return x; }";
	const cppTabs = await formatWithBuiltinEngine("cpp", cppCode, { tabWidth: 4, useTabs: true, printWidth: 100 });
	assert.equal(cppTabs.ok, true);
	if (cppTabs.ok) assert.ok(cppTabs.text.includes("\t"), "C++ tab 缩进应生效");

	// Lua (lua_fmt)
	const luaCode = "function f()\nlocal x = 1\nreturn x\nend\n";
	const luaTabs = await formatWithBuiltinEngine("lua", luaCode, { tabWidth: 4, useTabs: true, printWidth: 100 });
	assert.equal(luaTabs.ok, true);
	if (luaTabs.ok) assert.ok(luaTabs.text.includes("\t"), "Lua tab 缩进应生效");
});
