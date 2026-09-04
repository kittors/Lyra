/**
 * When the offer to save a rule is allowed to happen at all.
 *
 * The classifier is tested next door; what is tested here is everything that decides whether it
 * runs — because every one of those gates is the difference between a feature and a thing people
 * turn off. An offer after a turn somebody stopped, a fourth offer in one session, a card with no
 * rule text in it: each is individually small and collectively the reason nobody trusts the card.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentEvent } from "../src/agent/events.ts";
import { DEFAULT_SETTINGS, type Settings } from "../src/config/settings.ts";
import { OfferBudget } from "../src/rules/from-correction.ts";
import { CLASSIFY_TIMEOUT_MS, offerRuleFromCorrection } from "../src/runtime/rule-offer.ts";
import type { AssistantMessage, Message, ModelConfig, ProviderConfig } from "../src/types.ts";

const PROVIDER = { id: "p", name: "P", baseUrl: "x", api: "openai-responses", apiKey: "k", enabled: true, models: [] } as unknown as ProviderConfig;
const MODEL = { id: "m", providerId: "p", modelId: "m", name: "会话的模型", contextWindow: 100_000, maxOutputTokens: 4096 } as unknown as ModelConfig;

function conversation(): Message[] {
	return [
		{
			role: "assistant",
			content: [
				{ type: "text", text: "改好了" },
				{ type: "toolCall", id: "c0", name: "edit", arguments: { path: "a.ts", patch: "+const x: any = 1;" }, argumentsText: "{}" },
			],
			api: "openai-responses",
			provider: "p",
			model: "m",
			usage: {},
			stopReason: "stop",
			timestamp: 0,
		} as AssistantMessage,
		{ role: "user", content: [{ type: "text", text: "这个仓库不用 any" }], timestamp: 0 },
	];
}

/** A stream that answers with the given text, recording which model it was asked for. */
function answering(text: string, seen?: { model?: ModelConfig }) {
	return ((_provider: ProviderConfig, model: ModelConfig) => {
		if (seen) seen.model = model;
		const message = {
			role: "assistant",
			content: [{ type: "text", text }],
			api: "openai-responses",
			provider: "p",
			model: "m",
			usage: {},
			stopReason: "stop",
			timestamp: 0,
		} as AssistantMessage;
		return (async function* () {
			yield { type: "text_delta" as const, index: 0, delta: text, partial: message };
			return message;
		})();
	}) as never;
}

const CORRECTION = '{"isCorrection": true, "condition": ":\\\\s*any\\\\b", "scope": "tool:edit", "name": "no-any", "body": "这个仓库不用 any。"}';

function collect() {
	const events: AgentEvent[] = [];
	return { events, emit: (event: AgentEvent) => void events.push(event) };
}

test("a correction becomes an offer", async () => {
	const sink = collect();
	const budget = new OfferBudget();
	const offered = await offerRuleFromCorrection({
		messages: conversation(),
		settings: DEFAULT_SETTINGS,
		provider: PROVIDER,
		model: MODEL,
		stream: answering(CORRECTION),
		budget,
		emit: sink.emit,
	});

	assert.equal(offered, true);
	const event = sink.events[0];
	assert.equal(event?.type, "rule_suggested");
	assert.equal(event.type === "rule_suggested" && event.name, "no-any");
	assert.equal(event.type === "rule_suggested" && event.condition, ":\\s*any\\b");
	assert.equal(budget.exhausted, false, "one offer does not use up the session");
});

test("an ordinary instruction is not one", async () => {
	const sink = collect();
	const offered = await offerRuleFromCorrection({
		messages: conversation(),
		settings: DEFAULT_SETTINGS,
		provider: PROVIDER,
		model: MODEL,
		stream: answering('{"isCorrection": false}'),
		budget: new OfferBudget(),
		emit: sink.emit,
	});

	assert.equal(offered, false);
	assert.equal(sink.events.length, 0);
});

test("a suggestion with no rule text is not offered", async () => {
	/*
	 * The card's whole content is the body. One without it would be a prompt to save nothing, and
	 * whichever button got pressed the result would be an empty rule file.
	 */
	const sink = collect();
	const offered = await offerRuleFromCorrection({
		messages: conversation(),
		settings: DEFAULT_SETTINGS,
		provider: PROVIDER,
		model: MODEL,
		stream: answering('{"isCorrection": true, "name": "x", "body": ""}'),
		budget: new OfferBudget(),
		emit: sink.emit,
	});

	assert.equal(offered, false);
	assert.equal(sink.events.length, 0);
});

