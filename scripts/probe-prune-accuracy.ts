/**
 * Real-provider check: can the agent finish a task whose answer sits past the grep
 * line cap, and does the gated result stay two orders of magnitude smaller than the file?
 *
 * Isolated temp workspace. Credentials come from ~/.lyra and are never printed.
 * The temp dir is removed afterwards — nothing is left in the user's home.
 */
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAgent } from "../packages/core/src/agent/loop.ts";
import { loadSettings } from "../packages/core/src/config/settings.ts";
import { buildSystemPrompt } from "../packages/core/src/prompt/system.ts";
import { editTool } from "../packages/core/src/tools/edit.ts";
import { grepTool } from "../packages/core/src/tools/grep.ts";
import { lsTool } from "../packages/core/src/tools/ls.ts";
import { readTool } from "../packages/core/src/tools/read.ts";
import type { AssistantMessage, Message, ModelConfig, ProviderConfig, Tool, Usage } from "../packages/core/src/types.ts";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CATALOG = join(ROOT, "packages/core/src/catalog/model-catalog.json");
const NAME = "Qwen3-LiveTranslate Flash Realtime";
const SECRET_AFTER = "BETA-2C7";
const TOOLS = [grepTool, readTool, editTool, lsTool];

interface RequestSnap {
	index: number;
	toolResultChars: number;
	toolResults: number;
	usage?: Usage;
	stop?: string;
}

function textOf(message: Message): string {
	if (message.role === "toolResult" || message.role === "assistant" || message.role === "user") {
		return message.content
			.filter((part): part is { type: "text"; text: string } => part.type === "text")
			.map((part) => part.text)
			.join("");
	}
	return "";
}

function toolChars(messages: Message[]): { chars: number; count: number } {
	let chars = 0;
	let count = 0;
	for (const message of messages) {
		if (message.role !== "toolResult") continue;
		count += 1;
		chars += textOf(message).length;
	}
	return { chars, count };
}

function lastAssistant(messages: Message[]): AssistantMessage | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role === "assistant") return message;
	}
}

function pickModel(settings: Awaited<ReturnType<typeof loadSettings>>, wanted: string | undefined): { provider: ProviderConfig; model: ModelConfig } {
	const matches: { provider: ProviderConfig; model: ModelConfig }[] = [];
	for (const provider of settings.providers) {
		if (!provider.enabled || !provider.apiKey) continue;
		for (const model of provider.models) {
			if (!model.supportsTools) continue;
			matches.push({ provider, model });
		}
	}
	if (matches.length === 0) throw new Error("No enabled tool-capable model with a key in ~/.lyra");
	if (!wanted) {
		const preferred = settings.defaultModelId;
		return (preferred && matches.find(({ model }) => model.id === preferred || model.modelId === preferred)) ?? matches[0];
	}
	const found = matches.find(({ provider, model }) =>
		model.id === wanted || model.modelId === wanted || `${provider.id}/${model.modelId}` === wanted,
	);
	if (!found) throw new Error(`Model ${wanted} is not configured`);
	return found;
}

async function runTask(input: {
	cwd: string;
	prompt: string;
	provider: ProviderConfig;
	model: ModelConfig;
	label: string;
	tools?: Tool[];
}): Promise<{ reason: string; reply: string; requests: RequestSnap[]; error?: string }> {
	const tools = input.tools ?? TOOLS;
	const requests: RequestSnap[] = [];
	const systemPrompt = await buildSystemPrompt({
		cwd: input.cwd,
		tools,
		skills: [],
		projectInstructions: [],
		platform: process.platform,
		modelName: input.model.name ?? input.model.modelId,
		isGitRepo: false,
	});
	const result = await runAgent(
		{
			sessionId: `probe-prune-${input.label}`,
			cwd: input.cwd,
			provider: input.provider,
			model: input.model,
			systemPrompt,
			tools,
			messages: [{ role: "user", content: [{ type: "text", text: input.prompt }], timestamp: Date.now() }],
			thinking: "off",
			retryAttempts: 2,
			maxTurns: 8,
			signal: AbortSignal.timeout(180_000),
			requestApproval: async () => "once",
		},
		async () => {},
	);
	const produced = result.messages;
	let index = 0;
	for (const message of produced) {
		if (message.role !== "assistant") continue;
		const prior = produced.slice(0, produced.indexOf(message));
		const tools = toolChars(prior);
		requests.push({
			index: index++,
			toolResultChars: tools.chars,
			toolResults: tools.count,
			usage: message.usage,
			stop: message.stopReason,
		});
	}
	const reply = lastAssistant(produced);
	return {
		reason: result.reason,
		reply: reply ? textOf(reply) : "",
		requests,
		error: result.error ?? reply?.errorMessage,
	};
}

