import { randomUUID } from "node:crypto";
import { rerouteShellCommand, TOOL_NAMES_KEY } from "./reroute.ts";
import { getSandbox, looksDenied } from "../sandbox/index.ts";
import {
	approveEscalation,
	escalationHint,
	ESCALATION_TARGETS,
	sandboxDenialMarker,
	validateEscalationArgs,
} from "./escalation.ts";
import { errorResult } from "../agent/tool-run.ts";
import type { Tool, ToolContext, ToolResult } from "../types.ts";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const MAX_OUTPUT_CHARS = 60_000;

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

interface BackgroundJob {
	id: string;
	command: string;
	startedAt: number;
	exitCode: number | null;
	output: string;
	kill: () => void;
}

const BACKGROUND_JOBS_KEY = "backgroundJobs";

function jobs(ctx: ToolContext): Map<string, BackgroundJob> {
	let map = ctx.state.get(BACKGROUND_JOBS_KEY) as Map<string, BackgroundJob> | undefined;
	if (!map) {
		map = new Map();
		ctx.state.set(BACKGROUND_JOBS_KEY, map);
	}
	return map;
}

/**
 * Commands that are never worth an approval prompt: they read state and cannot mutate the
 * workspace. Anything not on this list goes through `requestApproval`.
 */
const READ_ONLY_COMMANDS = new Set([
	"ls", "pwd", "echo", "cat", "head", "tail", "wc", "which", "whoami", "date", "env",
	"grep", "rg", "find", "fd", "tree", "du", "df", "stat", "file", "basename", "dirname",
	"node", "python3", "go", "cargo", "rustc", "tsc",
]);

const READ_ONLY_SUBCOMMANDS: Record<string, Set<string>> = {
	git: new Set(["status", "log", "diff", "show", "branch", "remote", "config", "ls-files", "rev-parse", "blame", "stash"]),
	npm: new Set(["ls", "view", "outdated", "run"]),
	pnpm: new Set(["ls", "view", "outdated", "why"]),
	docker: new Set(["ps", "images", "logs"]),
};

export function isReadOnlyCommand(command: string): boolean {
	// Any shell metacharacter can chain a mutating command onto a safe one.
	if (/[;&|><`$(){}]/.test(command)) return false;
	const parts = command.trim().split(/\s+/);
	const head = parts[0];
	if (!head) return false;
	if (READ_ONLY_COMMANDS.has(head)) return true;
	const sub = READ_ONLY_SUBCOMMANDS[head];
	return sub ? sub.has(parts[1] ?? "") : false;
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

		if (args.run_in_background) return startBackground(args, ctx);

		const timeout = Math.min(args.timeout ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
		return new Promise<ToolResult>((resolve) => {
			const child = getSandbox().run(args.command, { cwd: ctx.cwd, mode });

			let output = "";
			let settled = false;
			child.onOutput((chunk) => {
				if (output.length < MAX_OUTPUT_CHARS * 2) output += chunk;
				ctx.onProgress?.({ content: [{ type: "text", text: clip(output) }] });
			});

			const timer = setTimeout(() => {
				if (settled) return;
				settled = true;
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
				ctx.signal?.removeEventListener("abort", onAbort);
				resolve(errorResult(`Failed to start command: ${error.message}`));
			});

			child.onExit((code) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
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
				const body = denied
					? [text || "(no output)", sandboxDenialMarker(ranUnder), escalationHint("command")].join("\n")
					: text || `(no output, exit code ${code ?? 0})`;
				resolve({
					content: [{ type: "text", text: body }],
					details: { kind: "bash", command: args.command, exitCode: code ?? 0, ...(denied ? { denied: true } : {}) },
					isError: code !== 0,
				});
			});
		});
	},
};

function startBackground(args: BashArgs, ctx: ToolContext): ToolResult {
	const id = randomUUID().slice(0, 8);
	const child = getSandbox().run(args.command, { cwd: ctx.cwd, mode: ctx.sandboxMode });

	const job: BackgroundJob = {
		id,
		command: args.command,
		startedAt: Date.now(),
		exitCode: null,
		output: "",
		kill: () => child.kill(),
	};
	child.onOutput((chunk) => {
		job.output = clip(job.output + chunk);
	});
	child.onExit((code) => {
		job.exitCode = code ?? 0;
	});

	jobs(ctx).set(id, job);
	return {
		content: [{ type: "text", text: `Started background job ${id}. Read its output with bash_output({ id: "${id}" }).` }],
		details: { kind: "bash_background", id, command: args.command },
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
		const job = jobs(ctx).get(args.id);
		if (!job) return errorResult(`No background job with id "${args.id}".`);
		if (args.kill) job.kill();
		const status = job.exitCode === null ? "running" : `exited with code ${job.exitCode}`;
		return {
			content: [{ type: "text", text: `[job ${job.id} ${status}]\n${job.output || "(no output yet)"}` }],
			details: { kind: "bash_output", id: job.id, exitCode: job.exitCode, command: job.command },
		};
	},
};

function clip(text: string): string {
	if (text.length <= MAX_OUTPUT_CHARS) return text;
	const half = Math.floor(MAX_OUTPUT_CHARS / 2);
	return `${text.slice(0, half)}\n\n… [${text.length - MAX_OUTPUT_CHARS} characters omitted] …\n\n${text.slice(-half)}`;
}
