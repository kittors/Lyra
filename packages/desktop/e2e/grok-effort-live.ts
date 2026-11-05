/* oxlint-disable no-console -- live probe: prints what every request carried and what came back */
/**
 * Grok 的推理档位，用 Lyra 自己发出的真实请求走一遍真中转——改前的构建一遍，改后的一遍。
 *
 * Lyra 和中转之间夹一个只做记录的转发代理。每一轮记下：请求体里推理参数的名字和值
 * （Responses 的 `reasoning` / `include`，Chat Completions 的 `reasoning_effort`）、HTTP 状态、
 * 响应 usage 里的 reasoning tokens，以及流里推理文字的字数。请求头一个都不记，只记「带没带
 * Authorization」这一个是非。
 *
 * 密钥有两种来法，探针自己都不看它的值：
 * - `GROK_APP_CRED_DIR`：一个放着 `credentials.json` 与 `vault.key` 的目录（用户同意放到测试机上
 *   的那一份）。两个文件拷进临时 profile，由应用自己解密、自己带上 Authorization，代理原样转发。
 * - `GROK_UPSTREAM_KEY` / `GROK_UPSTREAM_KEY_FILE`：由代理换上，读一次就从环境里删掉，不传给
 *   Electron；这时 profile 里只有一把假的 `probe-key`。
 * 临时 profile 由探针自己建、自己删，删完核对它确实不在了。
 *
 *   GROK_UPSTREAM=https://relay.example GROK_UPSTREAM_KEY=… node --experimental-strip-types e2e/grok-effort-live.ts --phase=before
 *   …                                                                                        --phase=after
 *   node --experimental-strip-types e2e/grok-effort-live.ts --dry --phase=after   # 不出网：上游换成按官方档位表拒收的假端点
 *
 * `GROK_MODELS` 列要测的型号（逗号分隔，默认 grok-4.7 和用户中转上的 grok-4.7-build-fast）；
 * 设成 `auto` 就测上游 /v1/models 里列出的、xAI 文档里有档位说明的那几个（应用自带凭据时探针
 * 自己没有密钥，列不了，回到默认两个）。每个型号把六个档位（含「关」）各发一句很短的话，一个
 * 接一个；然后重启一次应用，把同一个供应商换成 Chat Completions，第一个型号再发关/高/超高三句。
 * `GROK_CHAT=0` 不做这一组。
 */

import { createServer, type IncomingMessage, type Server } from "node:http";
import { access, appendFile, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";

const arg = (name: string) => process.argv.find((one) => one.startsWith(`--${name}=`))?.slice(name.length + 3);
const PHASE = arg("phase") === "before" ? "before" : "after";
const DRY = process.argv.includes("--dry");
const PORT = Number(arg("port") ?? 9433);
const OUT = process.env.GROK_OUT ?? join(homedir(), "Desktop", "LyraGrok思考等级测试");
const STAMP = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);
const TAG = `${STAMP}_${DRY ? "dry_" : ""}${PHASE === "before" ? "改前" : "改后"}`;

// Read once, then gone from the environment: the Electron child inherits `process.env`.
const UPSTREAM = (process.env.GROK_UPSTREAM ?? "").replace(/\/+$/, "");
/** The app's own encrypted credentials, copied into the throwaway profile; never opened here. */
const CRED_DIR = DRY ? undefined : process.env.GROK_APP_CRED_DIR || undefined;
let upstreamKey = DRY || CRED_DIR ? "" : process.env.GROK_UPSTREAM_KEY ?? "";
const keyFile = DRY || CRED_DIR ? undefined : process.env.GROK_UPSTREAM_KEY_FILE || undefined;
delete process.env.GROK_UPSTREAM_KEY;
delete process.env.GROK_UPSTREAM_KEY_FILE;
delete process.env.GROK_APP_CRED_DIR;
if (!upstreamKey && keyFile) upstreamKey = (await readFile(keyFile, "utf8")).trim();
if (!DRY && !UPSTREAM) throw new Error("GROK_UPSTREAM 要有；只想演练剧本就加 --dry");
if (!DRY && !CRED_DIR && !upstreamKey) throw new Error("GROK_APP_CRED_DIR、GROK_UPSTREAM_KEY、GROK_UPSTREAM_KEY_FILE 至少要有一个");
/** The provider id the credentials are filed under; anything else and the app finds no key. */
const PROVIDER = CRED_DIR ? process.env.GROK_PROVIDER_ID ?? "" : "grok";
if (CRED_DIR && !PROVIDER) throw new Error("用应用自带凭据时要给 GROK_PROVIDER_ID：凭据按供应商 id 存放");