const dir = await mkdtemp(join(tmpdir(), "lyra-prune-accuracy-"));
const started = Date.now();
try {
	const settings = await loadSettings();
	const { provider, model } = pickModel(settings, process.argv[2]);
	const probe = `LYRA-${randomBytes(4).toString("hex").toUpperCase()}`;
	const catalog = (await readFile(CATALOG, "utf8")).replace(
		'"id":"qwen3-livetranslate-flash-realtime"',
		`"id":"qwen3-livetranslate-flash-realtime","probe":"${probe}"`,
	);
	await writeFile(join(dir, "catalog.json"), catalog);
	await writeFile(join(dir, "note.txt"), "# workspace note\nSECRET=ALPHA-9F3\n");

	const gated = await grepTool.execute(
		{ pattern: NAME, path: "catalog.json" },
		{ cwd: dir, sessionId: "probe-gate", state: new Map() },
	);
	const gatedText = gated.content.map((part) => part.text).join("");
	const catalogBytes = catalog.length;

	const catalogTask = await runTask({
		cwd: dir,
		provider,
		model,
		label: "catalog",
		prompt:
			`catalog.json is a model catalog (one JSON file). Find the probe field of the entry whose name is exactly "${NAME}". ` +
			"Reply with only that probe value.",
	});
	const secretTask = await runTask({
		cwd: dir,
		provider,
		model,
		label: "secret",
		prompt: "Read note.txt. Change the SECRET value to BETA-2C7. Reply with only the new SECRET value.",
	});
	const nameAt = catalog.indexOf(NAME);
	const readTask = await runTask({
		cwd: dir,
		provider,
		model,
		label: "read-window",
		tools: [readTool],
		prompt:
			`catalog.json is a single-line JSON file. Read it with char_offset=${Math.max(1, nameAt - 80)} and find the probe ` +
			`field of the entry whose name is exactly "${NAME}". Reply with only that probe value.`,
	});
	const note = await readFile(join(dir, "note.txt"), "utf8");

	const catalogOk = catalogTask.reply.includes(probe);
	const secretOk = note.includes(SECRET_AFTER) && secretTask.reply.includes(SECRET_AFTER);
	const readOk = readTask.reply.includes(probe);
	const gateOk = gatedText.includes(NAME) && gatedText.includes(probe) && gatedText.length <= 12_000;
	const saved = catalogBytes - gatedText.length;
	const summary = {
		model: `${provider.id}/${model.modelId}`,
		elapsedMs: Date.now() - started,
		gate: {
			catalogBytes,
			grepChars: gatedText.length,
			savedChars: saved,
			ratio: Number((gatedText.length / catalogBytes).toFixed(4)),
			needleVisible: gateOk,
		},
		catalog: {
			ok: catalogOk,
			reason: catalogTask.reason,
			error: catalogTask.error,
			reply: catalogTask.reply.slice(0, 240),
			requests: catalogTask.requests,
		},
		secret: {
			ok: secretOk,
			fileHasNewSecret: note.includes(SECRET_AFTER),
			reason: secretTask.reason,
			error: secretTask.error,
			reply: secretTask.reply.slice(0, 240),
			requests: secretTask.requests,
		},
		readWindow: {
			ok: readOk,
			reason: readTask.reason,
			error: readTask.error,
			reply: readTask.reply.slice(0, 240),
			requests: readTask.requests,
		},
		passed: gateOk && catalogOk && secretOk && readOk,
	};
	console.log(JSON.stringify(summary, null, 2));
	if (!summary.passed) process.exitCode = 1;
} finally {
	await rm(dir, { recursive: true, force: true });
}
