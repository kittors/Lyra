/**
 * The three kinds of extension, used in a conversation.
 *
 * A skill, a plugin's skill and an MCP server each install through a different path and land in a
 * different place, but they converge on one screen: the transcript, where the model calls them and
 * a row appears for each call. That convergence is what this file is about — not whether a bundle
 * lands on disk (the unit tests own that), but whether the agent can actually reach it afterwards
 * and whether the row it draws says which of the three it was.
 *
 * The mark on a row is the whole point of asserting it. A tool run is a line of text about
 * something that already happened; the icon is the only part of it a person reads without reading.
 * If every row wears the same mark, the transcript stops distinguishing "loaded a skill" from "ran
 * a command" — which is precisely what a generic globe on every MCP server does.
 *
 * The model is a local server speaking Anthropic's wire format, the same trick `transcript.test.ts`
 * uses: it costs nothing, needs no key, and can be told to call exactly the tools under test. The
 * MCP server is a real child process speaking real JSON-RPC over stdio, because a fake one would
 * only prove that the fake matches what the client expects.
 */

import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { cleanupFixture } from "./fixture-cleanup.ts";

let app: RunningApp;
let model: Server;

const MODEL_PORT = 9563;

// ---------------------------------------------------------------------------
// A model that calls one of each
// ---------------------------------------------------------------------------

type Block = { tool: string; args: Record<string, unknown> } | { text: string };

/**
 * One turn per kind, rather than all three at once.
 *
 * Batched calls are drawn as a single collapsed row, which is right for the transcript and useless
 * here: this test reads the mark on each row, so each call needs a row of its own.
 */
const SCRIPT: Block[][] = [
	[{ tool: "skill", args: { name: "translate" } }],
	[{ tool: "skill", args: { name: "greet" } }],
	[{ tool: "mcp__demo-mcp__demo__echo", args: { text: "hi" } }],
	// A second server, so "each MCP call is marked" is not satisfied by one shared picture.
	[{ tool: "mcp__plain__echo", args: { text: "hi" } }],
	[{ tool: "web_fetch", args: { url: "https://example.com" } }],
	[{ text: "都试过了。" }],
];

