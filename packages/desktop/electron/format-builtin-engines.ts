/**
 * 真正内置的格式化器：打包在应用里，不问这台机器装了什么。
 *
 * 在这之前，`gofmt`、`ruff`、`clang-format` 这一类语言走的是 `format-external.ts`——去 PATH 上找
 * 二进制。装了就格式化，没装就告诉你去装。对一个桌面应用来说这是把自己的功能外包给了用户的
 * 环境：同一份代码在我的机器上能格式化，在同事的机器上不能，而两边都没做错什么。
 *
 * 这里的每一个引擎要么是那个官方格式化器的 WebAssembly 构建（ruff、gofmt、clang-format、
 * dart format、swift-format、stylua），要么是纯 JavaScript 实现（prettier 的几个插件、zprint）。
 * 两类都随应用一起分发，在 macOS 和 Windows 上是同一份字节码，跑起来不需要 Python、Go、Clang、
 * JVM 或者别的任何东西。
 *
 * 跑在主进程，不在渲染进程：这些包的 node 入口开箱即用（WASM 自己加载好），而渲染进程那边要为
 * 每个 `.wasm` 配打包规则，还要把几十兆字节塞进界面的包里。界面那边已经有 Prettier 管着
 * JS/CSS/Markdown 那一半，这里补的是另一半。
 *
 * 全部动态 `import`：一个从不打开 Dart 文件的人不该在启动时加载 Dart 的格式化器。
 */

/** 一个引擎：把源码变成格式化后的源码，失败就抛。 */
type Engine = (source: string, filename: string, options: BuiltinFormatOptions) => Promise<string>;

export interface BuiltinFormatOptions {
	tabWidth: number;
	useTabs: boolean;
	printWidth: number;
	semi?: boolean;
	singleQuote?: boolean;
}

/**
 * 加载过的引擎留着。
 *
 * 一个 WASM 模块的实例化是几十毫秒加几兆内存，而格式化是个会被连续触发的动作——保存一次、
 * 再保存一次。每次都重新实例化，等的是同一份字节码编译两遍。
 */
const loaded = new Map<string, Promise<unknown>>();
function load<T>(name: string, loader: () => Promise<T>): Promise<T> {
	const existing = loaded.get(name);
	if (existing) return existing as Promise<T>;
	const started = loader();
	loaded.set(name, started as Promise<unknown>);
	return started;
}

/**
 * Prettier 插件们共用的那一段。
 *
 * 用 `prettier/standalone` 而不是 `prettier`：插件是显式传进去的，而 standalone 不会去磁盘上找
 * 配置文件——项目自己的 `.prettierrc` 由 `format-file.ts` 读过一遍再传下来，在这里再读一次就有
 * 了两个说了算的地方。
 */
async function viaPrettier(
	specifier: string,
	parser: string,
	source: string,
	options: BuiltinFormatOptions,
): Promise<string> {
	const prettier = await load("prettier/standalone", () => import("prettier/standalone"));
	const plugin = await load(specifier, () => import(/* @vite-ignore */ specifier));
	/*
	 * 有的插件把自己挂在 `default` 上，有的就是模块本身。
	 *
	 * `prettier-plugin-sh` 是后者——取 `.default` 得到 `undefined`，然后 Prettier 报的是
	 * 「Couldn't resolve parser」，一句和真正原因毫无关系的话。
	 */
	const resolved = (plugin as { default?: unknown }).default ?? plugin;
	return (prettier as typeof import("prettier/standalone")).format(source, {
		parser,
		plugins: [resolved as never],
		tabWidth: options.tabWidth,
		useTabs: options.useTabs,
		printWidth: options.printWidth,
	});
}

/** `@wasm-fmt/*` 那一族：`format(source, filename, options?)`，文件名用来判断方言。 */
function viaWasmFmt(
	specifier: string,
	filename: string,
	optionsAdapter?: (options: BuiltinFormatOptions) => unknown,
): Engine {
	return async (source, _file, options) => {
		const mod = await load(specifier, () => import(/* @vite-ignore */ specifier));
		const extra = optionsAdapter ? optionsAdapter(options) : undefined;
		const fmt = (mod as { format(src: string, file: string, opt?: unknown): string }).format;
		return extra !== undefined ? fmt(source, filename, extra) : fmt(source, filename);
	};
}

/** clang-format 选项映射：生成风格配置 JSON */
function clangFormatStyle(options: BuiltinFormatOptions): string {
	return JSON.stringify({
		BasedOnStyle: "Google",
		IndentWidth: options.tabWidth,
		TabWidth: options.tabWidth,
		UseTab: options.useTabs ? "Always" : "Never",
		ColumnLimit: options.printWidth,
		AllowShortFunctionsOnASingleLine: { Empty: true, Inline: false, Other: false },
	});
}

/** ruff 选项映射 */
function ruffOptions(options: BuiltinFormatOptions): Record<string, unknown> {
	return {
		indent_style: options.useTabs ? "tab" : "space",
		indent_width: options.tabWidth,
		line_width: options.printWidth,
		...(options.singleQuote !== undefined ? { quote_style: options.singleQuote ? "single" : "double" } : {}),
	};
}

/** lua_fmt (stylua) 选项映射 */
function luaOptions(options: BuiltinFormatOptions): Record<string, unknown> {
	return {
		indent_style: options.useTabs ? "tab" : "space",
		indent_width: options.tabWidth,
		column_width: options.printWidth,
		...(options.singleQuote !== undefined ? { quote_style: options.singleQuote ? "AutoPreferSingle" : "AutoPreferDouble" } : {}),
	};
}