const LEVELS = ["off", "low", "medium", "high", "xhigh", "max"] as const;
type Level = (typeof LEVELS)[number];
const LABEL: Record<string, string> = { off: "关", minimal: "极简", low: "低", medium: "中", high: "高", xhigh: "超高", max: "最高", ultra: "极致", auto: "自动" };

/**
 * What xAI documents for each model (docs.x.ai, 2026-11-05) — written out here, not imported, so
 * the same probe runs against a build that predates the fix. `null` levels: no effort at all.
 */
const DOCUMENTED: { pattern: RegExp; levels: string[] | null }[] = [
	{ pattern: /grok-4\.20-multi-agent/, levels: ["low", "medium", "high", "xhigh"] },
	{ pattern: /grok-4\.20(?![0-9]).*non-reasoning/, levels: null },
	{ pattern: /grok-4\.20(?![0-9])/, levels: null },
	{ pattern: /grok-4\.[67](?![0-9])/, levels: ["low", "medium", "high", "xhigh"] },
	{ pattern: /grok-(?:4\.5(?![0-9])|build-latest)/, levels: ["low", "medium", "high"] },
	{ pattern: /grok-4\.3(?![0-9])/, levels: ["none", "low", "medium", "high", "xhigh"] },
	{ pattern: /grok-(?:build-0\.1|code-fast)/, levels: null },
];
const documented = (model: string) => DOCUMENTED.find((one) => one.pattern.test(model));

/** What the build under test should send for a level: an effort, `none`, or nothing (`null`). */
function expectedWire(model: string, level: Level): string | null {
	if (PHASE === "before") return level === "off" ? "none" : level === "xhigh" || level === "max" ? "high" : level;
	const levels = documented(model)?.levels;
	if (levels === undefined) return level === "off" ? "none" : level === "xhigh" || level === "max" ? "high" : level;
	if (levels === null) return null;
	const ladder = levels.filter((one) => one !== "none");
	if (level === "off") return levels.includes("none") ? "none" : ladder[0];
	if (ladder.includes(level)) return level;
	// Deeper first, then shallower — the rule the app follows for a level a model lacks.
	const line = ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
	const at = line.indexOf(level);
	return [...line.slice(at + 1), ...line.slice(0, at).reverse()].find((one) => ladder.includes(one)) ?? null;
}

/** The word the composer's button should show: the level actually sent, 自动 where nothing is named. */
function expectedLabel(model: string, level: Level): string {
	const wire = expectedWire(model, level);
	if (wire === null) return PHASE === "after" && documented(model)?.levels === null && !/non-reasoning/.test(model) ? "自动" : "关";
	return wire === "none" ? "关" : LABEL[wire];
}

// ---------------------------------------------------------------------------
// The recording proxy
// ---------------------------------------------------------------------------

interface Hit {
	n: number;
	at: string;
	path: string;
	wire: "responses" | "chat" | "other";
	model?: string;
	/** Everything the person said in this request — how a request is matched to its step. */
	said?: string;
	/** How many tools went with it: an agent turn carries them, a background request does not. */
	tools: number;
	/** Whether the request carried an Authorization header at all — its value is never read into the log. */
	auth: boolean;
	/** The reasoning parameters, by name, exactly as sent. Headers are never recorded. */
	params: Record<string, unknown>;
	status?: number;
	ms?: number;
	usage?: { input?: number; output?: number; reasoning?: number };
	reasoningChars: number;
	textChars: number;
	error?: string;
	done: boolean;
}
const hits: Hit[] = [];
const LOG = join(OUT, `${TAG}_请求记录.jsonl`);

