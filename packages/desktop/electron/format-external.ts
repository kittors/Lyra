/**
 * The formatters that have to be the real thing.
 *
 * Prettier can be taught to print Go, and the result is wrong — not incorrect code, but code no
 * Go programmer would accept, because `gofmt` is not a style preference in that language, it is
 * the style. The same holds for `rustfmt`, and for Python where a project that has settled on
 * `black` or `ruff` expects its exact output. So these run against the actual binary on the
 * machine, and when there is no binary the answer is to say so rather than to approximate it.
 *
 * All of them read stdin and write stdout, which is what makes this one function instead of six:
 * no temporary files, nothing touched on disk, and formatting an unsaved buffer works the same as
 * formatting a saved one.
 */

import { BUILTIN_FORMATTER } from "../shared/format-builtin.ts";
import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { type BuiltinFormatOptions, formatWithBuiltinEngine, hasBuiltinEngine } from "./format-builtin-engines.ts";

interface ExternalFormatter {
	/** Display name, and the binary to look for. */
	command: string;
	args: string[];
	/** Shown when the binary is missing, so the message can say how to get it. */
	install: string;
}

/**
 * Extension to tool. Ordered lists, because these are alternatives.
 *
 * Python is the case that needs the choice: `ruff format` is a drop-in for `black` and much
 * faster, projects have settled on either, and picking one arbitrarily would reformat half the
 * world's files against their own configuration. First one present wins, which follows what the
 * machine already has installed.
 */
const EXTERNAL: Record<string, ExternalFormatter[]> = {
	go: [{ command: "gofmt", args: [], install: "随 Go 一起安装" }],
	rs: [{ command: "rustfmt", args: ["--emit=stdout", "--edition=2021"], install: "rustup component add rustfmt" }],
	py: [
		{ command: "ruff", args: ["format", "-"], install: "pip install ruff" },
		{ command: "black", args: ["-", "-q"], install: "pip install black" },
	],
	pyi: [
		{ command: "ruff", args: ["format", "-"], install: "pip install ruff" },
		{ command: "black", args: ["-", "-q"], install: "pip install black" },
	],
	java: [{ command: "google-java-format", args: ["-"], install: "brew install google-java-format" }],
	sh: [{ command: "shfmt", args: ["-"], install: "brew install shfmt" }],
	bash: [{ command: "shfmt", args: ["-"], install: "brew install shfmt" }],
	zsh: [{ command: "shfmt", args: ["-"], install: "brew install shfmt" }],
	c: [{ command: "clang-format", args: [], install: "brew install clang-format" }],
	h: [{ command: "clang-format", args: [], install: "brew install clang-format" }],
	cpp: [{ command: "clang-format", args: [], install: "brew install clang-format" }],
	hpp: [{ command: "clang-format", args: [], install: "brew install clang-format" }],
	cc: [{ command: "clang-format", args: [], install: "brew install clang-format" }],
	swift: [{ command: "swift-format", args: ["format", "-"], install: "随 Xcode 15+ 一起安装" }],
	kt: [{ command: "ktfmt", args: ["-"], install: "brew install ktfmt" }],
	rb: [{ command: "rubocop", args: ["-a", "--stdin", "file.rb", "--stderr"], install: "gem install rubocop" }],
	php: [{ command: "php-cs-fixer", args: ["fix", "-"], install: "composer global require friendsofphp/php-cs-fixer" }],
	lua: [{ command: "stylua", args: ["-"], install: "brew install stylua" }],
	toml: [{ command: "taplo", args: ["fmt", "-"], install: "brew install taplo" }],
	sql: [{ command: "sql-formatter", args: [], install: "npm i -g sql-formatter" }],
	tf: [{ command: "terraform", args: ["fmt", "-"], install: "brew install terraform" }],
	dart: [{ command: "dart", args: ["format"], install: "随 Dart SDK 一起安装" }],

	/*
	 * Languages that used to be listed as unformattable, and were not — they just had no entry.
	 *
	 * Every one of these reads stdin and writes stdout, which is the only bar for being here. The
	 * ones still absent fail it for a real reason rather than for want of trying: `dotnet format`
	 * and `mix format` need a project on disk, not a buffer; R's `styler`, Julia's `JuliaFormatter`
	 * and PowerShell's `Invoke-Formatter` are libraries that need their language's runtime started
	 * around them. Guessing at those would be running a build system behind someone's back.
	 */
	m: [{ command: "clang-format", args: ["--assume-filename=x.m"], install: "brew install clang-format" }],
	mm: [{ command: "clang-format", args: ["--assume-filename=x.mm"], install: "brew install clang-format" }],
	proto: [
		{ command: "buf", args: ["format", "-"], install: "brew install bufbuild/buf/buf" },
		{ command: "clang-format", args: ["--assume-filename=x.proto"], install: "brew install clang-format" },
	],
	cs: [{ command: "csharpier", args: ["format", "--write-stdout"], install: "dotnet tool install -g csharpier" }],
	scala: [{ command: "scalafmt", args: ["--stdin", "--stdout"], install: "brew install scalafmt" }],
	hs: [
		{ command: "ormolu", args: ["--stdin-input-file", "x.hs"], install: "brew install ormolu" },
		{ command: "fourmolu", args: ["--stdin-input-file", "x.hs"], install: "cabal install fourmolu" },
	],
	clj: [
		{ command: "zprint", args: [], install: "brew install zprint" },
		{ command: "cljfmt", args: ["fix", "-"], install: "brew install cljfmt" },
	],
	cljs: [{ command: "zprint", args: [], install: "brew install zprint" }],
	erl: [{ command: "erlfmt", args: ["-"], install: "rebar3 as fmt escriptize" }],
	perl: [{ command: "perltidy", args: ["-st", "-q"], install: "cpan Perl::Tidy" }],
	pl: [{ command: "perltidy", args: ["-st", "-q"], install: "cpan Perl::Tidy" }],
	tex: [{ command: "latexindent", args: ["-"], install: "随 TeX Live 一起安装" }],
	cmake: [
		{ command: "gersemi", args: ["-"], install: "pip install gersemi" },
		{ command: "cmake-format", args: ["-"], install: "pip install cmakelang" },
	],
};

