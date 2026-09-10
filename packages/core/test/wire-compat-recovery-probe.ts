/* oxlint-disable no-console -- probe CLI that prints what real endpoints answered */
/**
 * 「必须原样带回推理」这条规矩，边界在哪里——决定了修法能不能落地。
 *
 * 上一个探针证明了：带工具调用的那一轮如果没有推理，DeepSeek 400。但真正难的是**我们手上没有那份
 * 推理**的情况：换过模型（`stripStaleHandles` 把签名剥了）、关着思考跑过一轮、从别处导入的历史。
 * 这时候三条路——补一段假的、把那轮降级成纯文本、或者干脆整轮丢掉——哪条走得通，只有端点说了算。
 *
 * 顺带钉死另一个边界：不带工具的助手轮，要不要推理。要，就得每轮都带；不要，就只补工具轮。
 *
 * 用法：`node --import tsx packages/core/test/wire-compat-recovery-probe.ts`
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = join(homedir(), ".lyra");
const THOUGHT = "先想一下：这是个纯算术问题，直接算就行。";

const TOOL = {
	type: "function",
	name: "calc",
	description: "算一个算术表达式",
	parameters: { type: "object", properties: { expr: { type: "string" } }, required: ["expr"], additionalProperties: false },
};

interface Outcome { name: string; ok: boolean; status: number; note: string }
const results: Outcome[] = [];

async function ask(name: string, url: string, key: string, body: unknown): Promise<boolean> {
	let status = 0;
	let note = "";
	try {
		const response = await fetch(url, {
			method: "POST",
			headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
			body: JSON.stringify(body),
		});
		status = response.status;
		const text = await response.text();
		if (!response.ok) note = message(text);
		else if (/"type"\s*:\s*"(response\.failed|error)"|"error"\s*:\s*\{/.test(text)) note = message(text.slice(-600));
	} catch (e) {
		note = String(e);
	}
	const ok = status >= 200 && status < 300 && !note;
	console.log(`${ok ? "✅" : "❌"} [${status}] ${name}${note ? `\n     ${note}` : ""}`);
	results.push({ name, ok, status, note });
	return ok;
}

/** 中转站会把上游的错误再包一层 JSON；把最里面那句人话挖出来。 */
function message(text: string): string {
	const hit = text.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/g) ?? [];
	const inner = hit.map((h) => h.replace(/^"message"\s*:\s*"/, "").replace(/"$/, "").replace(/\\"/g, '"'));
	const human = inner.find((m) => !m.trim().startsWith("{")) ?? inner[0];
	return (human ?? text).slice(0, 220).replace(/\s+/g, " ");
}

function body(model: string, input: unknown[], tools = true): unknown {
	return {
		model, input, stream: true, store: false, max_output_tokens: 512,
		instructions: "你是一个测试助手，回答尽量短。",
		...(tools ? { tools: [TOOL], tool_choice: "auto" } : {}),
		reasoning: { effort: "low", summary: "auto" },
	};
}

const call = { type: "function_call", call_id: "call_probe_1", name: "calc", arguments: '{"expr":"1+1"}' };
const output = { type: "function_call_output", call_id: "call_probe_1", output: "2" };
const user = (text: string) => ({ role: "user", content: [{ type: "input_text", text }] });
const reasoning = (text: string) => ({ type: "reasoning", content: [{ type: "reasoning_text", text }] });

async function main() {
	const { secret } = await import("../src/config/vault.ts");
	const settings = JSON.parse(await readFile(join(HOME, "settings.json"), "utf8"));

	for (const provider of settings.providers ?? []) {
		const key = provider.apiKey || (await secret(`provider:${provider.id}`)) || (await secret(provider.id));
		if (!key) continue;
		const base = String(provider.baseUrl).replace(/\/+$/, "");
		const model = provider.models?.find((m: { supportsThinking?: boolean; modelId: string }) =>
			m.supportsThinking && /deepseek/i.test(m.modelId)) ?? provider.models?.[0];
		if (!model) continue;
		const url = base.endsWith("/v1") ? `${base}/responses` : `${base}/v1/responses`;
		const chat = base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
		const tag = `${provider.id}·${model.modelId}`;
		console.log(`\n════ ${tag} · ${base} ════`);

		console.log("── 边界一：不带工具的助手轮，需不需要推理 ──");
		await ask(`${tag}｜纯文本助手轮，无推理`, url, key, body(model.modelId, [
			user("1+1 等于几？只回数字。"),
			{ type: "message", role: "assistant", content: [{ type: "output_text", text: "2" }] },
			user("那 2+2 呢？"),
		], false));

		console.log("── 边界二：手上没有真推理时，能不能糊弄过去 ──");
		await ask(`${tag}｜补一段合成的推理`, url, key, body(model.modelId, [
			user("1+1 等于几？只回数字。"),
			reasoning("(此轮推理未被记录)"),
			call, output,
		]));

		await ask(`${tag}｜补一段空字符串推理`, url, key, body(model.modelId, [
			user("1+1 等于几？只回数字。"),
			reasoning(""),
			call, output,
		]));

		console.log("── 边界三：降级——把那一轮改写成纯文本，不再声称有工具调用 ──");
		await ask(`${tag}｜工具轮降级成文本转述`, url, key, body(model.modelId, [
			user("1+1 等于几？只回数字。"),
			{ type: "message", role: "assistant", content: [{ type: "output_text", text: "我调用了 calc(1+1)，结果是 2。" }] },
			user("那 2+2 呢？"),
		]));

		console.log("── 边界四：只有最后一轮带推理，更早的工具轮不带 ──");
		await ask(`${tag}｜只有最后一轮带推理`, url, key, body(model.modelId, [
			user("1+1 等于几？"),
			call, output,
			{ type: "message", role: "assistant", content: [{ type: "output_text", text: "2" }] },
			user("那 2+2 呢？"),
			reasoning(THOUGHT),
			{ type: "function_call", call_id: "call_probe_2", name: "calc", arguments: '{"expr":"2+2"}' },
			{ type: "function_call_output", call_id: "call_probe_2", output: "4" },
		]));

		console.log("── 边界五：Chat 链上同样的三个问题 ──");
		const chatTools = [{ type: "function", function: { name: "calc", description: TOOL.description, parameters: TOOL.parameters } }];
		const chatCall = { role: "assistant", content: "", tool_calls: [{ id: "call_probe_1", type: "function", function: { name: "calc", arguments: '{"expr":"1+1"}' } }] };
		const chatBase = { model: model.modelId, stream: true, tools: chatTools, tool_choice: "auto", max_tokens: 256 };

		await ask(`${tag}｜Chat：合成的 reasoning_content`, chat, key, {
			...chatBase,
			messages: [
				{ role: "user", content: "1+1 等于几？只回数字。" },
				{ ...chatCall, reasoning_content: "(此轮推理未被记录)" },
				{ role: "tool", tool_call_id: "call_probe_1", content: "2" },
			],
		});

		await ask(`${tag}｜Chat：纯文本助手轮，无 reasoning_content`, chat, key, {
			...chatBase,
			messages: [
				{ role: "user", content: "1+1 等于几？只回数字。" },
				{ role: "assistant", content: "2" },
				{ role: "user", content: "那 2+2 呢？" },
			],
		});

		await ask(`${tag}｜Chat：更早的工具轮不带、最后一轮带`, chat, key, {
			...chatBase,
			messages: [
				{ role: "user", content: "1+1 等于几？" },
				chatCall,
				{ role: "tool", tool_call_id: "call_probe_1", content: "2" },
				{ role: "assistant", content: "2" },
				{ role: "user", content: "那 2+2 呢？" },
				{ role: "assistant", content: "", reasoning_content: THOUGHT, tool_calls: [{ id: "call_probe_2", type: "function", function: { name: "calc", arguments: '{"expr":"2+2"}' } }] },
				{ role: "tool", tool_call_id: "call_probe_2", content: "4" },
			],
		});
	}

	console.log(`\n${"═".repeat(60)}\n汇总：${results.filter((r) => r.ok).length}/${results.length} 通过`);
	for (const r of results) console.log(`  ${r.ok ? "✅" : "❌"} [${r.status}] ${r.name}${r.note ? ` → ${r.note.slice(0, 110)}` : ""}`);
}

await main();
