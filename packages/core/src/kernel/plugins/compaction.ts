import { streamAssistant } from "../../ai/index.ts";
import { type Compaction, compactIfNeeded } from "../../runtime/compaction.ts";
import type { Context, Plugin } from "../context.ts";
import { COMPACTION, type CompactionRequest, type CompactionStrategy } from "../services.ts";

/**
 * Summarise the middle, keep the ends.
 *
 * The built-in answer to a full window: the oldest turns become a summary, the most recent ones
 * survive verbatim. It reads well afterwards and it is cheap, which is most of why it is the
 * default — but it is a policy, and a long-running agent with a different shape of work may want
 * a different one.
 */
class SummaryCompaction implements CompactionStrategy {
	compact(request: CompactionRequest): Promise<Compaction | null> {
		/*
		 * Every field forwarded, none defaulted away.
		 *
		 * This used to pass the first four and let `compactIfNeeded` default the rest, which meant
		 * that binding the built-in strategy — what the desktop does at boot — turned off the
		 * overhead accounting, artifact storage and the `@compact` model role. The built-in policy
		 * should behave the same whether or not a context is in the picture.
		 */
		return compactIfNeeded(
			request.messages,
			request.model,
			request.provider,
			request.streamFn ?? streamAssistant,
			request.overhead ?? 0,
			request.force ?? false,
			request.artifacts,
			request.manual,
			request.summarizer,
		);
	}
}

export const compactionPlugin: Plugin = {
	name: "compaction",
	apply(ctx: Context) {
		return ctx.provide<CompactionStrategy>(COMPACTION, new SummaryCompaction());
	},
};
