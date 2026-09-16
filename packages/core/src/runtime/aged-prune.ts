import type { Message } from "../types.ts";
import { pruneToolResults, worthPruning, type ArtifactSink, type PruneTiming } from "./prune.ts";

// Historical carry curves flatten near 20 rounds; batch at that cadence to avoid
// rewriting the cached prefix every turn. Lower ages can evict still-useful output.
export const PRUNE_AGE_ROUNDS = 20;

/** Batch old output without invalidating the provider's prefix on every request. */
export class AgedToolPruner {
	private requests = 0;
	private readonly views = new WeakMap<Message, Message>();

	prepare(messages: Message[], timing: PruneTiming = {}, artifacts?: ArtifactSink): Message[] {
		let changed = false;
		const batch = this.requests++ % PRUNE_AGE_ROUNDS === 0;
		let age = 0;
		const next = [...messages];
		for (let index = messages.length - 1; index >= 0; index--) {
			const message = messages[index];
			if (message.role === "assistant") age++;
			let view = this.views.get(message) ?? message;
			// Skills remain instructions, not disposable command output.
			if (batch && view === message && age >= PRUNE_AGE_ROUNDS && message.role === "toolResult" && message.toolName !== "skill" && worthPruning(messages, index, timing)) {
				[view] = pruneToolResults([message], undefined, artifacts);
				if (view !== message) this.views.set(message, view);
			}
			next[index] = view;
			if (view !== message) changed = true;
		}
		return changed ? next : messages;
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