test("an exhausted budget does not even ask", async () => {
	let called = false;
	const budget = new OfferBudget();
	budget.recordRefusal();
	budget.recordRefusal();

	const offered = await offerRuleFromCorrection({
		messages: conversation(),
		settings: DEFAULT_SETTINGS,
		provider: PROVIDER,
		model: MODEL,
		stream: (() => {
			called = true;
			return answering(CORRECTION);
		}) as never,
		budget,
		emit: collect().emit,
	});

	assert.equal(offered, false);
	assert.equal(called, false, "no request is made, so a silenced session costs nothing");
});

test("a turn the user stopped is not followed by an offer", async () => {
	/*
	 * They pressed stop. Whatever just happened, they were not happy with it, and "shall I make
	 * that permanent?" is the wrong question at that moment.
	 */
	let called = false;
	const controller = new AbortController();
	controller.abort();

	const offered = await offerRuleFromCorrection({
		messages: conversation(),
		settings: DEFAULT_SETTINGS,
		provider: PROVIDER,
		model: MODEL,
		stream: (() => {
			called = true;
			return answering(CORRECTION);
		}) as never,
		budget: new OfferBudget(),
		signal: controller.signal,
		emit: collect().emit,
	});

	assert.equal(offered, false);
	assert.equal(called, false);
});

test("the @fast role is what gets asked, not the session's model", async () => {
	/*
	 * This is the call the role exists for — one small JSON answer, where cheap matters more than
	 * clever. Without this the classification runs on whatever the conversation is using, which on
	 * a session driving an expensive model is a surcharge on every turn.
	 */
	const settings: Settings = {
		...DEFAULT_SETTINGS,
		modelRoles: { fast: "p/cheap" },
		providers: [
			{
				...PROVIDER,
				models: [{ id: "p/cheap", providerId: "p", modelId: "cheap", name: "便宜的", contextWindow: 8000, maxOutputTokens: 1024 }],
			} as unknown as ProviderConfig,
		],
	};

	const seen: { model?: ModelConfig } = {};
	await offerRuleFromCorrection({
		messages: conversation(),
		settings,
		provider: PROVIDER,
		model: MODEL,
		stream: answering(CORRECTION, seen),
		budget: new OfferBudget(),
		emit: collect().emit,
	});

	assert.equal(seen.model?.name, "便宜的");
});

test("with no @fast configured it falls back to the session's model", async () => {
	const seen: { model?: ModelConfig } = {};
	await offerRuleFromCorrection({
		messages: conversation(),
		settings: DEFAULT_SETTINGS,
		provider: PROVIDER,
		model: MODEL,
		stream: answering(CORRECTION, seen),
		budget: new OfferBudget(),
		emit: collect().emit,
	});

	assert.equal(seen.model?.name, "会话的模型");
});

test("a provider that throws does not fail a turn that had already succeeded", async () => {
	const sink = collect();
	const offered = await offerRuleFromCorrection({
		messages: conversation(),
		settings: DEFAULT_SETTINGS,
		provider: PROVIDER,
		model: MODEL,
		stream: (() => {
			throw new Error("连接被重置");
		}) as never,
		budget: new OfferBudget(),
		emit: sink.emit,
	});

	assert.equal(offered, false);
	assert.equal(sink.events.length, 0);
});

test("the wait is bounded", () => {
	/*
	 * Nobody is watching this call, which is exactly why it needs a limit: the turn's controller and
	 * the task queue behind it are held until it returns.
	 */
	assert.ok(CLASSIFY_TIMEOUT_MS > 0 && CLASSIFY_TIMEOUT_MS <= 60_000);
});

test("three offers use up a session", async () => {
	const budget = new OfferBudget();
	const sink = collect();
	const ask = () =>
		offerRuleFromCorrection({
			messages: conversation(),
			settings: DEFAULT_SETTINGS,
			provider: PROVIDER,
			model: MODEL,
			stream: answering(CORRECTION),
			budget,
			emit: sink.emit,
		});

	assert.equal(await ask(), true);
	assert.equal(await ask(), true);
	assert.equal(await ask(), true);
	assert.equal(await ask(), false, "the fourth is where it becomes a nag");
	assert.equal(sink.events.length, 3);
});
