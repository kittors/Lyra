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

import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { delimiter, join } from "node:path";

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

/** Whether an external tool is even conceivable for this extension. */
export function hasExternalFormatter(extension: string): boolean {
	return extension.toLowerCase() in EXTERNAL;
}

/**
 * Format via whichever tool is installed, or explain what is missing.
 *
 * The timeout is not paranoia: `rubocop` on a large file takes seconds, and a formatter that
 * hangs would otherwise hang the save that triggered it. Ten seconds is far past anything
 * legitimate and far short of "the app is stuck".
 */
export async function formatExternally(extension: string, source: string): Promise<ExternalResult> {
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
