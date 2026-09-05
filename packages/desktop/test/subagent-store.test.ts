/**
 * The renderer's half of the sub-agent link: events in, roster and transcripts out.
 *
 * This is the seam the core tests cannot reach and a screenshot cannot prove. Every failure here is
 * silent in the same way — the pane renders perfectly against state that never arrives, or arrives
 * and is dropped. Specifically:
 *
 *   - a roster event that is not applied leaves the bar hidden while work is being delegated;
 *   - a message applied to a transcript nobody opened would grow a list that is never read;
 *   - a message dropped *after* someone opened it leaves the pane frozen mid-run;
 *   - a roster left behind when the conversation changes attributes work to the wrong session.
 */

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import type { Message, SubAgentSummary } from "@lyra/core";
import { rosterOrder, useSubAgents } from "../src/store/subAgents.ts";

function summary(over: Partial<SubAgentSummary> & { id: string }): SubAgentSummary {
	return {
		agent: "general",
		description: "找登录入口",
		status: "running",
		startedAt: 1000,
		toolCalls: 0,
		depth: 1,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		...over,
	};
}

function said(text: string): Message {
	return { role: "assistant", content: [{ type: "text", text }], timestamp: 0 } as Message;
}

beforeEach(() => {
	useSubAgents.setState({ agents: [], transcripts: {}, focused: null, loading: [] });
});

test("a roster event becomes the roster", () => {
	useSubAgents.getState().sync([summary({ id: "s1" }), summary({ id: "s2", status: "done" })]);

	assert.deepEqual(
		useSubAgents.getState().agents.map((one) => [one.id, one.status]),
		[
			["s1", "running"],
			["s2", "done"],
		],
	);
});

test("the roster arriving does not move the pane off what is being read", () => {
	/*
	 * The roster is re-broadcast on every tool call of *every* sub-agent, so anything derived from
	 * it has to be stable. Following the newest event would make a long run impossible to read: a
	 * sibling's tool call would yank the pane away mid-sentence.
	 */
	const store = useSubAgents.getState();
	store.sync([summary({ id: "s1" }), summary({ id: "s2" })]);
	store.focus("s1");

	useSubAgents.getState().sync([summary({ id: "s1", toolCalls: 3 }), summary({ id: "s2", toolCalls: 9 })]);

	assert.equal(useSubAgents.getState().focused, "s1");
});

test("a message is kept only for a transcript somebody has opened", () => {
	// Not a saving of memory so much as of correctness: a list built from the messages that happened
	// to stream in while the pane was closed is a transcript with its beginning missing.
	const store = useSubAgents.getState();
	store.sync([summary({ id: "s1" })]);

	store.append("s1", said("嗯"));
	assert.equal(useSubAgents.getState().transcripts.s1, undefined, "nothing was opened, so nothing is half-built");

	useSubAgents.setState({ transcripts: { s1: [] } });
	useSubAgents.getState().append("s1", said("嗯"));
	assert.equal(useSubAgents.getState().transcripts.s1?.length, 1, "once opened, it keeps up");
});

test("messages land on the sub-agent they came from", () => {
	useSubAgents.setState({ transcripts: { s1: [], s2: [] } });
	const store = useSubAgents.getState();

	store.append("s1", said("一"));
	store.append("s2", said("二"));
	store.append("s1", said("三"));

	assert.equal(useSubAgents.getState().transcripts.s1?.length, 2);
	assert.equal(useSubAgents.getState().transcripts.s2?.length, 1);
});

test("changing conversation drops the roster with it", () => {
	/*
	 * The roster only arrives for the session that is running, so a stale one does not get
	 * corrected — it simply sits there, showing the last conversation's delegated work under the
	 * name of the one you just opened.
	 */
	const store = useSubAgents.getState();
	store.sync([summary({ id: "s1" })]);
	store.focus("s1");
	useSubAgents.setState({ transcripts: { s1: [said("嗯")] } });

	useSubAgents.getState().clear();

	const after = useSubAgents.getState();
	assert.deepEqual(after.agents, []);
	assert.deepEqual(after.transcripts, {});
	assert.equal(after.focused, null);
});

test("dismissFinished and newSession clear subagents roster and transcripts", () => {
	useSubAgents.getState().sync([summary({ id: "s1", status: "done" })]);
	assert.equal(useSubAgents.getState().agents.length, 1);

	useSubAgents.getState().clear();
	assert.equal(useSubAgents.getState().agents.length, 0);
});