/**
 * Where to look for a binary.
 *
 * A GUI app on macOS does not inherit the shell's PATH — it gets the bare system one from launchd,
 * which has none of Homebrew, none of the version managers, and none of `~/.cargo/bin`. So
 * `gofmt` is on the machine, on the user's PATH in every terminal they own, and invisible to us.
 * The usual places are searched explicitly to cover it.
 */
function searchPath(): string[] {
	const home = process.env.HOME ?? "";
	const extra = [
		"/opt/homebrew/bin",
		"/usr/local/bin",
		"/usr/bin",
		"/bin",
		join(home, ".cargo/bin"),
		join(home, ".local/bin"),
		join(home, "go/bin"),
		join(home, ".bun/bin"),
		"/opt/homebrew/opt/openjdk/bin",
	];
	return [...(process.env.PATH ?? "").split(delimiter).filter(Boolean), ...extra];
}

const found = new Map<string, string | null>();

/** The binary's full path, or null if it is not on this machine. Cached, including the misses. */
async function locate(command: string): Promise<string | null> {
	const cached = found.get(command);
	if (cached !== undefined) return cached;
	let result: string | null = null;
	for (const directory of searchPath()) {
		const candidate = join(directory, command);
		if (await access(candidate, constants.X_OK).then(() => true, () => false)) {
			result = candidate;
			break;
		}
	}
	found.set(command, result);
	return result;
}

export type ExternalResult =
	| { ok: true; text: string; tool: string }
	| { ok: false; reason: "unsupported" }
	/** The tool exists and rejected the file — its own message, which names the line. */
	| { ok: false; reason: "failed"; message: string; tool: string }
	/** Nothing installed that can do this language; `install` says how to get one. */
	| { ok: false; reason: "missing"; tool: string; install: string };

/**
 * 界面上「这一份是谁格式化的」——内置引擎的那个答案。
 *
 * 不写 `ruff`／`gofmt` 这些具体名字，是因为那会让人去自己机器上找它们。这里跑的是随应用分发的
 * 那一份，装没装都一样。
 *
 * 传一个标记过去，不传现成的话：主进程这一侧没有 `translate`，而这个值会一路走到界面上被念出来。
 * 它原来是中文的「内置」，于是英文界面保存 `.go` 得到 `Formatted with 内置`。翻译在读的那一端做。
 */