/** Anything that looks like a credential is cut out of what gets written down. */
const scrub = (text: string) => text.replace(/Bearer\s+[\w.~+/=-]+/gi, "Bearer [redacted]").replace(/\b(?:sk|xai|cps)[-_][\w-]{6,}/gi, "[redacted]").slice(0, 400);

/** Every user item's text, joined — the app may put its own context in a user item after the person's. */
function userText(body: Record<string, unknown>): string {
	const items = (Array.isArray(body.input) ? body.input : Array.isArray(body.messages) ? body.messages : []) as { role?: string; content?: unknown }[];
	return items.filter((item) => item.role === "user").map((user) => {
		if (typeof user.content === "string") return user.content;
		if (Array.isArray(user.content)) return user.content.map((part: { text?: string }) => part.text ?? "").join("");
		return "";
	}).join("\n");
}

async function bodyOf(req: IncomingMessage): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(Buffer.from(chunk as Buffer));
	return Buffer.concat(chunks);
}

/** Usage and reasoning out of a finished stream (or a plain JSON answer), for both wires. */
function readAnswer(hit: Hit, text: string) {
	const events: Record<string, unknown>[] = [];
	for (const line of text.split("\n")) {
		if (!line.startsWith("data:")) continue;
		const data = line.slice(5).trim();
		if (!data || data === "[DONE]") continue;
		try { events.push(JSON.parse(data) as Record<string, unknown>); } catch { /* a partial line at a chunk edge */ }
	}
	if (events.length === 0) {
		try { events.push(JSON.parse(text) as Record<string, unknown>); } catch { /* not JSON */ }
	}
	for (const event of events) {
		const type = String(event.type ?? "");
		if (type.includes("reasoning") && type.endsWith(".delta")) hit.reasoningChars += String(event.delta ?? "").length;
		if (type === "response.output_text.delta") hit.textChars += String(event.delta ?? "").length;
		const response = event.response as { usage?: Record<string, unknown>; error?: { message?: string } } | undefined;
		const usage = (response?.usage ?? event.usage) as Record<string, unknown> | undefined;
		if (usage) {
			const details = (usage.output_tokens_details ?? usage.completion_tokens_details) as { reasoning_tokens?: number } | undefined;
			hit.usage = {
				input: Number(usage.input_tokens ?? usage.prompt_tokens ?? 0),
				output: Number(usage.output_tokens ?? usage.completion_tokens ?? 0),
				reasoning: details?.reasoning_tokens,
			};
		}
		for (const choice of (event.choices ?? []) as { delta?: { reasoning_content?: string; content?: string } }[]) {
			hit.reasoningChars += (choice.delta?.reasoning_content ?? "").length;
			hit.textChars += (choice.delta?.content ?? "").length;
		}
		const failure = (event.error as { message?: string } | undefined)?.message ?? response?.error?.message;
		if (failure) hit.error = scrub(failure);
	}
	if (!hit.error && hit.status !== undefined && hit.status >= 400) hit.error = scrub(text);
}

