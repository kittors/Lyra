/* oxlint-disable no-console -- probe CLI that prints what real endpoints answered */
/**
 * 三条协议链在**真实端点**上到底能不能走通。
 *
 * 这个探针不读文档、不看别人的项目，它发真的请求，把真的状态码和真的错误体打出来。写它的直接原因是
 * 一条线上报错：官方 DeepSeek 拒收我们回放的推理项，说 `input[14]` 缺 `content`。文档能告诉你「某些
 * 兼容端点要求原样回放 reasoning_content」，但只有真请求能告诉你**我们发出去的那一份**是不是它要的。
 *
 * 每条假设是一次独立请求，尽量小：`max_output_tokens` 压到最低，不带工具，不带长历史。跑一遍的代价
 * 是几百个 token。
 *
 * 用法：`node --import tsx packages/core/test/wire-compat-probe.ts`
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = join(homedir(), ".lyra");

interface Case {
	name: string;
	why: string;
	url: string;
	key: string;
	body: unknown;
}

interface Outcome {
	name: string;
	why: string;
	status: number;
	ok: boolean;
	error: string;
}

/** 供应商的密钥——保险库里的那份，和应用自己用的是同一份。 */
async function keys(): Promise<Map<string, string>> {
	const { secret } = await import("../src/config/vault.ts");
	const settings = JSON.parse(await readFile(join(HOME, "settings.json"), "utf8"));
	const out = new Map<string, string>();
	for (const p of settings.providers ?? []) {
		const value = p.apiKey || (await secret(`provider:${p.id}`)) || (await secret(p.id));
		if (value) out.set(p.id, value);
		else console.error(`⚠️  ${p.id} 取不到密钥，跳过`);
	}
	return out;
}

