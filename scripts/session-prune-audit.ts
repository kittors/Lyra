/** Read-only production-policy replay, not a prediction of future invoices or cache hits. */
import { join } from "node:path";
import { lyraHome, SessionStore } from "../packages/core/src/session/store.ts";
import { AgedToolPruner } from "../packages/core/src/runtime/aged-prune.ts";
import { dropStaleResults } from "../packages/core/src/runtime/stale-results.ts";
import { boundedGrepLines } from "../packages/core/src/tools/grep.ts";
import type { Message } from "../packages/core/src/types.ts";

// `LYRA_HOME` like the app, so a copy can be audited without touching the real one.
const root = join(lyraHome(), "sessions");
const store = new SessionStore(root);
const chars = (messages: Message[]) => messages.reduce((sum, message) => sum + (message.role === "toolResult" ? message.content.reduce((n, part) => n + (part.type === "text" ? part.text.length : 0), 0) : 0), 0);
let sessions = 0, requests = 0, before = 0, afterAge = 0, afterStale = 0, afterGrep = 0, combined = 0, rewrites = 0, maxGrepBefore = 0, maxGrepAfter = 0;
for (const meta of await store.listSessions()) {
	{
		const original = await store.messages(meta.projectId, meta.id);
		const history: Message[] = [], bounded: Message[] = [];
		const age = new AgedToolPruner(), both = new AgedToolPruner();
		let previousAt: number | undefined;
		sessions++;
		for (const message of original) {
			if (message.role === "assistant") {
				requests++;
				const timing = { lastRequestAt: previousAt, now: message.timestamp };
				const pruned = age.prepare(history, timing), trimmed = both.prepare(bounded, timing);
				const stale = dropStaleResults(history, timing);
				before += chars(history); afterAge += chars(pruned); afterStale += chars(stale); afterGrep += chars(bounded); combined += chars(trimmed);
				rewrites += pruned.filter((m, i) => m !== history[i]).length;
				previousAt = message.timestamp;
			}
			history.push(message);
			if (message.role === "toolResult" && message.toolName === "grep") {
				const content = message.content.map(part => part.type === "text" ? { ...part, text: boundedGrepLines(part.text.split("\n")).join("\n") } : part);
				const capped = { ...message, content };
				maxGrepBefore = Math.max(maxGrepBefore, chars([message])); maxGrepAfter = Math.max(maxGrepAfter, chars([capped]));
				bounded.push(capped);
			} else bounded.push(message);
		}
	}
}
console.log(JSON.stringify({
	label: "Historical message replay; tool-result UTF-16 characters × subsequent requests; does not simulate model behaviour, compaction, invoices or cache hits",
	sessions, requests, before, afterAge, afterStale, afterGrep, combined,
	ageSaving: 1 - afterAge / before,
	staleSaving: 1 - afterStale / before,
	grepSaving: 1 - afterGrep / before,
	combinedSaving: 1 - combined / before,
	rewrites, maxGrepBefore, maxGrepAfter,
}, null, 2));
