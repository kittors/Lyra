import { beforeCommand, afterCommand } from "./command-changes.ts";
import { createOutputLog } from "./output-log.ts";
import { randomUUID } from "node:crypto";
import { backgroundJobs, type BackgroundJob } from "./background-jobs.ts";
import { rerouteShellCommand, TOOL_NAMES_KEY } from "./reroute.ts";
import { getSandbox, looksDenied, looksNetworkDenied } from "../sandbox/index.ts";
import {
	approveEscalation,
	escalationHint,
	ESCALATION_TARGETS,
	networkDenialMarker,
	sandboxDenialMarker,
	validateEscalationArgs,
} from "./escalation.ts";
import { errorResult } from "../agent/tool-run.ts";
import type { Tool, ToolContext, ToolResult } from "../types.ts";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const MAX_OUTPUT_CHARS = 60_000;
/** How often streaming output is forwarded to whoever is watching. See `execute`'s ticker. */
const PROGRESS_INTERVAL_MS = 100;

interface BashArgs {
	command: string;
	description?: string;
	timeout?: number;
	run_in_background?: boolean;
	/** The wider sandbox mode this command needs; only valid retrying one the sandbox denied. */
	escalate?: string;
	/** Why that wider mode is needed, in one sentence, shown to the user verbatim. */
	justification?: string;
}

/**
 * Commands that are never worth an approval prompt: they read state and cannot mutate the
 * workspace. Anything not on this list goes through `requestApproval`.
 *
 * Read this as the strongest claim in the file, because that is what it is. A `true` from
 * `isReadOnlyCommand` does not mean "probably fine" — it means the command never reaches
 * `requestApproval` at all, so it is not judged by `assessCommand` either, in any permission mode.
 * It is the one path around the whole risk classifier, and it had no tests.
 *
 * So the bar for being on this list is that the program cannot change anything *whatever its
 * arguments are*. Four kinds of entry were on it that do not meet that bar:
 *
 *   `env`      — `env FOO=1 rm -rf ~` is `rm`, and the first word is `env`
 *   `find`     — `find . -delete` deletes, and `-exec` runs anything
 *   `node` and every other interpreter — they run a file, which can do anything
 *   `npm run`  — runs whatever the package says; `git stash` moves the working tree
 *
 * None of them needs a shell metacharacter, so the guard below never saw any of them.
 */
const READ_ONLY_COMMANDS = new Set([
	"ls", "pwd", "echo", "cat", "head", "tail", "wc", "which", "whoami", "date",
	"grep", "rg", "fd", "tree", "du", "df", "stat", "file", "basename", "dirname",
]);

const READ_ONLY_SUBCOMMANDS: Record<string, Set<string>> = {
	// `stash` is gone: it takes the working tree away, which is the thing `git reset` is asked
	// about. `config` stays only for the forms that read — see `WRITES_ANYWAY`.
	git: new Set(["status", "log", "diff", "show", "branch", "remote", "config", "ls-files", "rev-parse", "blame"]),
	// `run` is gone: `npm run build` executes whatever `package.json` names.
	npm: new Set(["ls", "view", "outdated"]),
	pnpm: new Set(["ls", "view", "outdated", "why"]),
	docker: new Set(["ps", "images", "logs"]),
};

/**
 * Programs that only have a read-only use when they are being asked about themselves.
 *
 * `node --version` cannot do anything; `node build.js` can do everything. They were on the list
 * above with no distinction drawn, which made every script this agent runs invisible to the
 * approval path. Keeping the informational form is worth it — checking a toolchain version is
 * something the agent does constantly, and it is genuinely nothing.
 */
const VERSION_ONLY = new Set(["node", "python", "python3", "go", "cargo", "rustc", "tsc", "deno", "bun", "java", "ruby", "perl", "php"]);
const INFORMATIONAL = /^(--version|-v|-V|--help|-h|version)$/;

/**
 * Arguments that turn one of the programs above into something that writes.
 *
 * A veto rather than more entries in the sets: the sets say what a program is for, and this says
 * when it is being used for something else.
 */
const WRITES_ANYWAY: Record<string, RegExp> = {
	// `find -delete` and `-exec` are the two that matter; the `-f*` family writes files too.
	find: /^(-delete|-exec|-execdir|-ok|-okdir|-fls|-fprint|-fprintf|-fprint0)$/,
	// Everything except reading it back is a write to a config file.
	git: /^(--replace-all|--add|--unset|--unset-all|--rename-section|--remove-section|--edit|-e)$/,
	// A pager that can shell out is not a reader.
	docker: /^(--format=.*exec.*)$/,
};