function proxy(upstream: string): Server {
	return createServer(async (req, res) => {
		const raw = await bodyOf(req);
		const path = req.url ?? "/";
		const hit: Hit = {
			n: hits.length + 1, at: new Date().toISOString(), path,
			wire: path.endsWith("/responses") ? "responses" : path.endsWith("/chat/completions") ? "chat" : "other",
			params: {}, tools: 0, auth: Boolean(req.headers.authorization), reasoningChars: 0, textChars: 0, done: false,
		};
		hits.push(hit);
		if (raw.length > 0) {
			try {
				const body = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
				hit.model = typeof body.model === "string" ? body.model : undefined;
				hit.said = userText(body);
				hit.tools = Array.isArray(body.tools) ? body.tools.length : 0;
				for (const name of ["reasoning", "reasoning_effort", "include", "thinking"]) if (name in body) hit.params[name] = body[name];
			} catch { /* not JSON; forwarded as it is */ }
		}
		const started = Date.now();
		try {
			const headers: Record<string, string> = {};
			for (const [name, value] of Object.entries(req.headers)) {
				if (["host", "connection", "content-length", "accept-encoding", "authorization"].includes(name) || value === undefined) continue;
				headers[name] = Array.isArray(value) ? value.join(", ") : value;
			}
			// The app's own header goes on untouched when it brings its key; otherwise the proxy supplies one.
			if (upstreamKey) headers.authorization = `Bearer ${upstreamKey}`;
			else if (req.headers.authorization) headers.authorization = String(req.headers.authorization);
			else if (DRY) headers.authorization = "Bearer dry-run";
			const answer = await fetch(`${upstream}${path}`, {
				method: req.method, headers, body: raw.length > 0 ? new Uint8Array(raw) : undefined, signal: AbortSignal.timeout(300_000),
			});
			hit.status = answer.status;
			res.writeHead(answer.status, { "content-type": answer.headers.get("content-type") ?? "application/json" });
			let text = "";
			if (answer.body) {
				// Passed on chunk by chunk as it arrives: the app is reading a live stream.
				const reader = answer.body.getReader();
				const decoder = new TextDecoder();
				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					text += decoder.decode(value, { stream: true });
					res.write(value);
				}
			}
			res.end();
			readAnswer(hit, text);
		} catch (error) {
			hit.status = hit.status ?? 599;
			hit.error = scrub(error instanceof Error ? error.message : String(error));
			if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: { message: "probe proxy: upstream failed" } }));
		}
		hit.ms = Date.now() - started;
		hit.done = true;
		await appendFile(LOG, `${JSON.stringify({ ...hit, said: hit.said?.slice(-60) })}\n`);
		console.log(`      ↔ #${hit.n} ${hit.wire} ${hit.model ?? ""} ${JSON.stringify(hit.params)}${hit.auth ? "" : " (没带 Authorization)"} → ${hit.status} ${hit.ms}ms reasoning_tokens=${hit.usage?.reasoning ?? "?"} 推理字数=${hit.reasoningChars}${hit.error ? ` 错误=${hit.error.slice(0, 120)}` : ""}`);
	});
}

/**
 * The dry run's stand-in for the relay: refuses an effort the way xAI documents (a value the model
 * does not list is a 400; models without the parameter refuse any), streams a tiny answer otherwise.
 * Its 400 wording is made up — only the real run says what the real endpoint answers.
 */
function fakeUpstream(): Server {
	return createServer(async (req, res) => {
		const raw = (await bodyOf(req)).toString("utf8");
		const path = req.url ?? "/";
		if (req.method === "GET" && path.endsWith("/models")) {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ data: ["grok-4.7", "grok-4.7-build-fast", "grok-4.6", "grok-4.5", "grok-4.3", "grok-4.20-0309-reasoning", "grok-build-0.1"].map((id) => ({ id })) }));
			return;
		}
		const body = JSON.parse(raw || "{}") as { model?: string; reasoning?: { effort?: string }; reasoning_effort?: string };
		const model = body.model ?? "";
		const effort = body.reasoning?.effort ?? body.reasoning_effort;
		const levels = documented(model)?.levels;
		if (effort !== undefined && levels !== undefined && (levels === null || !levels.includes(effort))) {
			res.writeHead(400, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: { message: `[simulated] ${model} does not accept reasoning effort ${effort}` } }));
			return;
		}
		const reasoning = effort === "none" ? 0 : ({ low: 40, medium: 90, high: 160, xhigh: 260 } as Record<string, number>)[effort ?? "high"] ?? 120;
		res.writeHead(200, { "content-type": "text/event-stream" });
		const emit = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);
		if (path.endsWith("/responses")) {
			const item = { id: "m", type: "message", role: "assistant", content: [{ type: "output_text", text: "好", annotations: [] }] };
			emit({ type: "response.created", response: { id: "r", status: "in_progress" } });
			emit({ type: "response.output_item.added", output_index: 0, item: { ...item, content: [] } });
			emit({ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "好" });
			emit({ type: "response.output_item.done", output_index: 0, item });
			emit({ type: "response.completed", response: { id: "r", status: "completed", output: [item], usage: { input_tokens: 900, output_tokens: reasoning + 1, output_tokens_details: { reasoning_tokens: reasoning } } } });
		} else {
			emit({ id: "c", choices: [{ index: 0, delta: { role: "assistant", content: "好" }, finish_reason: null }] });
			emit({ id: "c", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 900, completion_tokens: reasoning + 1, completion_tokens_details: { reasoning_tokens: reasoning } } });
			res.write("data: [DONE]\n\n");
		}
		res.end();
	});
}

