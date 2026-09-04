/**
 * That the offer is actually connected to the end of a turn.
 *
 * A separate file from `rule-offer.test.ts` on purpose. That one tests the decision; this one tests
 * that anything calls it — which in this codebase has been the failure worth guarding against. Five
 * times now a field has been parsed carefully, tested thoroughly and never read by the product, and
 * every one of those had a green unit test next to it.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { AgentEvent } from "../src/agent/events.ts";
import { DEFAULT_SETTINGS } from "../src/config/settings.ts";
import { SessionCapabilities } from "../src/runtime/session-capabilities.ts";
import { SessionLog } from "../src/runtime/session-log.ts";
import { driveTurn } from "../src/runtime/session-turn.ts";
import type { SessionMeta } from "../src/session/store.ts";
import type { SessionStorage } from "../src/session/storage.ts";
import type { AssistantMessage, ModelConfig, ProviderConfig } from "../src/types.ts";

let root: string;
let home: string;

const PROVIDER = { id: "p", name: "P", baseUrl: "x", api: "openai-responses", apiKey: "k", enabled: true, models: [] } as unknown as ProviderConfig;
const MODEL = { id: "m", providerId: "p", modelId: "m", name: "M", contextWindow: 100_000, maxOutputTokens: 4096 } as unknown as ModelConfig;

const META = { id: "s1", projectId: "proj", cwd: "", modelId: "m", title: "", createdAt: 0, updatedAt: 0 } as unknown as SessionMeta;

/** Enough of a store to append to. Nothing here reads anything back. */
const STORE = { append: async (meta: SessionMeta) => meta } as unknown as SessionStorage;

function reply(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-responses",
		provider: "p",
		model: "m",
		usage: {},
		stopReason: "stop",
		timestamp: Date.now(),
	} as AssistantMessage;
}

before(async () => {
	root = await mkdtemp(join(tmpdir(), "ly-wire-"));
	home = await mkdtemp(join(tmpdir(), "ly-wire-home-"));
	process.env.LYRA_HOME = home;
});

after(async () => {
	delete process.env.LYRA_HOME;
	await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
	await rm(home, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
});

/**
 * Run one turn the way the session does, with both provider calls scripted.
 *
 * The first call is the turn itself; the second is the classification, which only happens if the
 * wiring exists. Counting them is how "never called" is told apart from "called and said no".
 */
async function oneTurn(userText: string, classification: string) {
	const events: AgentEvent[] = [];
	const can = new SessionCapabilities();
	const log = new SessionLog(STORE, async () => {}, { ...META, cwd: root });
	await log.commit({ role: "user", content: [{ type: "text", text: userText }], timestamp: Date.now() });

	let calls = 0;
	await driveTurn({
		cwd: root,
		settings: DEFAULT_SETTINGS,
		log,
		can,
		provider: PROVIDER,
		model: MODEL,
		signal: new AbortController().signal,
		scratchDir: join(root, "scratch"),
		streamFn: async () => {
			calls += 1;
			return reply(calls === 1 ? "好的，我改一下。" : classification);
		},
		requestApproval: async () => ({ decision: "allow" }) as never,
		emit: async (event) => void events.push(event),
		drainSteering: () => [],
	});

	return { events, calls, can };
}

test("a turn that ends in a correction produces an offer", async () => {
	const { events, calls } = await oneTurn(
		"别用 npm，这个仓库只用 pnpm",
		'{"isCorrection": true, "condition": "\\\\bnpm\\\\b", "scope": "tool:bash", "name": "pnpm-only", "body": "这个仓库只用 pnpm。"}',
	);

	assert.equal(calls, 2, "the classification call is made at all");
	const offer = events.find((event) => event.type === "rule_suggested");
	assert.ok(offer, "and the event reaches the session's emit, not just the classifier's return");
	assert.equal(offer.type === "rule_suggested" && offer.name, "pnpm-only");
});

test("an ordinary turn produces nothing", async () => {
	const { events } = await oneTurn("帮我加个测试", '{"isCorrection": false}');
	assert.equal(
		events.some((event) => event.type === "rule_suggested"),
		false,
	);
});

test("the budget it spends is the session's, not a fresh one per turn", async () => {
	/*
	 * The whole throttle depends on this. A budget created inside the turn would reset every time,
	 * and "three per session" would silently become "one per turn, forever".
	 */
	const { can } = await oneTurn("别用 var", '{"isCorrection": true, "name": "no-var", "body": "别用 var。"}');
	assert.equal(can.correctionBudget.exhausted, false);
	can.correctionBudget.recordOffer();
	can.correctionBudget.recordOffer();
	assert.equal(can.correctionBudget.exhausted, true, "one already spent, plus two, is three");
});
