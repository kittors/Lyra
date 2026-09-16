import type { Message, ToolResultMessage } from "../types.ts";
import { CHEAP_SUFFIX_CHARS, firstAffordableCut, pruneToolResults, sizePruneSaving, type ArtifactSink, type PruneTiming } from "./prune.ts";
import { applyStaleCuts, staleCuts } from "./stale-results.ts";

// Historical carry curves flatten near 20 rounds; batch at that cadence to avoid
// rewriting the cached prefix every turn. Lower ages can evict still-useful output.
export const PRUNE_AGE_ROUNDS = 20;

interface SizedCut {
	index: number;
	saving: number;
	original: Message;
	current: Message;
}

/** Batch old output without invalidating the provider's prefix on every request. */
export class AgedToolPruner {
	private requests = 0;
	private readonly views = new WeakMap<Message, Message>();

	prepare(messages: Message[], timing: PruneTiming = {}, artifacts?: ArtifactSink): Message[] {
		const viewed = this.withViews(messages);
		const stale = staleCuts(viewed);
		const batch = this.requests++ % PRUNE_AGE_ROUNDS === 0;
		const sized = this.sizeCuts(messages, viewed, batch);
		const from = firstAffordableCut(viewed, [...stale, ...sized], timing);
		if (from === undefined) return viewed === messages ? messages : viewed;

		const next = applyStaleCuts(viewed, stale.filter((cut) => cut.index >= from));
		let result = next;
		for (const cut of sized) {
			if (cut.index < from) continue;
			const [view] = pruneToolResults([cut.current], undefined, artifacts);
			if (view === cut.current) continue;
			this.views.set(cut.original, view);
			if (result === next) result = [...next];
			result[cut.index] = view;
		}
		this.remember(messages, viewed, result);
		return result;
	}

	private sizeCuts(originals: Message[], viewed: Message[], batch: boolean): SizedCut[] {
		const cuts: SizedCut[] = [];
		let age = 0;
		for (let index = originals.length - 1; index >= 0; index--) {
			const original = originals[index];
			const message = viewed[index];
			if (original.role === "assistant") age++;
			if (message.role !== "toolResult" || message.toolName === "skill") continue;
			const chars = message.content.reduce((sum, block) => sum + (block.type === "text" ? [...block.text].length : 0), 0);
			const saving = sizePruneSaving(chars);
			// Blow-ups do not wait for the 20-round batch: a 1.7 MB grep is already dead weight.
			if (saving <= 0 || (saving <= CHEAP_SUFFIX_CHARS ? !batch || age < PRUNE_AGE_ROUNDS : false)) continue;
			cuts.push({ index, saving, original, current: message });
		}
		return cuts;
	}

	private withViews(messages: Message[]): Message[] {
		let next = messages;
		for (let index = 0; index < messages.length; index++) {
			const view = this.views.get(messages[index]);
			if (!view || view === messages[index]) continue;
			if (next === messages) next = [...messages];
			next[index] = view;
		}
		return next;
	}

	private remember(originals: Message[], before: Message[], after: Message[]): void {
		if (after === before) return;
		for (let index = 0; index < originals.length; index++) {
			if (after[index] !== before[index] && after[index].role === "toolResult") this.views.set(originals[index], after[index] as ToolResultMessage);
		}
	}
}

/** Keep the pruned prefix stable when a new user message starts another turn. */
export function sessionPruner(state: Map<string, unknown>): AgedToolPruner {
	const existing = state.get("agedToolPruner");
	if (existing instanceof AgedToolPruner) return existing;
	const pruner = new AgedToolPruner();
	state.set("agedToolPruner", pruner);
	return pruner;
}
