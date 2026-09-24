/**
 * Where the offer to save a rule actually happens: at the end of a turn, if at all.
 *
 * The classifier lives in `rules/from-correction.ts`; this is the part that decides whether to run
 * it. Four gates, and each one exists because of a way this feature turns into an annoyance:
 *
 *   The budget. Three per session, silent after two refusals.
 *
 *   A finished turn. A turn the user stopped is one they were unhappy with, and following it with
 *   "shall I make that permanent?" is the wrong question at the wrong moment.
 *
 *   A bounded wait. The turn is already over and nobody is watching this; a classifier call that
 *   hangs would hold the session's controller and the task queue behind it for as long as the
 *   provider felt like taking.
 *
 *   Never throwing. This runs after a turn that already succeeded. An error here would attach a
 *   failure to a turn that had none.
 */

import type { streamAssistant } from "../ai/index.ts";
import type { AgentEvent } from "../agent/events.ts";
import type { Settings } from "../config/settings.ts";
import { resolveModelRef } from "../config/model-roles.ts";
import { classifyCorrection, type OfferBudget } from "../rules/from-correction.ts";
import type { Message, ModelConfig, ProviderConfig } from "../types.ts";

/**
 * How long the classification may take before it is abandoned.
 *
 * Generous for a one-shot call on a fast model, and short enough that a provider having a bad
 * minute does not become a session that appears to still be working after it has stopped.
 */
export const CLASSIFY_TIMEOUT_MS = 20_000;

export interface OfferInputs {
	messages: Message[];
	settings: Settings;
	/** The session's own model, used when no `@fast` role is configured. */
	provider: ProviderConfig;
	model: ModelConfig;
	stream: typeof streamAssistant;
	budget: OfferBudget;
	/** The turn's signal, only to find out whether the turn was stopped. */
	signal?: AbortSignal;
	emit: (event: AgentEvent) => Promise<void> | void;
}

/**
 * Look at the exchange that just ended and, if it was a correction, offer to keep it.
 *
 * Returns whether an offer was made, which is what the tests assert on — the event is fire and
 * forget and there is otherwise nothing to observe.
 */
export async function offerRuleFromCorrection(input: OfferInputs): Promise<boolean> {
	if (input.budget.exhausted) return false;
	if (input.signal?.aborted) return false;

	/*
	 * The `@fast` role, falling back to the session's model.
	 *
	 * This is the call the role exists for: a classification whose answer is one small JSON object,
	 * where being cheap matters much more than being clever. Someone who has pointed `@fast` at a
	 * local model gets it for free.
	 */
	const resolved = resolveModelRef(input.settings, "@fast", { provider: input.provider, model: input.model });

	/*
	 * 两种叫停都算数：等太久，和这次判断已经没有意义了。
	 *
	 * 从前只接了前者，`signal` 只在最上面查一次——于是按下停止之后、或者人已经说了下一句之后，
	 * 这次请求照样跑满它自己的二十秒，而它要回答的那个问题此时已经作废。等它的不只是它自己：
	 * 这一段跑在回合的收尾里，`Session` 要等它结束才放手（见 `session-turn.ts` 的调用点）。
	 */
	const timeout = AbortSignal.timeout(CLASSIFY_TIMEOUT_MS);
	const signal = input.signal ? AbortSignal.any([timeout, input.signal]) : timeout;
	let suggestion;
	try {
		suggestion = await classifyCorrection({
			messages: input.messages,
			provider: resolved.provider,
			model: resolved.model,
			stream: input.stream,
			signal,
		});
	} catch {
		return false;
	}

	if (!suggestion.isCorrection || !suggestion.body) return false;

	input.budget.recordOffer();
	await input.emit({
		type: "rule_suggested",
		name: suggestion.name ?? "from-correction",
		body: suggestion.body,
		condition: suggestion.condition,
		scope: suggestion.scope,
	});
	return true;
}
