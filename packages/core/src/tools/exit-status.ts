/**
 * What a non-zero exit status means — which is not always "it failed".
 *
 * `grep` exits 1 when nothing matched, `diff` when the files differ, `[ -f x ]` when there is no x,
 * and `gh pr checks` exits 8 while checks are still running. Each of those is the command doing
 * exactly what it was asked and reporting the answer through the only channel a process has. The
 * tool used to call every one of them a failure, and the transcript showed it: a column of red
 * crosses down a session that was polling CI, where nothing had gone wrong at all. Replaying one
 * user's sessions, 13 of the 59 commands reported as failed with an exit code were answers of this
 * kind — nine of them `gh pr checks` saying "pending" or "failed", four a `grep` finding nothing.
 *
 * So the status is read the way a person reads it — by which command produced it. A shell line's
 * status is its last command's, except that `a && b` can end on `a`: the candidates are the last
 * pipeline and every pipeline chained to it by `&&`. A status counts as an answer only when every
 * candidate either declares that status an answer or could not have produced it (an `echo`, a `cd`
 * that printed no error). One candidate that might have really failed is enough to say it failed.
 *
 * Anything the reading cannot follow — a loop, an `if`, a subshell, a function, `set -e` — is
 * reported as a failure, which is what it always was. The table below only ever takes red crosses
 * away from cases it understands; it never invents one, and it never hides one it is unsure about.
 */

import { sequence, splitWords, type SequenceEntry } from "./shell-split.ts";

export interface ExitReading {
	/** Whether the command should be reported as having failed. */
	failed: boolean;
	/** What the status means, in a few words, when that is known. English: it is read by the model. */
	meaning?: string;
}

/** Returns the meaning when `code` is an answer rather than a failure for this command. */
type Rule = (args: string[], code: number, output: string) => string | undefined;

const noMatch: Rule = (_, code) => (code === 1 ? "no matches" : undefined);
const differ: Rule = (_, code) => (code === 1 ? "the inputs differ" : undefined);
const falsy: Rule = (_, code) => (code === 1 ? "the condition is false" : undefined);
const notFound: Rule = (_, code) => (code === 1 ? "not found" : undefined);
const noProcess: Rule = (_, code) => (code === 1 ? "no process matched" : undefined);
const has = (args: string[], ...flags: string[]) => args.some((arg) => flags.includes(arg) || flags.some((flag) => flag.startsWith("--") && arg.startsWith(`${flag}=`)));

/** One row of `gh pr checks` output, tab-separated, or its `--json` form. */
const CHECK_ROWS = /^[^\t\n]+\t(pass|fail|pending|skipping|cancel|neutral)\t/m;