async function run(c: Case): Promise<Outcome> {
	let status = 0;
	let error = "";
	try {
		const response = await fetch(c.url, {
			method: "POST",
			headers: { "content-type": "application/json", authorization: `Bearer ${c.key}` },
			body: JSON.stringify(c.body),
		});
		status = response.status;
		const text = await response.text();
		/*
		 * 200 之后还要看流里有没有真的错误事件。
		 *
		 * 不能拿 `text.includes("error")` 判：SSE 的每个 response 对象里都躺着一个 `"error":null`，
		 * 那样每一条成功的流都会被记成失败——上一版就是这么把 8 条 200 全打成 ❌ 的。
		 */
		if (!response.ok) error = text.slice(0, 400).replace(/\s+/g, " ");
		else if (/"type"\s*:\s*"(response\.failed|error)"|"error"\s*:\s*\{/.test(text)) {
			error = text.slice(-400).replace(/\s+/g, " ");
		}
	} catch (e) {
		error = String(e);
	}
	const ok = status >= 200 && status < 300 && !error;
	console.log(`${ok ? "✅" : "❌"} [${status}] ${c.name}`);
	console.log(`     期待验证：${c.why}`);
	if (error) console.log(`     端点说：${error}`);
	return { name: c.name, why: c.why, status, ok, error };
}

/**
 * 一段最小的「模型想过、调过工具、拿到结果」的历史。
 *
 * 推理项按 `shape` 给三种写法：我们现在发的（只有 summary）、报错信息点名要的（content 里的
 * reasoning_text）、以及两者都给。工具那一对必须齐全，否则先撞上配对检查，测不到推理这一层。
 */
function history(shape: "summary" | "content" | "both" | "none", id: string): unknown[] {
	const thought = "用户要一个数字，先想一下：这是个纯算术问题，直接算就行。";
	const reasoning: Record<string, unknown> = { type: "reasoning", id };
	if (shape === "summary" || shape === "both") reasoning.summary = [{ type: "summary_text", text: thought }];
	else reasoning.summary = [];
	if (shape === "content" || shape === "both") reasoning.content = [{ type: "reasoning_text", text: thought }];

	return [
		{ role: "user", content: [{ type: "input_text", text: "1+1 等于几？只回数字。" }] },
		...(shape === "none" ? [] : [reasoning]),
		{ type: "function_call", call_id: "call_probe_1", name: "calc", arguments: '{"expr":"1+1"}' },
		{ type: "function_call_output", call_id: "call_probe_1", output: "2" },
	];
}

const TOOLS = [
	{
		type: "function",
		name: "calc",
		description: "算一个算术表达式",
		parameters: { type: "object", properties: { expr: { type: "string" } }, required: ["expr"], additionalProperties: false },
	},
];

function responsesBody(model: string, input: unknown[], extra: Record<string, unknown> = {}): unknown {
	return {
		model,
		input,
		stream: true,
		store: false,
		max_output_tokens: 512,
		instructions: "你是一个测试助手，回答尽量短。",
		tools: TOOLS,
		tool_choice: "auto",
		reasoning: { effort: "low", summary: "auto" },
		include: ["reasoning.encrypted_content"],
		...extra,
	};
}

async function main() {
	const secrets = await keys();
	const settings = JSON.parse(await readFile(join(HOME, "settings.json"), "utf8"));
	const results: Outcome[] = [];

	for (const provider of settings.providers ?? []) {
		const key = secrets.get(provider.id);
		if (!key) continue;
		const base = String(provider.baseUrl).replace(/\/+$/, "");
		// 官方 DeepSeek 那个是这次线上报错的现场，优先测它；中转站顺带测同样的几条。
		const model = provider.models?.find((m: { supportsThinking?: boolean; modelId: string }) =>
			m.supportsThinking && /deepseek|glm|kimi|qwen/i.test(m.modelId),
		) ?? provider.models?.[0];
		if (!model) continue;

		console.log(`\n════ ${provider.id} · ${base} · ${model.modelId} ════`);
		// 和 `joinUrl` 拼出来的一样——探针要打的是应用真正会打的那个地址。
		const url = base.endsWith("/v1") ? `${base}/responses` : `${base}/v1/responses`;

		results.push(await run({
			name: `${provider.id}｜推理项只带 summary（我们现在发的就是这个）`,
			why: "线上那条 400 是不是由我们这个形状造成的",
			url, key,
			body: responsesBody(model.modelId, history("summary", "probe-reasoning-1")),
		}));

		results.push(await run({
			name: `${provider.id}｜推理项带 content.reasoning_text`,
			why: "错误信息点名要的那个形状，端点是不是真的收",
			url, key,
			body: responsesBody(model.modelId, history("content", "probe-reasoning-1")),
		}));

		results.push(await run({
			name: `${provider.id}｜推理项 content 和 summary 都带`,
			why: "两个都给会不会反而被拒（决定能不能一份形状打通两家）",
			url, key,
			body: responsesBody(model.modelId, history("both", "probe-reasoning-1")),
		}));

		results.push(await run({
			name: `${provider.id}｜整个推理项都不回放`,
			why: "跳过推理是不是就一定安全（`fromHome` 对外来模型走的就是这条）",
			url, key,
			body: responsesBody(model.modelId, history("none", "")),
		}));

		results.push(await run({
			name: `${provider.id}｜assistant message 项带 id`,
			why: "回放我们自己记下的 message id 会不会被拒",
			url, key,
			body: responsesBody(model.modelId, [
				{ role: "user", content: [{ type: "input_text", text: "1+1 等于几？" }] },
				{ type: "message", id: "msg-probe-not-from-here", role: "assistant", content: [{ type: "output_text", text: "2" }] },
				{ role: "user", content: [{ type: "input_text", text: "那 2+2 呢？" }] },
			]),
		}));

		results.push(await run({
			name: `${provider.id}｜include reasoning.encrypted_content`,
			why: "这个 include 我们无条件发，第三方端点收不收",
			url, key,
			body: responsesBody(model.modelId, [{ role: "user", content: [{ type: "input_text", text: "说「好」" }] }]),
		}));

		results.push(await run({
			name: `${provider.id}｜reasoning.summary 不带`,
			why: "xAI 一类端点拒收 summary；去掉之后还能不能正常走",
			url, key,
			body: responsesBody(model.modelId, [{ role: "user", content: [{ type: "input_text", text: "说「好」" }] }], {
				reasoning: { effort: "low" },
			}),
		}));

		// —— Chat Completions：同一把钥匙、同一个域名，另一条链 ——
		// 注意这里刻意用 `/v1/chat/completions`——**我们的适配器发的是不带 `/v1` 的那个**，
		// 那条路单独测（见下面的「路由形状」），这里要先能连上才测得到协议层。
		const chat = base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
		const thought = "先想一下：这是个纯算术问题。";
		const assistantWithCall = {
			role: "assistant",
			content: null,
			tool_calls: [{ id: "call_probe_1", type: "function", function: { name: "calc", arguments: '{"expr":"1+1"}' } }],
		};
		const chatTools = [{ type: "function", function: { name: "calc", description: "算一个算术表达式", parameters: TOOLS[0].parameters } }];
		const chatBase = { model: model.modelId, stream: true, tools: chatTools, tool_choice: "auto", max_tokens: 256 };
		const chatHistory = (assistant: unknown) => [
			{ role: "user", content: "1+1 等于几？只回数字。" },
			assistant,
			{ role: "tool", tool_call_id: "call_probe_1", content: "2" },
		];

		results.push(await run({
			name: `${provider.id}｜Chat：工具轮不带 reasoning_content（我们现在就是这样）`,
			why: "我们的 chat 编码器整段丢弃思考块，这条链对推理模型还走不走得通",
			url: chat, key,
			body: { ...chatBase, messages: chatHistory(assistantWithCall) },
		}));

		results.push(await run({
			name: `${provider.id}｜Chat：工具轮带 reasoning_content`,
			why: "把思考原样带回去，是不是就通了",
			url: chat, key,
			body: { ...chatBase, messages: chatHistory({ ...assistantWithCall, reasoning_content: thought }) },
		}));

		results.push(await run({
			name: `${provider.id}｜Chat：content 用 "" 而不是 null`,
			why: "有些宿主拒收 null content",
			url: chat, key,
			body: { ...chatBase, messages: chatHistory({ ...assistantWithCall, content: "", reasoning_content: thought }) },
		}));

		results.push(await run({
			name: `${provider.id}｜Chat：max_completion_tokens 代替 max_tokens`,
			why: "官方 OpenAI 推理模型只认后者；这个端点认不认前者",
			url: chat, key,
			body: { model: model.modelId, stream: true, max_completion_tokens: 64, messages: [{ role: "user", content: "说「好」" }] },
		}));
	}

	/*
	 * 路由形状：我们的 chat 适配器拼出来的地址存不存在。
	 *
	 * `joinUrl(base, "/chat/completions")` 不补 `/v1`，另外两条链补。填了个最自然的 baseUrl
	 * （`https://api.openai.com`）之后，这个差别就是「能用」和「404」。不带密钥打：401 说明路由在、
	 * 只是没认证；404 说明这个地址压根不存在。
	 */
	console.log(`\n════ 路由形状（不带密钥，看 401 还是 404）════`);
	for (const [label, path] of [
		["我们的 chat 适配器拼的", "/chat/completions"],
		["官方文档写的", "/v1/chat/completions"],
	] as const) {
		const response = await fetch(`https://api.openai.com${path}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] }),
		}).catch((e) => ({ status: 0, statusText: String(e) }) as Response);
		const routed = response.status === 401 || response.status === 403;
		console.log(`${routed ? "✅" : "❌"} [${response.status}] ${label}：https://api.openai.com${path}`);
		results.push({
			name: `OpenAI 官方｜${label} ${path}`,
			why: "chat 适配器不补 /v1，填 https://api.openai.com 会不会直接 404",
			status: response.status, ok: routed,
			error: routed ? "" : `${response.status} —— 这个地址不存在`,
		});
	}

	console.log(`\n${"═".repeat(60)}\n汇总：${results.filter((r) => r.ok).length}/${results.length} 通过`);
	for (const r of results) if (!r.ok) console.log(`  ❌ ${r.name} → [${r.status}] ${r.error.slice(0, 160)}`);
}

await main();
