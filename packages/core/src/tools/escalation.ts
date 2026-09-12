/**
 * Asking for more room, after having been refused — the one place that choreography is written.
 *
 * The old shape was: guess whether a command is dangerous, and if it might be, ask before running
 * it. That produces a prompt for everything that *resembles* a risk, which is most things, and a
 * prompt that fires constantly is not a safeguard — it is a step people learn to click through
 * without reading. By the time the one that mattered arrives, it looks like all the others.
 *
 * This is the other order. The command runs, confined. If the sandbox refuses it, the refusal is
 * a fact rather than a prediction, and the model is told in words it can act on: what was denied,
 * and that it may ask once for a wider mode with a reason. The user is asked only then — and what
 * they see is the model's own sentence explaining why, not a lone path they have to judge cold.
 *
 * Two consequences worth stating. The number of prompts becomes the number of times the agent
 * actually crossed a line, not the number of times we suspected it might. And a grant is spent on
 * the call that asked for it: nothing accumulates, so a session cannot end up wider than it began.
 */

import type { SandboxMode } from "../sandbox/policy.ts";

/**
 * What a mode may be widened to. Absent keys cannot escalate at all.
 *
 * Strictly wider, always. Sideways is not a thing — there is no pair of modes where each permits
 * something the other does not, and allowing a "change" that is not a widening would let a granted
 * escalation quietly take something away, which is not what anybody approved.
 */
const WIDER: Partial<Record<SandboxMode, readonly SandboxMode[]>> = {
	"read-only": ["workspace-write", "danger-full-access"],
	"workspace-write": ["danger-full-access"],
};

/** Every mode an escalation could ever target. `read-only` is the floor; nothing escalates to it. */
export const ESCALATION_TARGETS: readonly SandboxMode[] = ["workspace-write", "danger-full-access"];

/** How the app names each mode when it has to say it to a person. */
const MODE_LABEL: Record<SandboxMode, string> = {
	"read-only": "只读",
	"workspace-write": "可写项目目录",
	"danger-full-access": "完全访问",
};

export function modeLabel(mode: SandboxMode): string {
	return MODE_LABEL[mode];
}

/**
 * The line that says a policy refused this, not that it failed.
 *
 * One wording, used by every tool that can be refused, because the model has to recognise it
 * instantly and identically wherever it appears. Two dialects for the same event would be two
 * things to learn, and it would learn neither reliably.
 */
export function sandboxDenialMarker(mode: SandboxMode): string {
	return `[sandbox: 文件写入被拒（当前模式：${MODE_LABEL[mode]}）——这是策略拒绝，不是命令本身出错，换个写法重试没有用]`;
}

/**
 * The same line for the network half.
 *
 * Needed precisely because the output does not say so. A denied socket prints `Could not resolve
 * host` — indistinguishable from a laptop with no wifi — so without this the model reads a policy
 * decision as a flaky network and does the one thing that cannot work: retries, waits, retries.
 * The marker is what turns that into "this will not work until somebody changes the setting".
 *
 * No escalation offered alongside it, unlike a write denial. The file modes form a scale that
 * `escalate` can walk up; this is a separate switch with one position, and there is nothing for a
 * per-call grant to widen to.
 */
export function networkDenialMarker(): string {
	return "[sandbox: 联网被拒（当前设置禁止命令联网）——这是策略拒绝，不是网络故障；重试、换镜像、改 DNS 都没有用，只有用户在设置里关掉这一项才行。本机 localhost 不受影响]";
}

/**
 * The nudge that rides along with a denial.
 *
 * At the point of refusal rather than in the tool description, because that is where it is needed
 * and where it cannot be missed: a model that has just been refused is reading this result, not
 * re-reading the schema it was given a hundred messages ago.
 */
export function escalationHint(subject: string): string {
	return `[sandbox: 可以申请——用完全相同的参数把这条${subject}重试一次，带上 escalate（够用的最窄模式）和 justification（一句话说明为什么需要），会弹窗问用户]`;
}

/** Why an escalation request was refused before anyone was asked. */
export class EscalationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "EscalationError";
	}
}

/**
 * Check the pairing a JSON schema cannot express.
 *
 * The two arguments travel together or not at all. An `escalate` with no reason is a prompt with
 * nothing to show the user, and a `justification` with nothing to justify is a sentence that
 * changes no behaviour — a model saying "I need write access" while asking for nothing.
 */
export function validateEscalationArgs(escalate: string | undefined, justification: string | undefined): void {
	if (escalate !== undefined && justification === undefined) {
		throw new EscalationError("提权请求必须带上 justification：弹窗要有一句话告诉用户为什么。");
	}
	if (justification !== undefined && escalate === undefined) {
		throw new EscalationError("justification 只能和 escalate 一起用，单独给理由不会改变任何行为。");
	}
	if (justification !== undefined && justification.trim().length === 0) {
		throw new EscalationError("justification 不能是空的。");
	}
}

export interface EscalationRequest {
	/** The mode being asked for. */
	requested: string;
	/** The model's one-sentence reason, shown to the user verbatim. */
	justification: string;
	/** The mode this call is currently running under. */
	current: SandboxMode;
	/** What the tool calls the thing being escalated, for the user-facing text. */
	subject: string;
}

/**
 * Resolve one escalation before anything runs.
 *
 * Ordered, and fail-closed at every step: a request that is not strictly wider never reaches a
 * person (there is nothing to decide — it grants nothing), a missing approval channel is a refusal
 * rather than a grant, and every negative outcome throws with its own wording so the model can
 * tell "you asked for the wrong thing" from "the user said no".
 *
 * The granted mode is returned for the caller to use on **this call**. It is deliberately not
 * written anywhere: an escalation that outlived its call would be a permission the user granted
 * once and lost track of.
 */
export async function approveEscalation(
	request: EscalationRequest,
	ask: ((reason: string) => Promise<"once" | "always" | "reject">) | undefined,
): Promise<SandboxMode> {
	const { requested, current, justification, subject } = request;
	if (!(WIDER[current] ?? []).includes(requested as SandboxMode)) {
		throw new EscalationError(
			`「${requested}」不比当前的「${MODE_LABEL[current]}」更宽，提权请求无效。`,
		);
	}
	if (!ask) {
		throw new EscalationError("提权需要用户批准，但当前没有可用的批准通道。");
	}

	const decision = await ask(justification);
	if (decision === "reject") {
		throw new EscalationError(`用户拒绝了把这条${subject}提权到「${MODE_LABEL[requested as SandboxMode]}」。`);
	}
	return requested as SandboxMode;
}