const BUILTIN_TOOL = BUILTIN_FORMATTER;

/** Whether anything at all can format this extension — built in, or on the machine. */
export function hasExternalFormatter(extension: string): boolean {
	return hasBuiltinEngine(extension) || extension.toLowerCase() in EXTERNAL;
}

/**
 * Format via whichever tool is installed, or explain what is missing.
 *
 * The timeout is not paranoia: `rubocop` on a large file takes seconds, and a formatter that
 * hangs would otherwise hang the save that triggered it. Ten seconds is far past anything
 * legitimate and far short of "the app is stuck".
 */
export async function formatExternally(extension: string, source: string, options?: BuiltinFormatOptions): Promise<ExternalResult> {
	/*
	 * 先问内置引擎，再去 PATH 上找二进制。
	 *
	 * 顺序是这么定的：内置引擎和外部工具多半是同一个格式化器（ruff 就是 ruff，gofmt 就是
	 * gofmt），输出一致，而内置那份一定在。把它排在后面，等于让「装没装」继续决定功能在不在，
	 * 而那正是这一整块要消掉的东西。
	 *
	 * 装了外部工具的人也没有损失：同一个格式化器的同一个版本线，结果不会打架。真正会打架的是
	 * 项目自带的配置（`rustfmt.toml`、`.clang-format`），而那几种语言要么还在走外部路径，要么
	 * 由引擎自己去读——不是这里该替它决定的事。
	 */
	const builtin = await formatWithBuiltinEngine(extension, source, options ?? { tabWidth: 2, useTabs: false, printWidth: 100 });
	if (builtin.ok) return { ok: true, text: builtin.text, tool: BUILTIN_TOOL };
	/*
	 * 内置引擎明确拒绝了这份源码，就到此为止，不再去试外部工具。
	 *
	 * 语法错误在哪个引擎里都是语法错误，换一个来跑一遍只是把同一句话再说一遍——而它带着行号，
	 * 是此刻最有用的那句话。
	 */
	if (builtin.reason === "failed") return { ok: false, reason: "failed", message: builtin.message, tool: BUILTIN_TOOL };

	const candidates = EXTERNAL[extension.toLowerCase()];
	if (!candidates) return { ok: false, reason: "unsupported" };

	for (const candidate of candidates) {
		const binary = await locate(candidate.command);
		if (!binary) continue;
		const result = await run(binary, candidate.args, source, candidate.command);
		return result;
	}
	const first = candidates[0];
	return { ok: false, reason: "missing", tool: first.command, install: first.install };
}

function run(binary: string, args: string[], source: string, tool: string): Promise<ExternalResult> {
	return new Promise((resolve) => {
		const child = spawn(binary, args, { stdio: ["pipe", "pipe", "pipe"] });
		let out = "";
		let err = "";
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			resolve({ ok: false, reason: "failed", message: `${tool} 超过 10 秒没有返回`, tool });
		}, 10_000);

		child.stdout.on("data", (chunk) => {
			out += chunk;
		});
		child.stderr.on("data", (chunk) => {
			err += chunk;
		});
		child.on("error", (error) => {
			clearTimeout(timer);
			resolve({ ok: false, reason: "failed", message: error.message, tool });
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			/*
			 * A non-zero exit means the file did not parse, and the tool has already said why.
			 *
			 * Its own message is kept verbatim because it is better than anything we could write:
			 * `gofmt` answers with `<standard input>:4:2: expected '}', found 'EOF'`, which is the
			 * line to go to. Replacing that with 「格式化失败」 would throw away the only useful part.
			 */
			if (code !== 0) {
				resolve({ ok: false, reason: "failed", message: err.trim() || `${tool} 退出码 ${code}`, tool });
				return;
			}
			// An empty result on a non-empty input is a tool that misbehaved; keeping the original is
			// the safe reading, since the alternative is silently emptying somebody's file.
			if (!out && source) {
				resolve({ ok: false, reason: "failed", message: `${tool} 返回了空内容`, tool });
				return;
			}
			resolve({ ok: true, text: out, tool });
		});

		child.stdin.on("error", () => {
			/* The child exited before reading its input; `close` above reports it. */
		});
		child.stdin.end(source);
	});
}