function sse(res: import("node:http").ServerResponse, payload: unknown): void {
	res.write(`event: ${(payload as { type: string }).type}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function startModel(): Server {
	let turn = 0;
	const server = createServer((req, res) => {
		req.resume();
		req.on("end", () => {
			const blocks = SCRIPT[Math.min(turn, SCRIPT.length - 1)];
			turn++;
			res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
			sse(res, {
				type: "message_start",
				message: { id: `msg_${turn}`, role: "assistant", content: [], usage: { input_tokens: 10, output_tokens: 0 } },
			});
			for (const [index, block] of blocks.entries()) {
				if ("text" in block) {
					sse(res, { type: "content_block_start", index, content_block: { type: "text", text: "" } });
					sse(res, { type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } });
				} else {
					sse(res, {
						type: "content_block_start",
						index,
						content_block: { type: "tool_use", id: `call_${turn}_${index}`, name: block.tool, input: {} },
					});
					sse(res, {
						type: "content_block_delta",
						index,
						delta: { type: "input_json_delta", partial_json: JSON.stringify(block.args) },
					});
				}
				sse(res, { type: "content_block_stop", index });
			}
			const stop = blocks.some((b) => "tool" in b) ? "tool_use" : "end_turn";
			sse(res, { type: "message_delta", delta: { stop_reason: stop }, usage: { output_tokens: 40 } });
			sse(res, { type: "message_stop" });
			res.end();
		});
	});
	server.listen(MODEL_PORT, "127.0.0.1");
	return server;
}

// ---------------------------------------------------------------------------
// An MCP server with no dependencies
// ---------------------------------------------------------------------------

/**
 * JSON-RPC over stdio, written out by hand.
 *
 * It lives in the profile directory rather than in this repository because it has to be startable
 * by absolute path from a temporary home, where `node_modules` is not resolvable — so it can import
 * nothing, which rules out the MCP SDK and leaves the wire protocol itself. That is the right level
 * anyway: the client under test is the SDK's, and a server built on the same SDK would agree with
 * it by construction.
 */
const MCP_SERVER = `
const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
let buffer = "";
process.stdin.on("data", (chunk) => {
	buffer += chunk;
	let index;
	while ((index = buffer.indexOf("\\n")) >= 0) {
		const line = buffer.slice(0, index).trim();
		buffer = buffer.slice(index + 1);
		if (!line) continue;
		const message = JSON.parse(line);
		if (message.method === "initialize") {
			send({
				jsonrpc: "2.0",
				id: message.id,
				result: {
					protocolVersion: message.params.protocolVersion,
					capabilities: { tools: {} },
					serverInfo: { name: "demo", version: "1.0.0" },
				},
			});
		} else if (message.method === "tools/list") {
			send({
				jsonrpc: "2.0",
				id: message.id,
				result: {
					tools: [{
						name: "echo",
						description: "Echo a string back.",
						inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
					}],
				},
			});
		} else if (message.method === "tools/call") {
			send({
				jsonrpc: "2.0",
				id: message.id,
				result: { content: [{ type: "text", text: "echo: " + message.params.arguments.text }] },
			});
		} else if (message.id !== undefined) {
			send({ jsonrpc: "2.0", id: message.id, result: {} });
		}
	}
});
`;

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function seed(home: string): Promise<void> {
	// A loose skill, the kind a skill collection installs one of per skill.
	await mkdir(join(home, "skills", "translate"), { recursive: true });
	await writeFile(
		join(home, "skills", "translate", "SKILL.md"),
		"---\nname: translate\ndescription: 用户提供外语文本并要求中文译文时使用，保留原意、术语和段落结构，将输入内容翻译成清晰自然的中文。\n---\n\n把它翻成中文。\n",
	);

	// And a plugin, whose skills reach the agent through a bundle rather than on their own.
	await mkdir(join(home, "plugins", "demo-plugin", "skills", "greet"), { recursive: true });
	await writeFile(
		join(home, "plugins", "demo-plugin", "skills", "greet", "SKILL.md"),
		"---\nname: greet\ndescription: 在用户请求问候或需要确认连通性时，给出简短、友好的中文问候，用于验证已安装的技能可以被发现并执行。\n---\n\n说你好。\n",
	);

	const server = join(home, "mcp-server.mjs");
	await writeFile(server, MCP_SERVER);

	/*
	 * An installed MCP bundle, with the icon such a bundle ships.
	 *
	 * This is the shape `installEntry` leaves behind for anything from the catalogue: a directory
	 * under `mcp/` named for the entry, a manifest, and — since the platform started reading icons
	 * out of the archive — a picture beside it. The settings row below is stamped with the directory
	 * name, which is the only thing tying a call back to the bundle it came from.
	 */
	await mkdir(join(home, "mcp", "demo-mcp", ".lyra-plugin"), { recursive: true });
	await writeFile(
		join(home, "mcp", "demo-mcp", ".mcp.json"),
		JSON.stringify({ mcpServers: { demo: { command: process.execPath, args: [server] } } }),
	);
	await writeFile(
		join(home, "mcp", "demo-mcp", ".lyra-plugin", "plugin.json"),
		JSON.stringify({
			name: "demo-mcp",
			// Without this the directory holds no servers as far as the loader is concerned, and a
			// bundle with neither skills nor servers is a plugin — which is the right rule and the
			// wrong fixture.
			mcpServers: ".mcp.json",
			interface: { displayName: "Demo", brandColor: "#8b5cf6" },
		}),
	);
	await writeFile(
		join(home, "mcp", "demo-mcp", ".lyra-plugin", "icon.svg"),
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#8b5cf6"/></svg>',
	);

	const project = join(home, "project");
	await mkdir(project, { recursive: true });

	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 900, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [
				{
					id: "local",
					name: "Local",
					baseUrl: `http://127.0.0.1:${MODEL_PORT}`,
					api: "anthropic-messages",
					apiKey: "not-a-key",
					enabled: true,
					models: [
						{
							id: "local/scripted",
							providerId: "local",
							modelId: "scripted",
							name: "Scripted",
							contextWindow: 200000,
							maxOutputTokens: 8192,
							supportsThinking: false,
							supportsImages: false,
							supportsTools: true,
						},
					],
				},
			],
			mcpServers: [
				{
					/*
					 * The id an install actually writes: bundle directory, then the key inside the
					 * `.mcp.json`. It contains the same `__` the tool names are joined with, which is
					 * why the lookup matches prefixes forwards instead of splitting.
					 */
					id: "demo-mcp__demo",
					name: "Demo",
					transport: "stdio",
					command: process.execPath,
					args: [server],
					enabled: true,
					origin: { bundle: "demo-mcp" },
				},
				// Typed in by hand rather than installed: no bundle, so no picture — and it still has
				// to be told apart from the one that has one.
				{ id: "plain", name: "Plain", transport: "stdio", command: process.execPath, args: [server], enabled: true },
			],
			projects: [{ id: "e2e", name: "project", path: project, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: "local/scripted",
			permissionMode: "full",
			thinking: "off",
			retryAttempts: 1,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			pluginRegistries: [],
			skillRegistries: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4521, token: null },
		}),
	);
}

before(async () => {
	model = startModel();
	app = await startApp({ port: 9452, seed });
});

