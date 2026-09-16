/**
 * Production-path checks against the real blow-up file and the live session, not fixtures.
 */

import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { runAgent } from "../src/agent/loop.ts";
import { SessionStore } from "../src/session/store.ts";
import { grepTool } from "../src/tools/grep.ts";
import { emptyUsage, type Message } from "../src/types.ts";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..", "..");
const CATALOG = "packages/core/src/catalog/model-catalog.json";

function textOf(message: Message): string {
	return message.role === "toolResult" ? message.content.filter((part) => part.type === "text").map((part) => part.text).join("") : "";
}

const model = { id: "m", modelId: "m", providerId: "p", name: "m", contextWindow: 200000, maxOutputTokens: 100, supportsThinking: false, supportsImages: false, supportsTools: true };
const provider = { id: "p", name: "p", api: "openai-responses" as const, baseUrl: "http://localhost", apiKey: "", enabled: true, models: [model] };

test("ripgrep on the real 1.7 MB model-catalog.json stays inside the 12 000-character gate", async () => {
	const result = await grepTool.execute({ pattern: "schema", path: CATALOG }, { cwd: ROOT, sessionId: "live-grep", state: new Map() });
	const text = result.content.map((part) => part.text).join("");
	const catalog = (await import("node:fs/promises")).stat(join(ROOT, CATALOG));
	const size = (await catalog).size;
	assert.ok(size > 1_600_000, `catalog was ${size} bytes; this is not the blow-up file`);
	assert.ok(text.length <= 12_000, `live grep returned ${text.length} characters`);
	assert.ok(JSON.stringify(result.details ?? {}).length < 20_000, "details cannot smuggle the line back in");
	assert.match(text, /model-catalog\.json/);
	assert.match(text, /omitted|truncated/);
	console.log(JSON.stringify({ liveGrepChars: text.length, catalogBytes: size, detailsChars: JSON.stringify(result.details ?? {}).length }));
});

test("a name past the first 2000 characters of model-catalog.json is still returned", async () => {
	const name = "Qwen3-LiveTranslate Flash Realtime";
	const result = await grepTool.execute({ pattern: name, path: CATALOG }, { cwd: ROOT, sessionId: "live-grep-mid", state: new Map() });
	const text = result.content.map((part) => part.text).join("");
	assert.ok(text.includes(name), "the match window must include the name, not only the line head");
	assert.ok(text.length <= 12_000, `live mid-line grep returned ${text.length} characters`);
});

test("the recorded blow-up session is cut on the same prepare path the loop uses", async (t) => {
	const root = join(homedir(), ".lyra", "sessions");
	let project = "";
	let session = "";
	for (const dir of await readdir(root, { withFileTypes: true }).catch(() => [])) {
		if (!dir.isDirectory()) continue;
		for (const file of await readdir(join(root, dir.name))) {
			if (file.startsWith("afdc7f6d") && file.endsWith(".jsonl")) {
				project = dir.name;
				session = file.slice(0, -6);
			}
		}
	}
	if (!session) {
		t.skip("afdc7f6d is not on this machine");
		return;
	}

	const original = await new SessionStore(root).messages(project, session);
	const greps = original.filter((message) => message.role === "toolResult" && message.toolName === "grep").map((message) => ({ id: message.role === "toolResult" ? message.toolCallId : "", chars: textOf(message) }));
	const blowup = greps.sort((a, b) => b.chars.length - a.chars.length)[0];
	assert.ok(blowup && blowup.chars.length > 1_000_000, `largest logged grep was ${blowup?.chars.length ?? 0} characters`);

	let sent: Message[] = [];
	await runAgent(
		{
			sessionId: session,
			cwd: ROOT,
			model,
			provider,
			messages: [...original],
			tools: [],
			systemPrompt: "",
			streamFn: async (context) => {
				sent = context.messages;
				return {
					role: "assistant",
					api: "openai-responses",
					provider: "test",
					model: "test",
					stopReason: "stop",
					usage: emptyUsage(),
					content: [{ type: "text", text: "probe" }],
					timestamp: Date.now(),
				};
			},
		},
		async () => {},
	);

	const sentBlowup = sent.find((message) => message.role === "toolResult" && message.toolCallId === blowup.id);
	const sentChars = sentBlowup ? textOf(sentBlowup).length : -1;
	const logged = original.find((message) => message.role === "toolResult" && message.toolCallId === blowup.id);
	console.log(JSON.stringify({ session: `${project}/${session}`, loggedGrepChars: blowup.chars.length, sentGrepChars: sentChars, logUnchanged: logged ? textOf(logged).length : 0, messages: original.length, sent: sent.length }));
	assert.ok(sentBlowup, "the paired grep still travels with the request");
	assert.ok(sentChars <= 16_000, `loop sent ${sentChars} characters of the 1.7 MB grep`);
	assert.equal(logged && textOf(logged).length, blowup.chars.length, "the session log is a view");
});
