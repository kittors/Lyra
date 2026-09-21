/**
 * Which approval policy is in force.
 *
 * Bound by the host at boot like the other seams. The fallback is the built-in blacklist, so the
 * CLI and the tests judge risk the same way the app does without having to build a kernel.
 */

import type { ApprovalPolicy } from "../kernel/services.ts";
import { assessCommand, assessWrite } from "../tools/risk.ts";
import { assessNetwork } from "../tools/risk-network.ts";

const BUILT_IN: ApprovalPolicy = {
	assess(kind, subject, cwd) {
		if (kind === "bash") return assessCommand(subject, cwd);
		if (kind === "edit" || kind === "write") return assessWrite(subject, cwd);
		/*
		 * A read that got this far has already been judged, by `assessRead`.
		 *
		 * Unlike a command or a write — where this seam *is* the judgement — the reading tools do
		 * not ask about a path unless it already left the workspace. Re-deciding here could only
		 * overturn that, and `risky: false` would mean the question is composed, shown to nobody,
		 * and answered yes by the thing that was supposed to be asking.
		 *
		 * The line below is what the fallback would do anyway. It is written out because the two
		 * agree by accident rather than by design: the fallback is "a kind this policy has never
		 * heard of", and read is a kind it has. Someone narrowing that fallback later should have
		 * to delete this line on purpose.
		 */
		if (kind === "read") return { risky: true };
		if (kind === "network") {
				/*
				 * Three answers folded into this seam's two.
				 *
				 * `assessNetwork` distinguishes "refuse outright" from "ask a person", and this
				 * interface only has "risky or not". Both non-allow answers arrive here as risky,
				 * which is the safe fold — the refusals that matter are enforced at the tool,
				 * before anything reaches a prompt.
				 */
				const verdict = assessNetwork({ url: subject });
				return verdict.decision === "allow" ? { risky: false } : { risky: true, reason: verdict.reason };
			}
		// An unfamiliar kind is one this policy was not written for, so it defers to a person.
		return { risky: true };
	},
};

let bound: ApprovalPolicy | null = null;

export function useApprovalPolicy(next: ApprovalPolicy | null): void {
	bound = next;
}

export function approvalPolicy(): ApprovalPolicy {
	return bound ?? BUILT_IN;
}