export function isReadOnlyCommand(command: string): boolean {
	/*
	 * Any shell metacharacter can chain a mutating command onto a safe one.
	 *
	 * `\n` and `\r` included. They separate commands exactly as `;` does, and their absence here
	 * was a complete bypass: `ls\nrm -rf ~` has `ls` as its first word, no metacharacter from the
	 * old set, and so skipped the approval prompt while running both halves.
	 */
	if (/[;&|><`$(){}\n\r]/.test(command)) return false;
	const parts = command.trim().split(/\s+/);
	const head = parts[0];
	if (!head) return false;
	const args = parts.slice(1);

	const veto = WRITES_ANYWAY[head];
	if (veto && args.some((arg) => veto.test(arg))) return false;

	if (READ_ONLY_COMMANDS.has(head)) return true;

	/*
	 * `env` prints the environment, which is read-only — right up until it is given something to
	 * run. With assignments and nothing else, there is nothing to run.
	 */
	if (head === "env") return args.every((arg) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(arg));

	if (VERSION_ONLY.has(head)) return args.length > 0 && args.every((arg) => INFORMATIONAL.test(arg));

	const sub = READ_ONLY_SUBCOMMANDS[head];
	return sub ? sub.has(args[0] ?? "") : false;
}

export const bashTool: Tool<BashArgs> = {
	name: "bash",
	snippet: "Run shell commands",
	guidelines: [
		"Use the dedicated tools instead of their shell equivalents: read over `cat`, edit over `sed`, glob over `find`, grep over shell `grep`.",
		"Quote paths that may contain spaces.",
		"Use run_in_background for long-lived processes such as dev servers, then read them with bash_output.",
	],
	description:
		"Run a shell command in the workspace. The working directory persists between calls but shell state " +
		"(variables, functions) does not. Use `run_in_background: true` for long-running processes such as dev servers, " +
		"then read their output with `bash_output`. Prefer the dedicated file tools over cat/sed/echo. " +
		"Commands may run under a file sandbox. A blocked write is reported as a policy denial, not a bug in the " +
		"command — do not retry it another way. When one is denied and a wider mode would let it through, retry that " +
		"exact command once with `escalate` and `justification`; the user is asked, and the grant covers only that call. " +
		"Never escalate up front: only after this session has actually denied the same access.",
	parameters: {
		type: "object",
		properties: {
			command: { type: "string", description: "The command to run." },
			description: { type: "string", description: "5-10 word description shown to the user." },
			timeout: { type: "number", description: "Timeout in milliseconds. Default 120000, max 600000." },
			run_in_background: { type: "boolean", description: "Detach the process and return immediately." },
			escalate: {
				type: "string",
				enum: [...ESCALATION_TARGETS],
				description:
					"Only valid as a one-shot retry of a command the sandbox just denied. The narrowest mode that would " +
					"let it through. Requires justification, and asks the user.",
			},
			justification: {
				type: "string",
				description: "One sentence on why the wider mode is needed. Shown to the user verbatim.",
			},
		},
		required: ["command"],
		additionalProperties: false,
	},
	mutating: true,
	summarize: (args) => args.description ?? args.command.split("\n")[0].slice(0, 80),

	async execute(args, ctx): Promise<ToolResult> {
		if (typeof args.command !== "string" || !args.command.trim()) {
			return errorResult("`command` is required.");
		}

		/*
		 * 裸的 `cat` / `grep` / `find` / `ls` 改道到专用工具。
		 *
		 * 在提权和审批之前：一条要被改道的命令不该先问用户「允许吗」再说「其实别用这个」。
		 * 见 `reroute.ts`——有管道、重定向、串联的一律放行，那是真的在组合。
		 */
		const reroute = rerouteShellCommand(args.command, ctx.state.get(TOOL_NAMES_KEY) as ReadonlySet<string> | undefined);
		if (reroute) return errorResult(reroute.message);

		/*
		 * The escalation, resolved before anything runs.
		 *
		 * A refused request never reaches the user: asking for a mode that is not wider grants
		 * nothing, so there is nothing to decide. What does reach them is the model's own sentence
		 * about why — which is the difference between a prompt somebody can answer and one they
		 * can only guess at.
		 */
		let mode = ctx.sandboxMode;
		try {
			validateEscalationArgs(args.escalate, args.justification);
			if (args.escalate) {
				mode = await approveEscalation(
					{
						requested: args.escalate,
						justification: args.justification!,
						current: ctx.sandboxMode ?? "danger-full-access",
						subject: "命令",
					},
					ctx.requestApproval
						? async (reason) =>
								(await ctx.requestApproval!({
									kind: "bash",
									title: `提权运行：${args.description ?? args.command.split("\n")[0].slice(0, 60)}`,
									detail: args.command,
									subject: `escalate:${args.escalate}:${args.command}`,
									reason,
								})) === "reject"
									? "reject"
									: "once"
						: undefined,
				);
			}
		} catch (error) {
			return errorResult(error instanceof Error ? error.message : String(error));
		}

		if (ctx.requestApproval && !args.escalate && !isReadOnlyCommand(args.command)) {
			const decision = await ctx.requestApproval({
				kind: "bash",
				title: args.description ?? "Run shell command",
				detail: args.command,
				subject: args.command,
			});
			if (decision === "reject") return errorResult("The user rejected this command.");
		}

		if (args.run_in_background) return startBackground(args, { ...ctx, sandboxMode: mode });

		const timeout = Math.min(args.timeout ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
		let baseline: Awaited<ReturnType<typeof beforeCommand>> = null;
		let changeWarning: string | undefined;
		try { baseline = await beforeCommand(ctx); } catch (error) { changeWarning = String(error); }
		const outputLog = await createOutputLog(ctx.scratchDir);
		const result = await new Promise<ToolResult>((resolve) => {
			/*
			 * `mode` may have been widened by an escalation just now; `network` never is.
			 *
			 * The file modes are a scale, so `escalate` has somewhere to move along. The network is
			 * one switch with one position, and `escalation.ts` deliberately offers no grant for it
			 * — so this reads the turn's setting rather than anything decided above.
			 */
			const child = getSandbox().run(args.command, { cwd: ctx.cwd, mode, network: ctx.sandboxNetwork });

			let output = "";
			let settled = false;
			/*
			 * Progress is coalesced rather than forwarded per chunk.
			 *
			 * Every one of these crosses a process boundary and replaces the whole card: the payload
			 * is the accumulated output, so a command that prints steadily sends `MAX_OUTPUT_CHARS`
			 * again for each chunk. A build printing its asset list a line at a time — 192 KB over
			 * 2000 chunks — put 193 MB through the bridge to say 192 KB, a 515× amplification, and
			 * the window spent it re-rendering 60,000 characters of monospace text two thousand
			 * times. That is what "the command is stuck" looked like: the command was fine, the
			 * window could not keep up with being told about it.
			 *
			 * Ten frames a second is faster than anyone reads and bounds the cost by wall-clock
			 * instead of by how chatty the command is. The trailing edge matters as much as the
			 * rate: without it the last chunk before exit is the one nobody sees.
			 */
			let pending = false;
			let ticker: ReturnType<typeof setInterval> | undefined;
			const flush = () => {
				if (!pending) return;
				pending = false;
				ctx.onProgress?.({ content: [{ type: "text", text: output }] });
			};
			const stopTicking = () => {
				if (ticker === undefined) return;
				clearInterval(ticker);
				ticker = undefined;
			};
			child.onOutput((chunk) => {
				outputLog?.append(chunk);
				output = clip(output + chunk);
				pending = true;
				if (ticker === undefined && ctx.onProgress) {
					ticker = setInterval(flush, PROGRESS_INTERVAL_MS);
					// Never a reason to hold the process open: the result is what the turn waits on.
					ticker.unref?.();
				}
			});

			const timer = setTimeout(() => {
				if (settled) return;
				settled = true;
				stopTicking();
				child.kill();
				resolve({
					content: [{ type: "text", text: `${clip(output)}\n\n[timed out after ${timeout}ms]` }],
					details: { kind: "bash", command: args.command, timedOut: true },
					isError: true,
				});
			}, timeout);

			const onAbort = () => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				stopTicking();
				child.kill();
				resolve({
					content: [{ type: "text", text: `${clip(output)}\n\n[cancelled]` }],
					details: { kind: "bash", command: args.command, cancelled: true },
					isError: true,
				});
			};
			ctx.signal?.addEventListener("abort", onAbort, { once: true });

			child.onError((error) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				stopTicking();
				ctx.signal?.removeEventListener("abort", onAbort);
				resolve(errorResult(`Failed to start command: ${error.message}`));
			});

			child.onExit((code) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				stopTicking();
				ctx.signal?.removeEventListener("abort", onAbort);
				const text = clip(output).trim();
				/*
				 * Say when it was the sandbox, not the command.
				 *
				 * A denied write fails the way a full disk or a wrong path fails — some non-zero
				 * code and a message about permission — and a model that cannot tell the two apart
				 * does the worst possible thing: it tries the same write another way, three times,
				 * and reports that the tool is broken. The marker turns "it failed" into "it was
				 * refused", and the hint beside it is the sanctioned way forward.
				 */
				const ranUnder = mode;
				const denied = ranUnder !== undefined && ranUnder !== "danger-full-access" && looksDenied(output);
				/*
				 * And the same for the network, which needs it more.
				 *
				 * A write denial at least prints something recognisable; a denied socket prints
				 * `Could not resolve host`, so without this the model spends its remaining turns
				 * retrying, switching registries and blaming DNS. The policy is what identifies it
				 * — see `looksNetworkDenied`, which will not answer without being told the policy.
				 */
				const cutOff = looksNetworkDenied(output, ctx.sandboxNetwork);
				const markers = [
					...(denied ? [sandboxDenialMarker(ranUnder), escalationHint("command")] : []),
					...(cutOff ? [networkDenialMarker()] : []),
				];
				const body =
					markers.length > 0
						? [text || "(no output)", ...markers].join("\n")
						: text || (code === null ? "(terminated without an exit code)" : `(no output, exit code ${code})`);
				resolve({
					content: [{ type: "text", text: body }],
					details: {
						kind: "bash",
						command: args.command,
						exitCode: code,
						...(denied ? { denied: true } : {}),
						...(cutOff ? { networkDenied: true } : {}),
					},
					isError: code !== 0,
				});
			});
		});
		const outputDetails = await outputLog?.close();
		let changeIds: string[] = [];
		try { changeIds = await afterCommand(ctx, baseline); } catch (error) { changeWarning = String(error); }
		const details = result.details && typeof result.details === "object" ? result.details : {};
		return { ...result, details: { ...details, ...outputDetails, changeIds, changeWarning } };
	},
};

async function startBackground(args: BashArgs, ctx: ToolContext): Promise<ToolResult> {
	const outputLog = await createOutputLog(ctx.scratchDir);
	const id = randomUUID();
	const child = getSandbox().run(args.command, { cwd: ctx.cwd, mode: ctx.sandboxMode, network: ctx.sandboxNetwork });

	const job: BackgroundJob = {
		id,
		command: args.command,
		startedAt: Date.now(),
		exitCode: null,
		output: "",
		outputPath: outputLog?.path,
		pid: child.pid,
		status: "running",
	};
	child.onOutput((chunk) => {
		outputLog?.append(chunk);
		job.output = clip(job.output + chunk);
	});
	child.onExit((code) => {
		void outputLog?.close().then(details => Object.assign(job, details));
		job.exitCode = code;
		job.finishedAt = Date.now();
		job.status = code !== null && code !== 0 ? "failed" : "exited";
	});
	child.onError((error) => { void outputLog?.close().then(details => Object.assign(job, details)); job.error = error.message; job.status = "failed"; if (!job.pid) job.finishedAt = Date.now(); });

	backgroundJobs(ctx.state).add(job, child);
	return {
		content: [{ type: "text", text: `Started background job ${id}. Read its output with bash_output({ id: "${id}" }).` }],
		details: { kind: "bash_background", id, command: args.command, outputPath: outputLog?.path },
	};
}

interface BashOutputArgs {
	id: string;
	kill?: boolean;
}

export const bashOutputTool: Tool<BashOutputArgs> = {
	name: "bash_output",
	snippet: "Read output from a background job",
	description: "Read the accumulated output of a background job started by `bash`, and optionally kill it.",
	parameters: {
		type: "object",
		properties: {
			id: { type: "string", description: "Job id returned by bash." },
			kill: { type: "boolean", description: "Terminate the job after reading its output." },
		},
		required: ["id"],
		additionalProperties: false,
	},
	summarize: (args) => `Check job ${args.id}`,

	async execute(args, ctx): Promise<ToolResult> {
		const job = backgroundJobs(ctx.state).get(args.id);
		if (!job) return errorResult(`No background job with id "${args.id}".`);
		if (args.kill) backgroundJobs(ctx.state).stop(args.id, true);
		const status = job.finishedAt === undefined ? job.status : job.exitCode === null ? "terminated" : `exited with code ${job.exitCode}`;
		return {
			content: [{ type: "text", text: `[job ${job.id} ${status}]\n${job.output || "(no output yet)"}` }],
			details: { kind: "bash_output", id: job.id, exitCode: job.exitCode, command: job.command, outputPath: job.outputPath, outputComplete: job.outputComplete, outputError: job.outputError },
		};
	},
};

function clip(text: string): string {
	if (text.length <= MAX_OUTPUT_CHARS) return text;
	const half = Math.floor(MAX_OUTPUT_CHARS / 2);
	return `${text.slice(0, half)}\n\n… [${text.length - MAX_OUTPUT_CHARS} characters omitted] …\n\n${text.slice(-half)}`;
}
