/**
 * Tool hooks.
 *
 * Each hook is a shell command run around a tool call. The tool name and arguments arrive as
 * environment variables and as JSON on stdin, so a hook can be a one-liner (`echo "$DW_TOOL"
 * >> audit.log`) or a real script.
 *
 * A blocking `before-tool` hook that exits non-zero turns the call into an error result the
 * model can react to — that is what makes hooks a guardrail rather than just logging.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { systemShell } from "../platform.ts";
import type { ExtensionHost } from "../extensions/host.ts";
import type { HookConfig } from "../config/settings.ts";
import type { ToolResult } from "../types.ts";

const HOOK_TIMEOUT_MS = 15_000;
const MAX_CAPTURE = 8000;

export interface HookRunResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
	/**
	 * Set when the hook process could not start at all (bad shell, missing working directory).
	 *
	 * This must stay distinct from a non-zero exit: one means "the hook decided to block", the
	 * other means "the hook never ran". Collapsing them produces an error the user cannot act
	 * on — a missing cwd shows up as an ordinary policy rejection.
	 */
	spawnError?: string;
}

export function hooksFor(hooks: HookConfig[], event: HookConfig["event"], toolName: string): HookConfig[] {
	return hooks.filter(
		(hook) => hook.enabled && hook.event === event && (hook.tools.length === 0 || hook.tools.includes(toolName)),
	);
}

export async function runHook(
	hook: HookConfig,
	cwd: string,
	payload: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<HookRunResult> {
	return new Promise((resolve) => {
		if (!existsSync(cwd)) {
			resolve({
				exitCode: null,
				stdout: "",
				stderr: "",
				timedOut: false,
				spawnError: `working directory does not exist: ${cwd}`,
			});
			return;
		}

		const child = spawn(hook.command, {
			cwd,
			shell: systemShell().file,
			env: {
				...process.env,
				DW_TOOL: String(payload.toolName ?? ""),
				DW_EVENT: hook.event,
				DW_ARGS: JSON.stringify(payload.args ?? {}),
				DW_CWD: cwd,
			},
		});

		let stdout = "";
		let stderr = "";
		let settled = false;

		child.stdout.on("data", (chunk: Buffer) => {
			if (stdout.length < MAX_CAPTURE) stdout += chunk.toString("utf8");
		});
		child.stderr.on("data", (chunk: Buffer) => {
			if (stderr.length < MAX_CAPTURE) stderr += chunk.toString("utf8");
		});

		// A hook that hangs must not hang the agent.
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			child.kill("SIGKILL");
			resolve({ exitCode: null, stdout, stderr, timedOut: true });
		}, HOOK_TIMEOUT_MS);

		const onAbort = () => child.kill("SIGKILL");
		signal?.addEventListener("abort", onAbort, { once: true });

		child.on("error", (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			resolve({ exitCode: null, stdout, stderr, timedOut: false, spawnError: error.message });
		});

		child.on("close", (code) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			resolve({ exitCode: code, stdout, stderr, timedOut: false });
		});

		/*
		 * A hook is under no obligation to read its stdin, and most do not.
		 *
		 * The payload goes in anyway, because a hook that *does* want it should find it there. What
		 * that costs is a pipe whose reader may be gone: a script that never reads, or exits early,
		 * leaves this end writing into nothing, and once the payload exceeds the pipe buffer — 64KB,
		 * which a tool call with a large argument reaches — the write fails with `EPIPE`.
		 *
		 * `child.on("error")` above does not cover it. That reports a process which could not be
		 * spawned; this is a stream that could not be written, and a stream's `error` with no
		 * listener is rethrown. Asynchronously, from inside `WriteWrap.onWriteComplete`, with a
		 * stack ending in Node's internals — so in the main process it arrived as Electron's
		 * "A JavaScript error occurred in the main process" over the whole app, naming nothing that
		 * would lead anyone here.
		 *
		 * Ignoring it is the correct outcome, not a papering over: the hook has already declined to
		 * read what it was offered, and the exit code it returns is what actually matters. That is
		 * still collected by the `close` handler.
		 */
		child.stdin.on("error", () => {});
		child.stdin.end(JSON.stringify(payload));
	});
}

/** Build the loop's `beforeToolCall` from the configured hooks. */
export function makeBeforeToolCall(hooks: HookConfig[], cwd: string, signal?: AbortSignal, extensions?: ExtensionHost) {
	return async ({ toolName, args }: { toolName: string; args: Record<string, unknown> }) => {
		/*
		 * Extensions are asked before shell hooks, and the order is deliberate.
		 *
		 * A hook is a command the user wrote for this machine; an extension is code somebody else
		 * wrote and they installed. If both would stop a call, the one whose reason is worth showing
		 * is the one the user did not write — they already know what their own hook does.
		 */
		if (extensions) {
			const verdict = await extensions.intercept("tool_call", { toolName, args, cwd });
			if (verdict.block) return { block: true, reason: `一个扩展拦下了 "${toolName}"：${verdict.block}` };
		}

		for (const hook of hooksFor(hooks, "before-tool", toolName)) {
			const result = await runHook(hook, cwd, { toolName, args, event: "before-tool" }, signal);
			if (result.spawnError) {
				// Say plainly that the hook itself is broken, so the model does not invent a
				// reason and the user knows to fix the configuration rather than the code.
				return {
					block: true,
					reason: `A hook could not run and blocked "${toolName}": ${result.spawnError}. Fix the hook in Settings → Hooks, or disable it.`,
				};
			}
			if (!hook.blocking) continue;
			if (result.timedOut) return { block: true, reason: `Hook "${hook.command}" timed out.` };
			if (result.exitCode !== 0) {
				const detail = (result.stderr || result.stdout).trim().slice(0, 400);
				return {
					block: true,
					reason: `A hook blocked "${toolName}" (exit ${result.exitCode})${detail ? `: ${detail}` : "."}`,
				};
			}
		}
		return undefined;
	};
}

/** Build the loop's `afterToolCall`. Hook stdout is appended to what the model sees. */
export function makeAfterToolCall(hooks: HookConfig[], cwd: string, signal?: AbortSignal) {
	return async ({
		toolName,
		args,
		result,
	}: {
		toolName: string;
		args: Record<string, unknown>;
		result: ToolResult;
	}) => {
		const notes: string[] = [];
		for (const hook of hooksFor(hooks, "after-tool", toolName)) {
			const run = await runHook(hook, cwd, { toolName, args, event: "after-tool" }, signal);
			// An after-tool hook cannot block, so a broken one is reported and skipped.
			if (run.spawnError) {
				notes.push(`[hook error] ${run.spawnError}`);
				continue;
			}
			const text = run.stdout.trim();
			if (text) notes.push(text);
		}
		if (notes.length === 0) return undefined;
		return {
			result: {
				...result,
				content: [...result.content, { type: "text" as const, text: `\n<hook-output>\n${notes.join("\n")}\n</hook-output>` }],
			},
		};
	};
}