/** 少数几个只收源码、给文件名反而会报配置错的（stylua、swift-format）。 */
function viaWasmFmtNoName(specifier: string): Engine {
	return async (source) => {
		const mod = await load(specifier, () => import(/* @vite-ignore */ specifier));
		return (mod as { format(src: string): string }).format(source);
	};
}

function viaPrettierPlugin(specifier: string, parser: string): Engine {
	return (source, _filename, options) => viaPrettier(specifier, parser, source, options);
}

/*
 * 扩展名 → 引擎。
 *
 * clang-format 一个人顶六种语言（C / C++ / Objective-C / C# / Java / Protobuf），靠的是传给它的
 * 那个文件名后缀——所以这里给每种语言一个**代表性的文件名**，而不是原样把用户的文件名递进去：
 * 用户那个文件可能叫 `Makefile.cpp.txt`，而引擎只认最后那一截。
 */
const ENGINES: Record<string, Engine> = {
	// Python — ruff 的 WASM 构建，支持缩进、行宽与引号设置。
	py: viaWasmFmt("@wasm-fmt/ruff_fmt", "a.py", ruffOptions),
	pyi: viaWasmFmt("@wasm-fmt/ruff_fmt", "a.pyi", ruffOptions),
	python: viaWasmFmt("@wasm-fmt/ruff_fmt", "a.py", ruffOptions),

	// Go — gofmt 本人，编译成 WASM。
	go: viaWasmFmt("@wasm-fmt/gofmt", "a.go"),

	// clang-format 一家六口，映射缩进风格、制表符与行宽。
	c: viaWasmFmt("@wasm-fmt/clang-format", "a.c", clangFormatStyle),
	h: viaWasmFmt("@wasm-fmt/clang-format", "a.h", clangFormatStyle),
	cpp: viaWasmFmt("@wasm-fmt/clang-format", "a.cpp", clangFormatStyle),
	hpp: viaWasmFmt("@wasm-fmt/clang-format", "a.hpp", clangFormatStyle),
	cc: viaWasmFmt("@wasm-fmt/clang-format", "a.cc", clangFormatStyle),
	cxx: viaWasmFmt("@wasm-fmt/clang-format", "a.cxx", clangFormatStyle),
	cs: viaWasmFmt("@wasm-fmt/clang-format", "a.cs", clangFormatStyle),
	java: viaWasmFmt("@wasm-fmt/clang-format", "a.java", clangFormatStyle),
	proto: viaWasmFmt("@wasm-fmt/clang-format", "a.proto", clangFormatStyle),
	protobuf: viaWasmFmt("@wasm-fmt/clang-format", "a.proto", clangFormatStyle),
	m: viaWasmFmt("@wasm-fmt/clang-format", "a.m", clangFormatStyle),
	mm: viaWasmFmt("@wasm-fmt/clang-format", "a.mm", clangFormatStyle),
	// Dart / Lua / Swift — 各自官方格式化器的 WASM 构建。
	dart: viaWasmFmt("@wasm-fmt/dart_fmt", "a.dart"),
	lua: async (source, _file, options) => {
		const mod = await load("@wasm-fmt/lua_fmt", () => import(/* @vite-ignore */ "@wasm-fmt/lua_fmt"));
		return (mod as { format(src: string, opt?: unknown): string }).format(source, luaOptions(options));
	},
	swift: viaWasmFmtNoName("@scalar/swift-fmt"),

	// Prettier 插件，纯 JavaScript。
	php: viaPrettierPlugin("@prettier/plugin-php", "php"),
	toml: viaPrettierPlugin("prettier-plugin-toml", "toml"),
	sh: viaPrettierPlugin("prettier-plugin-sh", "sh"),
	bash: viaPrettierPlugin("prettier-plugin-sh", "sh"),
	zsh: viaPrettierPlugin("prettier-plugin-sh", "sh"),
	fish: viaPrettierPlugin("prettier-plugin-sh", "sh"),
	tex: viaPrettierPlugin("prettier-plugin-latex", "latex-parser"),
	latex: viaPrettierPlugin("prettier-plugin-latex", "latex-parser"),

	// Clojure — zprint 的 ClojureScript 构建，收 `(源码, 选项)`。
	clj: clojure,
	cljs: clojure,
	cljc: clojure,
	edn: clojure,
	clojure,
};

async function clojure(source: string, _file: string, options: BuiltinFormatOptions): Promise<string> {
	const mod = await load("zprint-clj", () => import("zprint-clj"));
	const format = (mod as { default: (src: string, options: object) => string }).default;
	return format(source, { width: options.printWidth });
}

/** 这台机器上有没有内置引擎能管这个扩展名——答案跟机器无关，这正是重点。 */
export function hasBuiltinEngine(extension: string): boolean {
	return extension.toLowerCase() in ENGINES;
}

/** 内置引擎认得的全部扩展名，供界面标注「内置」用。 */
export function builtinEngineExtensions(): string[] {
	return Object.keys(ENGINES);
}

export type BuiltinEngineResult =
	| { ok: true; text: string }
	| { ok: false; reason: "unsupported" }
	/** 引擎跑了，并且拒绝了这份源码——它的报错里通常带着行号。 */
	| { ok: false; reason: "failed"; message: string };

export async function formatWithBuiltinEngine(
	extension: string,
	source: string,
	options: BuiltinFormatOptions,
): Promise<BuiltinEngineResult> {
	const engine = ENGINES[extension.toLowerCase()];
	if (!engine) return { ok: false, reason: "unsupported" };
	try {
		const text = await engine(source, `a.${extension.toLowerCase()}`, options);
		if (typeof text !== "string") return { ok: false, reason: "failed", message: "格式化器没有返回文本" };
		return { ok: true, text };
	} catch (error) {
		return { ok: false, reason: "failed", message: error instanceof Error ? error.message : String(error) };
	}
}