after(async () => {
	await cleanupFixture(() => app?.stop(), () => closeListeningServer(model));
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(expression: string, complaint: string, attempts = 60): Promise<void> {
	for (let attempt = 0; attempt < attempts; attempt++) {
		if (await app.evaluate<boolean>(`Boolean(${expression})`).catch(() => false)) return;
		await wait(250);
	}
	throw new Error(`${complaint}\nWhat was on screen:\n${await app.evaluate<string>("document.body.innerText")}`);
}

/** Send one message and let the scripted turns run to the end. */
async function converse(text: string): Promise<void> {
	await app.evaluate(`(() => {
		const box = document.querySelector("textarea");
		if (!box) throw new Error("no composer");
		const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
		setter.call(box, ${JSON.stringify(text)});
		box.dispatchEvent(new Event("input", { bubbles: true }));
		box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		return true;
	})()`);
}

/**
 * The mark at the head of each tool row, keyed by what the row says.
 *
 * Read off the page rather than out of React: what is being asserted is what a person sees, and the
 * two have disagreed before — a component can be handed the right icon and draw nothing.
 */
interface Row {
	/** The lucide glyph's name, when the mark is a glyph. */
	glyph: string | null;
	/** The `src` of the picture, when the mark is one. */
	picture: string | null;
	/** The colour actually computed for the glyph, so a declared brand colour can be shown to apply. */
	colour: string | null;
}

async function rowFor(summary: string): Promise<Row> {
	const row = await app.evaluate<Row | null>(`(() => {
		// A row's words are its summary; the first span is the icon slot in a row, the words in a card.
		const button = [...document.querySelectorAll("button")].find(
			(b) => (b.querySelector(".ly-flow-summary") ?? b.querySelector("span"))?.textContent?.trim() === ${JSON.stringify(summary)},
		);
		if (!button) return null;
		const image = button.querySelector("img");
		const svg = button.querySelector("svg");
		return {
			glyph: svg ? (svg.getAttribute("class") ?? "").split(/\\s+/).find((c) => c.startsWith("lucide-")) ?? null : null,
			picture: image ? image.getAttribute("src") : null,
			colour: svg ? getComputedStyle(svg).color : null,
		};
	})()`);
	assert.ok(row, `no tool row said ${summary}`);
	return row;
}

test("每种扩展都能在对话里用到，且行首说出它是哪一种", async () => {
	await converse("试一下三种扩展");
	await waitFor(`document.body.innerText.includes("都试过了")`, "the scripted turns never finished");
	// Keep the cold scan busy enough that row text cannot stand in for image readiness.
	await Promise.all(Array.from({ length: 256 }, (_, i) => mkdir(join(app.home, "plugins", `scan-fixture-${i}`), { recursive: true })));
	// Closed work defers its cards; inspect the controls a user actually opens. The turn's folded line first, then any group inside it.
	await app.evaluate(`document.querySelectorAll('[data-ly-turn-process] > button[aria-expanded="false"]').forEach(button=>button.click())`);
	await app.evaluate(`document.querySelectorAll('[data-ly-run] > button[aria-expanded="false"]').forEach(button=>button.click())`);
	await waitFor(`document.body.innerText.includes("Skill: translate")`, "opening tool work did not reveal the skill calls");

	/*
	 * A loose skill and a plugin's skill both reach the agent, and both are marked as skills.
	 *
	 * They arrive by different routes — one sits in `skills/`, the other is contributed by a bundle
	 * in `plugins/` — and converge on the same tool. Drawing them alike is correct: what the row
	 * reports is that a skill was loaded, and which one is already written beside it.
	 */
	assert.equal((await rowFor("Skill: translate")).glyph, "lucide-sparkles", "散装技能");
	assert.equal((await rowFor("Skill: greet")).glyph, "lucide-sparkles", "插件带来的技能");

	/*
	 * The installed server draws its own picture — the icon its bundle shipped, carried from the
	 * directory it was installed into to the row reporting the call.
	 */
	// Opening deferred cards starts the bundle scan; the row text can precede its loaded picture.
	await waitFor(`(() => {
		const row = [...document.querySelectorAll("button")].find(
			button => (button.querySelector(".ly-flow-summary") ?? button.querySelector("span"))?.textContent?.trim() === "Demo: echo",
		);
		const image = row?.querySelector("img");
		return image?.complete && image.naturalWidth > 0;
	})()`, "the installed MCP icon never finished loading");
	const installed = await rowFor("Demo: echo");
	assert.ok(installed.picture?.startsWith("data:image/svg+xml;"), `装来的服务画自己的图标，实际：${installed.picture}`);

	/*
	 * And a hand-configured server, which has no bundle and therefore no picture, still gets the
	 * mark for what it is rather than the globe it used to share with `web_fetch`.
	 */
	const plain = await rowFor("Plain: echo");
	assert.equal(plain.glyph, "lucide-cable", "手填的服务用 MCP 的符号");
	assert.equal(plain.picture, null);

	/*
	 * The globe belongs to fetching a page, and now only to that. A row says it in the transcript's own
	 * words (`describeActivity`): 「抓取网页 …」 where the bordered card of the expanded layout repeats
	 * core's "Fetch …". Skill and server rows have no such words, so they read the same either way.
	 */
	assert.equal((await rowFor("抓取网页 https://example.com")).glyph, "lucide-globe", "web_fetch 还是地球");
});