const RULES: Record<string, Rule> = {
	grep: noMatch,
	egrep: noMatch,
	fgrep: noMatch,
	zgrep: noMatch,
	rg: noMatch,
	ag: noMatch,
	ack: noMatch,
	diff: differ,
	cmp: differ,
	colordiff: differ,
	test: falsy,
	"[": falsy,
	"[[": falsy,
	which: notFound,
	type: notFound,
	pgrep: noProcess,
	pidof: noProcess,
	pkill: noProcess,
	killall: noProcess,
	/*
	 * `find` exits 1 when any path could not be read, having searched the rest. `find / -name x
	 * 2>/dev/null` is written precisely because of that, and still ends in a 1. An answer when it
	 * printed something besides its own complaints; a failure when that was all it printed.
	 */
	find: (_, code, output) =>
		code === 1 && output.split("\n").some((line) => line.trim() && !line.startsWith("find: "))
			? "some paths could not be read; the rest were searched"
			: undefined,
	// `lsof -i :3000` is how "is anything on that port" is asked, and "no" is exit 1 with no output.
	lsof: (_, code, output) => (code === 1 && !output.trim() ? "nothing matched" : undefined),
	// `kill -0 <pid>` asks whether a process exists.
	kill: (args, code) => (code === 1 && args.includes("-0") ? "the process is not running" : undefined),
	// `nc -z host port` asks whether something listens there.
	nc: (args, code) => (code === 1 && args.some((arg) => /^-[a-zA-Z]*z/.test(arg)) ? "nothing is listening" : undefined),
	// `jq -e` turns a false or null result into exit 1.
	jq: (args, code) => (code === 1 && has(args, "-e", "--exit-status") ? "the result is false or null" : undefined),
	expr: (_, code) => (code === 1 ? "the result is zero or empty" : undefined),
	npm: (args, code) => (code === 1 && args[0] === "outdated" ? "some packages are outdated" : undefined),
	pnpm: (args, code) => (code === 1 && args[0] === "outdated" ? "some packages are outdated" : undefined),
	yarn: (args, code) => (code === 1 && args[0] === "outdated" ? "some packages are outdated" : undefined),
	systemctl: (args, code) =>
		code !== 0 && ["is-active", "is-enabled", "is-failed"].includes(args[0] ?? "") ? `the answer to ${args[0]} is no` : undefined,
	git: (args, code, output) => {
		const sub = gitSubcommand(args);
		if (!sub) return undefined;
		const rest = args.slice(args.indexOf(sub) + 1);
		if (sub === "grep") return noMatch(rest, code, output);
		if ((sub === "diff" || sub === "diff-index" || sub === "diff-files") && code === 1 && has(rest, "--quiet", "--exit-code", "--no-index")) {
			return "there are differences";
		}
		if (sub === "merge-base" && code === 1 && rest.includes("--is-ancestor")) return "not an ancestor";
		if (sub === "check-ignore" && code === 1) return "not ignored";
		if (sub === "ls-remote" && code === 2 && rest.includes("--exit-code")) return "no matching refs";
		if ((sub === "show-ref" || sub === "rev-parse") && code === 1 && has(rest, "--quiet", "-q", "--verify", "--exists")) return "the ref does not exist";
		if (sub === "show-ref" && code === 2 && rest.includes("--exists")) return "the ref does not exist";
		if (sub === "config" && code === 1 && !output.trim()) return "the key is not set";
		return undefined;
	},
	gh: (args, code, output) => {
		if (args[0] !== "pr" || args[1] !== "checks") return undefined;
		// The report is the table; without one, the exit status is about something else.
		if (!CHECK_ROWS.test(output) && !/"(bucket|state)"\s*:/.test(output)) return undefined;
		if (code === 8) return "some checks are still pending";
		if (code === 1) return "some checks failed";
		return undefined;
	},
};

/** Commands that cannot be where a non-zero status came from. */
const SILENT = new Set(["echo", "printf", "true", ":", "sleep"]);

/** Words that mean the line is a construct this reading does not follow. */
const CONSTRUCTS = new Set([
	"if", "then", "elif", "else", "fi", "for", "while", "until", "do", "done", "case", "esac",
	"select", "function", "{", "}", "!", "coproc", "exit", "return",
]);

/** `git -C dir --no-pager diff` — the subcommand after the global options. */
function gitSubcommand(args: string[]): string | undefined {
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "-C" || arg === "-c" || arg === "--git-dir" || arg === "--work-tree" || arg === "--namespace") {
			i++;
			continue;
		}
		if (arg.startsWith("-")) continue;
		return arg;
	}
	return undefined;
}

/**
 * The program a command runs and its arguments, past assignments and the wrappers that pass the
 * status through: `FOO=1 env -i timeout 30 grep x` is `grep x`.
 */
function program(text: string): { name: string; args: string[] } | undefined {
	const words = splitWords(text);
	let i = 0;
	const skipAssignments = () => {
		while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i++;
	};
	const skipOptions = (valued: string[] = []) => {
		while (i < words.length && words[i].startsWith("-")) {
			if (valued.includes(words[i])) i++;
			i++;
		}
	};
	skipAssignments();
	for (;;) {
		const word = words[i];
		if (word === undefined) return undefined;
		if (word === "env") {
			i++;
			skipOptions(["-u", "-S", "-C"]);
			skipAssignments();
		} else if (word === "command" || word === "builtin" || word === "exec") {
			// `command -v x` is a question, and `which` answers it the same way.
			if (words[i + 1] === "-v" || words[i + 1] === "-V") return { name: "which", args: words.slice(i + 2) };
			i++;
		} else if (word === "nice" || word === "nohup" || word === "time" || word === "stdbuf") {
			i++;
			skipOptions(["-n"]);
		} else if (word === "sudo") {
			i++;
			skipOptions(["-u", "-g", "-C", "-D", "-h", "-p", "-U"]);
		} else if (word === "timeout") {
			i++;
			skipOptions(["-s", "-k", "--signal", "--kill-after"]);
			i++;
		} else break;
	}
	const name = words[i].split("/").pop() ?? words[i];
	return { name, args: words.slice(i + 1) };
}