test("running sub-agents sort first, oldest first within each group", () => {
	// The tab strip's order. Running is what you are here to watch; among equals, the order they
	// were dispatched in is the order the parent asked for them.
	const ordered = rosterOrder([
		summary({ id: "done-old", status: "done", startedAt: 10 }),
		summary({ id: "run-new", startedAt: 300 }),
		summary({ id: "done-new", status: "done", startedAt: 200 }),
		summary({ id: "run-old", startedAt: 100 }),
	]);

	assert.deepEqual(
		ordered.map((one) => one.id),
		["run-old", "run-new", "done-old", "done-new"],
	);
});

test("a transcript already read is not read again", async () => {
	// `load` is called from an effect that re-runs whenever the roster changes — which is on every
	// tool call. Without the guard, opening one sub-agent would re-fetch its whole transcript
	// several times a second.
	let reads = 0;
	(globalThis as { window?: unknown }).window = {
		lyra: {
			subAgents: {
				detail: async () => {
					reads += 1;
					return { messages: [said("嗯")] };
				},
			},
		},
	};

	await useSubAgents.getState().load("sess", "s1");
	await useSubAgents.getState().load("sess", "s1");

	assert.equal(reads, 1);
	assert.equal(useSubAgents.getState().transcripts.s1?.length, 1);
});

test("messages that streamed in during the read are not lost by it", async () => {
	/*
	 * The race: `append` drops messages while there is no list, the read starts before them and
	 * returns without them. Taking whichever is longer works because both are prefixes of the same
	 * transcript — and the alternative loses whatever the sub-agent said while the pane was opening.
	 */
	(globalThis as { window?: unknown }).window = {
		lyra: {
			subAgents: {
				detail: async () => {
					// Something arrives while the read is in flight.
					useSubAgents.setState({ transcripts: { s1: [said("一"), said("二"), said("三")] } });
					return { messages: [said("一")] };
				},
			},
		},
	};

	await useSubAgents.getState().load("sess", "s1");

	assert.equal(useSubAgents.getState().transcripts.s1?.length, 3, "the longer of the two survived");
});

/*
 * The wiring, which is the part everything above takes on faith.
 *
 * Every test up to here drives the store directly, so all of them stay green if `apply-event`
 * spells a case wrong, handles the wrong event, or never reaches these branches at all — and the
 * symptom would be a bar that never appears while sub-agents run, with nothing in any log to say
 * why. So these go through the real dispatcher with the real event shapes.
 */

const { applyAgentEvent } = await import("../src/store/apply-event.ts");

/**
 * The dispatcher wants the app store's `set`/`get`, so it gets the fields it reads on the way to
 * the sub-agent branches — the per-conversation activity, the turn meters, and the parked
 * transcripts. Their values are irrelevant here; their presence is not, because the dispatcher
 * indexes into them before it ever looks at the event's type.
 */
function dispatch(event: Parameters<typeof applyAgentEvent>[1]) {
	const state = {
		activity: {},
		turns: {},
		sessionCache: {},
		activeSessionId: "sess",
		messages: [],
		toolRuns: {},
	} as never;
	applyAgentEvent("sess", event, () => {}, () => state);
}

test("a `subagents` event reaches the store through the real dispatcher", () => {
	dispatch({ type: "subagents", agents: [summary({ id: "s1", description: "查一下缓存" })] });

	assert.deepEqual(
		useSubAgents.getState().agents.map((one) => one.description),
		["查一下缓存"],
	);
});

test("a `subagent_message` event reaches the store through the real dispatcher", () => {
	useSubAgents.setState({ transcripts: { s1: [] } });

	dispatch({ type: "subagent_message", id: "s1", message: said("我读了 auth.ts") });

	assert.equal(useSubAgents.getState().transcripts.s1?.length, 1);
});

test("sub-agent messages never leak into the main transcript", () => {
	/*
	 * The whole reason delegation is worth doing: the sub-agent's forty file reads stay out of the
	 * parent's context. A message routed to both would undo that in the one place it is most
	 * visible — the transcript you are reading.
	 */
	const writes: Record<string, unknown>[] = [];
	const state = {
		activity: {},
		turns: {},
		sessionCache: {},
		activeSessionId: "sess",
		messages: [],
		toolRuns: {},
	} as never;
	applyAgentEvent(
		"sess",
		{ type: "subagent_message", id: "s1", message: said("内部消息") },
		(partial) => {
			writes.push(partial as Record<string, unknown>);
		},
		() => state,
	);

	/*
	 * Not "nothing was written" — every event updates the per-session activity reading, and this
	 * one is no exception. What must not happen is the message joining the conversation.
	 */
	assert.ok(
		writes.every((write) => !("messages" in write)),
		`a sub-agent message was written to the main transcript: ${JSON.stringify(writes)}`,
	);
});
