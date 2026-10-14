/**
 * The adversarial check this feature was designed against (Codewhale#6263's acceptance test).
 *
 * A high-entropy sentinel is typed into a card, handed to a command, printed by it in four encodings,
 * handed out again by the askpass helper, and printed once more from inside a sub-agent. Then every
 * place a value must never reach is searched for it: each request sent to the model, each event sent
 * to a window, and every byte under the session database and the app's home directory. It must be
 * found nowhere — and still be readable from the broker, or the test would pass by losing it.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AgentEvent } from "../src/agent/events.ts";
import { DEFAULT_SETTINGS, type Settings } from "../src/config/settings.ts";
import { CredentialBroker } from "../src/credentials/broker.ts";
import { memoryStore } from "../src/credentials/store.ts";
import { AgentSession } from "../src/runtime/session.ts";
import { SessionStore } from "../src/session/store.ts";
import { emptyUsage, type AssistantMessage, type ModelConfig, type ProviderConfig } from "../src/types.ts";

const MODEL: ModelConfig = { id: "fake/model", providerId: "fake", modelId: "model", name: "Fake", contextWindow: 100_000, maxOutputTokens: 4096, supportsThinking: false, supportsImages: false, supportsTools: true };
const PROVIDER: ProviderConfig = { id: "fake", name: "Fake", baseUrl: "http://localhost", api: "openai-responses", apiKey: "x", enabled: true, models: [MODEL] };
const SETTINGS: Settings = { ...DEFAULT_SETTINGS, providers: [PROVIDER], defaultModelId: MODEL.id, mcpServers: [], permissionMode: "full" };

let calls = 0;
const reply = (content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"]): AssistantMessage => ({
	role: "assistant",
	content,
	api: "openai-responses",
	provider: "fake",
	model: "model",
	usage: emptyUsage(),
	stopReason,
	timestamp: Date.now(),
});
const call = (name: string, args: Record<string, unknown>) => reply([{ type: "toolCall", id: `call-${++calls}`, name, arguments: args }], "toolUse");
const say = (text: string) => reply([{ type: "text", text }], "stop");

/** Every encoding the masker promises to catch, and the helper handing the password out on request. */
const PRINT = [
	`printf 'raw=%s\\n' "$PROBE_PW"`,
	`printf '%s' "$PROBE_PW" | base64`,
	`node -e 'console.log("url=" + encodeURIComponent(process.env.PROBE_PW) + " json=" + JSON.stringify({ p: process.env.PROBE_PW }))'`,
	`echo "askpass=$("$SSH_ASKPASS" "root@probe.example's password: ")"`,
].join("; ");

async function files(dir: string): Promise<string[]> {
	const out: string[] = [];
	for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...(await files(path)));
		else if (entry.isFile()) out.push(path);
	}
	return out;
}

test("哨兵值走完整条链路之后，除了凭据服务本身，哪里都搜不到它", { skip: process.platform === "win32" }, async () => {
	const root = await mkdtemp(join(tmpdir(), "ly-sentinel-"));
	const home = join(root, "home");
	await mkdir(home, { recursive: true });
	process.env.LYRA_HOME = home;
	const SENTINEL = `S3NT-${randomBytes(12).toString("hex")}`;
	const forms = [SENTINEL, encodeURIComponent(`=${SENTINEL}`).slice(3), Buffer.from(SENTINEL).toString("base64").slice(0, 24)];

	const main = [
		call("request_credential", { name: "probe-pw", title: "probe", purpose: "the sentinel test", kind: "password", target: "ssh://root@probe.example" }),
		call("bash", { command: PRINT, credentials: ["probe-pw"] }),
		// A path only the exit can catch: the value goes into a file, and comes back through `read`.
		call("bash", { command: `printf 'kept=%s\\n' "$PROBE_PW" > kept.txt`, credentials: ["probe-pw"] }),
		call("read", { path: "kept.txt" }),
		call("task", { description: "print it again", prompt: "print it", agentType: "general" }),
		say("done"),
	];
	const sub = [call("bash", { command: PRINT, credentials: ["probe-pw"] }), say("printed")];

	const broker = new CredentialBroker({ vault: memoryStore(), runtimeDir: tmpdir });
	const events: AgentEvent[] = [];
	const requests: string[] = [];
	let session!: AgentSession;
	session = new AgentSession({
		cwd: root,
		settings: SETTINGS,
		store: new SessionStore(join(root, "sessions")),
		credentials: broker,
		emit: (event) => {
			events.push(event);
			// The person at the window: fills the card, and the card is answered "filled".
			if (event.type === "approval_request" && event.kind === "credential") {
				setTimeout(async () => {
					assert.deepEqual(await broker.submit(event.credential!.key, { values: { password: SENTINEL } }), { ok: true });
					session.resolveApproval(event.requestId, "once");
				}, 0);
			}
		},
		streamFn: async (context, config) => {
			requests.push(JSON.stringify(context));
			return (config.sessionId.includes(":sub:") ? sub.shift() : main.shift()) ?? say("nothing left");
		},
	});
	try {
		await session.initialize();
		await session.prompt([{ type: "text", text: "go" }]);

		const shown = JSON.stringify(events);
		assert.match(shown, /raw=\[credential:probe-pw\]/, "the command ran with the credential");
		assert.match(shown, /askpass=\[credential:probe-pw\]/, "the helper answered, and its answer was masked");
		assert.match(shown, /kept=\[credential:probe-pw\]/, "read the file back, masked on the way out");
		assert.equal(sub.length, 0);
		const delegated = JSON.stringify(events.filter((event) => event.type === "subagent_message" || event.type === "subagent_event"));
		assert.match(delegated, /raw=\[credential:probe-pw\]/, "the sub-agent ran it with the parent's credential");
		assert.equal(main.length, 0);

		for (const form of forms) {
			assert.equal(shown.includes(form), false, `no event carries ${form}`);
			assert.equal(requests.some((request) => request.includes(form)), false, `no request to the model carries ${form}`);
		}
		for (const file of [...(await files(join(root, "sessions"))), ...(await files(home))]) {
			const bytes = await readFile(file);
			for (const form of forms) assert.equal(bytes.includes(form), false, `${file} holds ${form}`);
		}
		assert.equal(broker.forSession(session.meta.id).reveal("probe-pw"), SENTINEL, "and the value itself was kept");
	} finally {
		session.dispose?.();
		delete process.env.LYRA_HOME;
		await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
	}
});