/** Pipelines, each a list of commands, with the operator that follows each pipeline. */
function andOrTail(entries: SequenceEntry[]): { stages: string[]; before?: SequenceEntry["after"] }[] | undefined {
	const pipelines: { stages: string[]; after: SequenceEntry["after"] }[] = [];
	let stages: string[] = [];
	for (const entry of entries) {
		stages.push(entry.text);
		if (entry.after === "|") continue;
		pipelines.push({ stages, after: entry.after });
		stages = [];
	}
	if (stages.length) pipelines.push({ stages, after: "end" });
	const last = pipelines[pipelines.length - 1];
	// A line that ends by sending its last command to the background exits 0.
	if (!last || last.after === "&") return undefined;
	/*
	 * The last pipeline, and every one chained to it by `&&`: in `a && b`, a failing `a` is the
	 * status and `b` never ran. A `||` stops the walk — in `a || b`, a failing `a` runs `b`.
	 */
	const tail = [last];
	for (let k = pipelines.length - 2; k >= 0 && pipelines[k].after === "&&"; k--) tail.push(pipelines[k]);
	return tail.map((pipeline) => ({ stages: pipeline.stages }));
}

/**
 * Read a finished command's exit status.
 *
 * `shell` is the kind of shell it ran in: only POSIX shells are read, because a PowerShell line
 * has a different grammar and its own idea of exit codes.
 */
export function readExit(command: string, code: number | null, output: string, shell: "posix" | "powershell" = "posix"): ExitReading {
	if (code === 0) return { failed: false };
	if (code === null || shell !== "posix") return { failed: true };
	// `set -e` ends the line at the first failure, wherever it is; `pipefail` widens a pipeline.
	if (/\bset\s+(-[a-zA-Z]*e[a-zA-Z]*\b|-o\s+errexit\b)/.test(command)) return { failed: true };
	const pipefail = /\bpipefail\b/.test(command);

	const tail = andOrTail(sequence(command));
	if (!tail) return { failed: true };

	let meaning: string | undefined;
	for (const pipeline of tail) {
		const deciding = pipefail ? pipeline.stages : [pipeline.stages[pipeline.stages.length - 1]];
		for (const text of deciding) {
			if (/^[({]/.test(text)) return { failed: true };
			const run = program(text);
			if (!run || CONSTRUCTS.has(run.name) || /^\w+\(\)/.test(text)) return { failed: true };
			if (SILENT.has(run.name)) continue;
			// A `cd` that failed says so; one that printed nothing did not fail.
			if (run.name === "cd" || run.name === "pushd") {
				if (new RegExp(`\\b${run.name}: `).test(output)) return { failed: true };
				continue;
			}
			const answer = RULES[run.name]?.(run.args, code, output);
			if (answer === undefined) return { failed: true };
			meaning ??= answer;
		}
	}
	return meaning === undefined ? { failed: true } : { failed: false, meaning };
}

/**
 * What the shell's own conventions say about a status, for the line the model reads.
 *
 * 126 and 127 are the shell refusing before anything ran, and 128+N is death by signal N — the
 * difference between "the tests failed" and "the tests were killed, probably for memory" is one the
 * model should not have to remember.
 */
export function describeStatus(code: number | null, signal?: string | null): string {
	if (code === null) return signal ? `terminated by ${signal}` : "terminated without an exit code";
	if (code === 126) return "exit code 126: not executable";
	if (code === 127) return "exit code 127: command not found";
	if (code > 128 && code < 160) {
		const name = SIGNALS[code - 128];
		return name ? `exit code ${code}: killed by ${name}` : `exit code ${code}`;
	}
	return `exit code ${code}`;
}

const SIGNALS: Record<number, string> = {
	1: "SIGHUP",
	2: "SIGINT",
	3: "SIGQUIT",
	6: "SIGABRT",
	9: "SIGKILL (often: out of memory)",
	11: "SIGSEGV",
	13: "SIGPIPE",
	15: "SIGTERM",
};
