import { assessCommand, assessWrite } from "../../tools/risk.ts";
import { assessNetwork } from "../../tools/risk-network.ts";
import type { Context, Plugin } from "../context.ts";
import { APPROVAL, type ApprovalPolicy, type ApprovalVerdict } from "../services.ts";

/**
 * Which actions may proceed without a person.
 *
 * A seam because the answer is a matter of policy, not of fact: a personal machine, a shared
 * build box and a locked-down deployment want three different lines, and they should differ by
 * which policy is loaded rather than by branches inside one function.
 *
 * The built-in policy is a blacklist. Asking about everything that writes turns the prompt into
 * something people learn to click through, which is worse than not having it — so it asks about
 * what cannot be taken back, and nothing else.
 */
class DefaultPolicy implements ApprovalPolicy {
	assess(kind: string, subject: string, cwd: string): ApprovalVerdict {
		if (kind === "bash") return assessCommand(subject, cwd);
		if (kind === "edit" || kind === "write") return assessWrite(subject, cwd);
		/*
		 * A read that got this far has already been judged, by `assessRead`; see the longer note on
		 * the same line in `runtime/approval-policy.ts`. Same answer as the fallback below, written
		 * out so that narrowing the fallback has to be a decision about reads too.
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
	}
}

export const approvalPlugin: Plugin = {
	name: "approval",
	apply(ctx: Context) {
		return ctx.provide<ApprovalPolicy>(APPROVAL, new DefaultPolicy());
	},
};