const listen = (server: Server) => new Promise<number>((resolve, reject) => {
	server.once("error", reject);
	server.listen(0, "127.0.0.1", () => {
		const address = server.address();
		if (!address || typeof address === "string") reject(new Error("no port"));
		else resolve(address.port);
	});
});

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

const checks: { ok: boolean; what: string; saw: string }[] = [];
function check(what: string, ok: boolean, saw: string) {
	checks.push({ ok, what, saw });
	console.log(`   ${ok ? "✅" : "❌"} ${what}${ok ? "" : `  —— 看到的是：${saw}`}`);
}

interface Step { wire: "responses" | "chat"; model: string; level: Level; label: string; hit?: Hit; retries: number; outcome: string }
const steps: Step[] = [];

const EFFORT = 'main button[aria-label^="推理强度："]';
const MODEL = 'main button[aria-label="选择模型"]';

let app: RunningApp;

async function shot(name: string) {
	await app.evaluate("Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a=>a.finished.catch(()=>{}))).then(()=>new Promise(requestAnimationFrame))");
	const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	const file = join(OUT, `${TAG}_${name}.png`);
	await writeFile(file, Buffer.from(data, "base64"));
	console.log(`   📸 ${file}`);
}

/** Shaped like the user's own entries for this relay. */
const modelEntry = (modelId: string) => ({
	id: `${PROVIDER}/${modelId}`, providerId: PROVIDER, modelId, name: modelId, contextWindow: 200_000, maxOutputTokens: 65_536,
	supportsThinking: true, supportsImages: true, supportsTools: !/multi-agent/.test(modelId),
});

