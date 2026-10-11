/**
 * A relay that draws, for the image-generation probes: no top-level work, so it can be imported.
 *
 * It behaves like the CliRelay measured on 2026-10-11 in front of Gemini: the conversation model
 * streams a real `image_generate` call over Chat Completions, `/v1/images/generations` and the JSON
 * form of `/v1/images/edits` answer after a while with a JPEG in `b64_json`, and a request shaped for
 * a spent quota gets the 429 Antigravity sends.
 *
 * What the model does is decided by what the person last said: each scene has a cue, a call to make,
 * and a sentence to say once the call has come back.
 */

import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pause } from "./record.ts";

export interface Scene {
	cue: string;
	call: string;
	args: Record<string, unknown>;
	reply: string;
}

export interface Seen {
	path: string;
	body: Record<string, unknown>;
}

type ChatMessage = { role: string; content?: unknown };

/** Two flat illustrations standing in for what the model draws: a boat by day, the same boat at night. */
export async function boatPictures(): Promise<{ day: string; night: string }> {
	const dir = join(dirname(fileURLToPath(import.meta.url)), "assets");
	const read = async (name: string) => (await readFile(join(dir, name))).toString("base64");
	return { day: await read("image-gen-day.jpg"), night: await read("image-gen-night.jpg") };
}

async function bodyOf(req: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(chunk as Buffer);
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
	} catch {
		return {};
	}
}

/** The last thing a person said, skipping the `<env>` block the runtime appends to every turn. */
function lastWords(messages: ChatMessage[]): { text: string; index: number } {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message.role !== "user") continue;
		const parts = Array.isArray(message.content) ? (message.content as { type: string; text?: string }[]) : [{ type: "text", text: String(message.content ?? "") }];
		const text = parts.filter((part) => part.type === "text" && part.text && !part.text.trimStart().startsWith("<env>")).map((part) => part.text).join(" ");
		if (text.trim()) return { text, index };
	}
	return { text: "", index: -1 };
}

export async function startFakeImageRelay(options: {
	scenes: Scene[];
	art: { day: string; night: string };
	/** How long a drawing takes; long enough to watch the dots and the percentage move. */
	drawMs: number;
}): Promise<{ port: number; seen: Seen[]; close: () => void }> {
	const seen: Seen[] = [];
	const server = createServer(async (req, res) => {
		const path = (req.url ?? "").replace(/\?.*$/, "");
		const body = await bodyOf(req);
		seen.push({ path, body });
		const json = (status: number, value: unknown) => {
			res.writeHead(status, { "content-type": "application/json" });
			res.end(JSON.stringify(value));
		};
		if (path.endsWith("/images/generations") || path.endsWith("/images/edits")) {
			if (body.aspect_ratio === "1:1") {
				// Antigravity's own words for a spent quota, as the relay passes them on.
				return json(429, { error: { message: JSON.stringify({ error: { code: 429, message: "You have exhausted your capacity on this model. Your quota will reset after 1h52m45s.", status: "RESOURCE_EXHAUSTED" } }), type: "invalid_request_error" } });
			}
			await pause(options.drawMs);
			const picture = path.endsWith("/edits") ? options.art.night : options.art.day;
			return json(200, { created: Math.floor(Date.now() / 1000), data: [{ b64_json: picture }], output_format: "jpeg", size: "1408x792", usage: { input_tokens: 37, output_tokens: 1290, total_tokens: 1327 } });
		}
		if (!path.endsWith("/chat/completions")) return json(404, { error: { message: `not here: ${path}` } });

		res.writeHead(200, { "content-type": "text/event-stream" });
		const send = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
		const finish = (reason: string) => {
			send({ id: "c", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: reason }] });
			send({ id: "c", object: "chat.completion.chunk", choices: [], usage: { prompt_tokens: 40, completion_tokens: 12, total_tokens: 52 } });
			res.end("data: [DONE]\n\n");
		};
		const text = async (words: string) => {
			for (const piece of words.match(/.{1,3}/gu) ?? []) {
				send({ id: "c", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] });
				await pause(45);
			}
			finish("stop");
		};
		// The title request is the one with no tools.
		if (!Array.isArray(body.tools) || body.tools.length === 0) return text("画一只红色纸船");
		const messages = (body.messages ?? []) as ChatMessage[];
		const words = lastWords(messages);
		const scene = options.scenes.find((each) => words.text.includes(each.cue)) ?? options.scenes[0];
		if (messages.slice(words.index + 1).some((message) => message.role === "tool")) return text(scene.reply);
		await pause(400);
		send({ id: "c", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: scene.call, type: "function", function: { name: "image_generate", arguments: "" } }] }, finish_reason: null }] });
		const args = JSON.stringify(scene.args);
		for (let at = 0; at < args.length; at += 24) {
			send({ id: "c", object: "chat.completion.chunk", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(at, at + 24) } }] }, finish_reason: null }] });
			await pause(20);
		}
		finish("tool_calls");
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("the fake relay got no port");
	return { port: address.port, seen, close: () => server.close() };
}

/** A settings file with one relay serving a conversation model and an image model. */
export function relaySettings(port: number, cwd: string, extra: Record<string, unknown> = {}): string {
	const model = (modelId: string, more: Record<string, unknown> = {}) => ({
		id: `relay/${modelId}`,
		providerId: "relay",
		modelId,
		name: modelId,
		contextWindow: 200000,
		maxOutputTokens: 8192,
		supportsThinking: false,
		supportsImages: true,
		supportsTools: true,
		...more,
	});
	return JSON.stringify({
		uiLocale: "zh-CN",
		permissionMode: "full",
		projectMemory: false,
		thinking: "off",
		autoSummarizeTitle: false,
		mcpServers: [],
		hooks: [],
		sync: { enabled: false },
		appearance: { theme: "light" },
		projects: [{ path: cwd, name: "生图演示", pinned: true, lastOpenedAt: Date.now() }],
		defaultModelId: "relay/gemini-3.8-flash-high",
		providers: [
			{
				id: "relay",
				name: "中转站",
				api: "openai-chat-completions",
				baseUrl: `http://127.0.0.1:${port}`,
				apiKey: "probe-key",
				enabled: true,
				models: [model("gemini-3.8-flash-high"), model("gemini-3.1-flash-image", { supportsTools: false })],
			},
		],
		...extra,
	});
}
