/**
 * Deciding whether an action needs a person.
 *
 * Holds the pending questions and the "always allow" answers for this process. Separate from the
 * session because the policy question — is this safe to do unattended — has nothing to do with the
 * conversation it happens to arise in, and because a prompt that fires constantly is not a
 * safeguard but something you learn to click through.
 */

import { randomUUID } from "node:crypto";
import type { PermissionMode } from "../config/settings.ts";
import type { ApprovalDecision, ApprovalRequest } from "../types.ts";
import { approvalPolicy } from "./approval-policy.ts";

export interface PendingApproval {
	id: string;
	request: ApprovalRequest;
	resolve: (decision: ApprovalDecision) => void;
}

/** How long a question waits for a person before it is treated as refused. */
const UNATTENDED_TIMEOUT_MS = 5 * 60_000;

export interface ApprovalGateOptions {
	mode(): PermissionMode;
	cwd(): string;
	/** Ask the user. The gate does not know what a window is. */
	ask(pending: PendingApproval): Promise<void>;
	/** Remember an "always" answer beyond this process. */
	remember(subject: string): void;
	/** Overridable so a test does not have to wait five minutes to see the timeout work. */
	unattendedTimeoutMs?: number;
}

export class ApprovalGate {
	private readonly pending = new Map<string, PendingApproval>();
	/** Subjects the user chose "always allow" for, within this process. */
	private readonly allowList = new Set<string>();
	private readonly options: ApprovalGateOptions;

	constructor(options: ApprovalGateOptions, alwaysAllow: Iterable<string> = []) {
		this.options = options;
		for (const subject of alwaysAllow) this.allowList.add(subject);
	}

	allow(subject: string): void {
		this.allowList.add(subject);
	}

	list(): { id: string; request: ApprovalRequest }[] {
		return [...this.pending.values()].map(({ id, request }) => ({ id, request }));
	}

	resolve(requestId: string, decision: unknown): boolean {
		const entry = this.pending.get(requestId);
		if (!entry) return false;
		if (entry.request.kind === "interactive") {
			const labels = (entry.request.options ?? []).map((option) => typeof option === "string" ? option : option.label);
			if (decision === "reject") entry.resolve(decision);
			else if (decision === "skip" && entry.request.allowSkip === true) {
				const index = entry.request.defaultOptionIndex;
				const fallback = index !== undefined ? labels[index] : undefined;
				entry.resolve(fallback === undefined ? "skip" : { answer: fallback, skipped: true });
			} else if (typeof decision === "object" && decision !== null && "answer" in decision) {
				const value = decision.answer;
				if (typeof value !== "string" && (!Array.isArray(value) || !value.every((item: unknown) => typeof item === "string"))) return false;
				if (Array.isArray(value) && entry.request.selectionMode !== "multi") return false;
				const answers = (typeof value === "string" ? [value] : value).map((item: string) => item.trim());
				if (!answers.length || new Set(answers).size !== answers.length || answers.some((answer: string) => !answer || (!entry.request.allowCustomInput && !labels.includes(answer)))) return false;
				entry.resolve({ answer: typeof value === "string" ? answers[0] : answers });
			} else return false;
		} else {
			if (decision !== "once" && decision !== "always" && decision !== "reject") return false;
			entry.resolve(decision);
		}
		return true;
	}

	/**
	 * Decide whether one action may proceed, asking the user if it may not.
	 *
	 * For permissions, `full` never asks; `auto` asks only about what cannot be taken back, judged by the
	 * approval policy rather than here — that judgement is a matter of where the agent is running,
	 * and a plugin can replace it. Anything else asks.
	 */
	async request(request: ApprovalRequest): Promise<ApprovalDecision> {
		const mode = this.options.mode();
		// A permission grant cannot answer a question, even in unattended/full-access mode.
		if (request.kind !== "interactive") {
			if (mode === "full") return "once";
			if (this.allowList.has(request.subject)) return "once";

			if (mode === "auto") {
				const verdict = approvalPolicy().assess(request.kind, request.subject, this.options.cwd());
				if (!verdict.risky) return "once";
				if (verdict.reason) request.detail = `${verdict.reason}\n\n${request.detail ?? ""}`.trim();
			}
		}

		const id = randomUUID();
		return new Promise<ApprovalDecision>((resolve) => {
			/*
			 * Nobody there is an answer too — and the answer is no.
			 *
			 * A question with no one to read it used to stop a run indefinitely: the agent waited,
			 * the window showed a spinner, and an overnight task was still on its first prompt in
			 * the morning. Expiring into a rejection is the only safe direction — it grants
			 * nothing that was not granted — and it lets the agent find another way, which is
			 * usually what it does with a refusal.
			 *
			 * Long enough that someone who stepped away for a coffee still gets to decide.
			 */
			let timer: ReturnType<typeof setTimeout> | undefined;
			const entry: PendingApproval = {
				id,
				request,
				resolve: (decision) => {
					if (timer) clearTimeout(timer);
					this.pending.delete(id);
					if (decision === "always") {
						this.allowList.add(request.subject);
						this.options.remember(request.subject);
					}
					// "always" is an answer about the future; this call still just proceeds.
					resolve(decision === "always" ? "once" : decision);
				},
			};
			timer = setTimeout(() => entry.resolve("reject"), this.options.unattendedTimeoutMs ?? UNATTENDED_TIMEOUT_MS);
			this.pending.set(id, entry);
			void this.options.ask(entry);
		});
	}

	/** Reject everything still waiting. Called when a run ends, so nothing hangs forever. */
	rejectAll(): void {
		for (const entry of this.pending.values()) entry.resolve("reject");
		this.pending.clear();
	}
}

/**
 * The gate a session uses, wired to it.
 *
 * The wiring is here rather than in the session's constructor because it is about approvals, not
 * about sessions: what a request looks like on the way out, and that "always" is remembered by the
 * settings rather than by this process. A caller supplies the two things only it can know — the
 * current mode and directory — and where to send the question.
 */
export function sessionApprovalGate(deps: {
	mode(): PermissionMode;
	cwd(): string;
	emit(event: Extract<import("../agent/events.ts").AgentEvent, { type: "approval_request" }>): Promise<void>;
	alwaysAllow: Iterable<string>;
}): ApprovalGate {
	return new ApprovalGate(
		{
			mode: deps.mode,
			cwd: deps.cwd,
			ask: (pending) =>
				deps.emit({
					type: "approval_request",
					requestId: pending.id,
					toolCallId: pending.id,
					...pending.request,
				}),
			// Persisting an "always" answer is the host's job; the settings are not ours to write.
			remember: () => {},
		},
		deps.alwaysAllow,
	);
}