async function main() {
	await mkdir(OUT, { recursive: true });
	const fake = DRY ? fakeUpstream() : undefined;
	const upstream = fake ? `http://127.0.0.1:${await listen(fake)}` : UPSTREAM;
	const recorder = proxy(upstream);
	const proxyPort = await listen(recorder);
	const keySource = DRY ? "假端点，不需要密钥" : CRED_DIR ? "应用自己解密 profile 里的凭据" : "代理换上的密钥";
	console.log(`阶段：${PHASE === "before" ? "改前" : "改后"}${DRY ? "（演练）" : ""} · 代理 127.0.0.1:${proxyPort} → ${DRY ? "假端点" : new URL(upstream).host} · 密钥：${keySource}`);

	// What the upstream serves, so `auto` tests exactly the Grok models that exist there. With the
	// app's own credentials the probe holds no key and cannot ask.
	let available: string[] = [];
	if (!CRED_DIR) {
		try {
			const listed = await fetch(`http://127.0.0.1:${proxyPort}/v1/models`, { signal: AbortSignal.timeout(30_000) });
			const json = (await listed.json()) as { data?: { id?: string }[] };
			available = (json.data ?? []).map((one) => String(one.id ?? "")).filter((id) => /grok/i.test(id) && !/imagine|voice|tts|transcribe/i.test(id));
		} catch { /* listed below as unknown */ }
		console.log(`上游列出的 Grok 对话模型：${available.length > 0 ? available.join(", ") : "（没拿到列表）"}`);
	}
	const DEFAULT_MODELS = ["grok-4.7", "grok-4.7-build-fast"];
	const wanted = (process.env.GROK_MODELS ?? DEFAULT_MODELS.join(",")).split(",").map((one) => one.trim()).filter(Boolean);
	const models = wanted.includes("auto") ? (available.length > 0 ? available.filter((id) => documented(id) || /grok-4\.7/.test(id)) : DEFAULT_MODELS) : wanted;
	if (models.length === 0) throw new Error("没有可测的 Grok 型号");
	const chatModel = process.env.GROK_CHAT === "0" ? undefined : models[0];
	console.log(`要测：${models.join(", ")}（Responses，各 ${LEVELS.length} 档）${chatModel ? `；Chat Completions：${chatModel}` : ""}`);

	// The probe's own throwaway profile, so the Chat pass can restart on it and so its removal can be checked.
	const home = await mkdtemp(join(tmpdir(), "lyra-grok-"));
	const project = join(home, "project");
	await mkdir(project, { recursive: true });
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 800 }));
	if (CRED_DIR) {
		for (const name of ["credentials.json", "vault.key"]) await copyFile(join(CRED_DIR, name), join(home, name));
	}
	const provider = (api: string) => ({
		id: PROVIDER, name: "grok", api, baseUrl: `http://127.0.0.1:${proxyPort}`,
		// Empty, as in the user's own settings: the key lives in the vault the app opens itself.
		apiKey: CRED_DIR ? "" : "probe-key", enabled: true, models: models.map(modelEntry),
	});
	await writeFile(join(home, "settings.json"), JSON.stringify({
		uiLocale: "zh-CN", permissionMode: "full", projectMemory: false, thinking: "medium", lastThinking: "medium",
		autoSummarizeTitle: false, retryAttempts: 0, mcpServers: [], hooks: [], sync: { enabled: false },
		projects: [{ path: project, name: "GrokEffort", pinned: true, lastOpenedAt: Date.now() }],
		defaultModelId: `${PROVIDER}/${models[0]}`,
		providers: [provider("openai-responses")],
	}));

	const frames: Frame[] = [];
	let stopRecording: () => Promise<void> = async () => {};
	let running = false;
	let index = 0;

	const label = async () => (await app.evaluate<string>(`document.querySelector(${JSON.stringify(EFFORT)})?.getAttribute("aria-label") ?? ""`)).replace(/^推理强度：/, "");
	const listedLevels = () => app.evaluate<string[]>(`[...document.querySelectorAll('[role="group"] .ly-reveal .flex.gap-2 > span:first-child')].map((e) => e.textContent)`);

	/** This step's agent turns: the person's line in them, and the tools a turn carries (none on multi-agent). */
	const turnsOf = (from: number, text: string, model: string) =>
		hits.slice(from).filter((hit) => hit.said?.includes(text) && (hit.tools > 0 || /multi-agent/.test(model)));

	/**
	 * Sends one line in a conversation and waits for its turn to end, resends included.
	 *
	 * Not awaited in the page: `prompt` settles when the turn does, and a turn at xhigh outlasts the
	 * 40 seconds `evaluate` gives a page-side promise.
	 */
	async function say(sessionId: string, text: string, model: string): Promise<Hit[]> {
		const from = hits.length;
		await app.evaluate(`(() => { window.lyra.agent.prompt(${JSON.stringify(sessionId)}, [{ type: "text", text: ${JSON.stringify(text)} }]).catch(() => {}); return true; })()`);
		const end = Date.now() + 300_000;
		let quiet = 0;
		while (Date.now() < end) {
			const busy = await app.evaluate<boolean>(`window.lyra.sessions.running(${JSON.stringify(sessionId)})`);
			const mine = turnsOf(from, text, model);
			quiet = !busy && mine.length > 0 && mine.every((hit) => hit.done) ? quiet + 1 : 0;
			if (quiet >= 6) break;
			await pause(500);
		}
		return turnsOf(from, text, model);
	}

	const outcomeOf = (projectId: string, sessionId: string) => app.evaluate<string>(`(async () => {
		const t = await window.lyra.sessions.transcript(${JSON.stringify(projectId)}, ${JSON.stringify(sessionId)});
		const list = Array.isArray(t) ? t : (t && (t.messages || t.items)) || [];
		const last = [...list].reverse().find((m) => m && m.role === "assistant");
		if (!last) return "没有回复";
		const text = Array.isArray(last.content) ? last.content.filter((c) => c.type === "text").map((c) => c.text).join("") : "";
		return (last.stopReason || "?") + (last.errorMessage ? " · " + String(last.errorMessage).slice(0, 120) : "") + (text ? " · 「" + text.slice(0, 20) + "」" : "");
	})()`).catch((error: unknown) => `读不到：${error instanceof Error ? error.message.slice(0, 80) : String(error)}`);

	/** The button's word once it has caught up with the level just set; whatever it says after 3 s otherwise. */
	async function settledLabel(want: string): Promise<string> {
		await driver(app).until(`(document.querySelector(${JSON.stringify(EFFORT)})?.getAttribute("aria-label") ?? "") === ${JSON.stringify(`推理强度：${want}`)}`, 3000).catch(() => {});
		return label();
	}

	async function launch() {
		app = await startApp({ port: PORT, reuseHome: home });
		running = true;
		stopRecording = await startRecording(PORT, frames);
		const d = driver(app);
		await app.evaluate("document.fonts.ready");
		await d.until(`document.querySelector(${JSON.stringify(EFFORT)})`, 30000);
		await pause(1000);
		return d;
	}

	async function shutdown() {
		if (!running) return;
		running = false;
		await stopRecording();
		await app.stop();
	}

	async function pass(wire: "responses" | "chat", passModels: readonly string[], levels: readonly Level[]) {
		const d = await launch();
		for (const model of passModels) {
			console.log(`\n▶ ${model}（${wire === "responses" ? "Responses" : "Chat Completions"}）`);
			const made = await app.evaluate<{ meta: { id: string; projectId: string } }>(`window.lyra.sessions.create(${JSON.stringify(project)}, ${JSON.stringify(`${PROVIDER}/${model}`)})`);
			const { id, projectId } = made.meta;
			for (const [i, level] of levels.entries()) {
				await app.evaluate(`window.lyra.agent.setThinking(${JSON.stringify(id)}, ${JSON.stringify(level)})`);
				await pause(400);
				const step: Step = { wire, model, level, label: i === 0 ? "" : await settledLabel(expectedLabel(model, level)), retries: 0, outcome: "" };
				index += 1;
				const text = `[${index}] 只回一个字：好`;
				const mine = await say(id, text, model);
				step.hit = mine[0];
				step.retries = Math.max(0, mine.length - 1);
				step.outcome = await outcomeOf(projectId, id);
				if (i === 0) {
					// The conversation is listed once it has a message; opened the way a person opens it.
					await d.click(`[data-ly-row="${id}"] button`);
					await pause(1200);
					step.label = await settledLabel(expectedLabel(model, level));
				}
				steps.push(step);
				const want = expectedWire(model, level);
				const sent = wire === "responses"
					? (step.hit?.params.reasoning as { effort?: string } | undefined)?.effort ?? null
					: (step.hit?.params.reasoning_effort as string | undefined) ?? null;
				check(`${model} ${wire} 「${LABEL[level]}」→ 发出 ${want ?? "（不发）"}`, sent === want, `${sent ?? "（不发）"} ${JSON.stringify(step.hit?.params ?? {})}`);
				check(`${model} ${wire} 「${LABEL[level]}」→ 按钮写「${expectedLabel(model, level)}」`, step.label === expectedLabel(model, level), step.label);
				check(`${model} ${wire} 「${LABEL[level]}」→ HTTP 200、一次就成`, step.hit?.status === 200 && step.retries === 0, `${step.hit?.status} 重发 ${step.retries} 次 ${step.hit?.error ?? ""}`);
				if (i === 0 && wire === "responses") {
					await d.click(EFFORT);
					await d.until(`document.querySelector('[role="group"] input[type="range"]')`, 5000);
					await pause(500);
					await d.click('[role="group"] button[data-ly-tip="各档位说明"]');
					await pause(900);
					console.log(`   菜单里的档位：${(await listedLevels()).join(" / ")}`);
					await shot(`${String(steps.length).padStart(2, "0")}_${model}_推理档位`);
					await d.key("Escape", 27);
					await pause(500);
					await d.click(MODEL);
					await d.until(`[...document.querySelectorAll('[role="menu"]')].some((m) => m.innerText.includes("关闭思考"))`, 5000);
					await pause(700);
					await shot(`${String(steps.length).padStart(2, "0")}_${model}_模型菜单`);
					await d.key("Escape", 27);
					await pause(500);
				}
			}
		}
		await shutdown();
	}

	try {
		await pass("responses", models, LEVELS);
		if (chatModel) {
			// Same provider, same credentials, other wire: only `api` changes, read back from what the app wrote.
			const file = join(home, "settings.json");
			const settings = JSON.parse(await readFile(file, "utf8")) as { providers: { id: string; api: string }[] };
			for (const one of settings.providers) if (one.id === PROVIDER) one.api = "openai-chat-completions";
			await writeFile(file, JSON.stringify(settings));
			await pass("chat", [chatModel], ["off", "high", "xhigh"]);
		}
	} finally {
		await shutdown().catch(() => {});
		recorder.close();
		fake?.close();
		// The throwaway profile holds the copied credentials: gone, and checked gone.
		for (let attempt = 0; attempt < 10; attempt++) {
			await rm(home, { recursive: true, force: true }).catch(() => {});
			if (await access(home).then(() => false, () => true)) break;
			await pause(1000);
		}
		const removed = await access(home).then(() => false, () => true);
		console.log(`\n临时 profile ${home}：${removed ? "已删除" : "没删掉，要手动删"}`);
		if (!removed) process.exitCode = 1;
		const passed = checks.filter((one) => one.ok).length;
		const rows = steps.map((step) => {
			const params = step.hit ? JSON.stringify(step.hit.params) : "（没有请求）";
			return `| ${step.model} | ${step.wire} | ${LABEL[step.level]} | ${step.label} | \`${params}\` | ${step.hit?.status ?? "-"}${step.retries ? `（重发 ${step.retries}）` : ""} | ${step.hit?.usage?.reasoning ?? "?"} | ${step.hit?.reasoningChars ?? 0} | ${step.outcome.replace(/\|/g, "/")} |`;
		});
		const report = [
			`# Grok 推理档位真实请求 · ${PHASE === "before" ? "改前" : "改后"}${DRY ? "（演练，上游是假端点）" : ""} · ${STAMP}`,
			"",
			`${passed}/${checks.length} 项符合这一版应有的行为。密钥：${keySource}。请求头不记录；完整逐条记录见 \`${TAG}_请求记录.jsonl\`。`,
			`临时 profile：${removed ? "已删除" : "没删掉"}。`,
			"",
			"| 型号 | 链 | 设的档位 | 按钮上的字 | 请求里的推理参数 | HTTP | reasoning tokens | 推理字数 | 这一轮的结果 |",
			"| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
			...rows,
			"",
			...checks.filter((one) => !one.ok).map((one) => `- ❌ ${one.what}：${one.saw}`),
		].join("\n");
		await writeFile(join(OUT, `${TAG}_${passed}of${checks.length}.md`), `${report}\n`);
		// The same rows for a machine: the before and after runs are joined on (wire, model, level).
		await writeFile(join(OUT, `${TAG}_steps.json`), JSON.stringify({ phase: PHASE, dry: DRY, stamp: STAMP, passed, total: checks.length, steps: steps.map((step) => ({
			wire: step.wire, model: step.model, level: step.level, label: step.label, params: step.hit?.params ?? null, status: step.hit?.status ?? null,
			resent: step.retries, auth: step.hit?.auth ?? null, reasoningTokens: step.hit?.usage?.reasoning ?? null, reasoningChars: step.hit?.reasoningChars ?? 0, error: step.hit?.error ?? null, outcome: step.outcome,
		})) }, null, "\t"));
		const video = join(OUT, `${TAG}_Grok推理档位_${passed}of${checks.length}.mp4`);
		if (frames.length > 0) await encode(frames, video);
		console.log(`\n${passed}/${checks.length} · 🎬 ${video}`);
		if (PHASE === "after" && passed !== checks.length) process.exitCode = 1;
	}
}

await main();
