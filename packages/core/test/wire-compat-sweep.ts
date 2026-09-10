/* oxlint-disable no-console -- probe CLI that prints what real endpoints answered */
/**
 * 把「带工具调用的历史能不能发回去」这一条，在**每一个配好的模型**上跑一遍。
 *
 * 前两个探针在一个 DeepSeek 模型上钉死了规律；这个负责证明规律的覆盖面——33 个模型里到底几个受影响，
 * 换成修好的形状之后又有几个被治好、有没有反而被治坏的。没有这一步，"修好了" 只是一个模型的断言。
 *
 * 请求一律在拿到状态码和第一个数据块之后就掐断：400 在生成之前就返回，200 只要确认它开始出流即可，
 * 没必要为了一次形状检查把一整段回答生成完。
 *
 * 用法：`node --import tsx packages/core/test/wire-compat-sweep.ts`
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

/** 状态码加上人话，流一开始就掐断。 */
async function probe(url: string, key: string, body: unknown): Promise<{ status: number; note: string }> {
	const abort = new AbortController();
	try {
		const response = await fetch(url, {
			method: "POST",
			headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
			body: JSON.stringify(body),
			signal: abort.signal,
		});
		const reader = response.body?.getReader();
		const first = await reader?.read();
		const text = new TextDecoder().decode(first?.value ?? new Uint8Array());
		abort.abort();
		if (!response.ok) return { status: response.status, note: human(text) };
		if (/"type"\s*:\s*"(response\.failed|error)"/.test(text)) return { status: response.status, note: human(text) };
		return { status: response.status, note: "" };
	} catch (e) {
		if (abort.signal.aborted) return { status: 200, note: "" };
		return { status: 0, note: String(e).slice(0, 120) };
	}
}

/** 中转站把上游错误再包一层 JSON；挖出最里面那句人话。 */
function human(text: string): string {
	const hits = text.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/g) ?? [];
	const inner = hits.map((h) => h.replace(/^"message"\s*:\s*"/, "").replace(/"$/, "").replace(/\\"/g, '"'));
	return ((inner.find((m) => !m.trim().startsWith("{")) ?? inner[0] ?? text) || text).slice(0, 150).replace(/\s+/g, " ");
}

const user = (text: string) => ({ role: "user", content: [{ type: "input_text", text }] });
const call = { type: "function_call", call_id: "call_probe_1", name: "calc", arguments: '{"expr":"1+1"}' };
const output = { type: "function_call_output", call_id: "call_probe_1", output: "2" };

/** 我们现在发的形状：思考只进 `summary`。 */
const nowShape = [user("1+1 等于几？只回数字。"), {
	type: "reasoning", summary: [{ type: "summary_text", text: THOUGHT }],
}, call, output];

/** 提议的形状：`content.reasoning_text` 和 `summary` 都给。 */
const fixedShape = [user("1+1 等于几？只回数字。"), {
	type: "reasoning",
	content: [{ type: "reasoning_text", text: THOUGHT }],
	summary: [{ type: "summary_text", text: THOUGHT }],
}, call, output];

/** 最后的退路：那一轮改写成纯文本，不再声称调过工具。 */
const proseShape = [
	user("1+1 等于几？只回数字。"),
	{ type: "message", role: "assistant", content: [{ type: "output_text", text: "我调用了 calc(1+1)，结果是 2。" }] },
	user("那 2+2 呢？"),
];

function body(model: string, input: unknown[]): unknown {
	return {
		model, input, stream: true, store: false, max_output_tokens: 64,
		instructions: "你是一个测试助手，回答尽量短。",
		tools: [TOOL], tool_choice: "auto",
		reasoning: { effort: "low", summary: "auto" },
	};
}

async function main() {
	const { secret } = await import("../src/config/vault.ts");
	const settings = JSON.parse(await readFile(join(HOME, "settings.json"), "utf8"));
	const rows: Array<{ model: string; now: string; fixed: string; prose: string }> = [];

	for (const provider of settings.providers ?? []) {
		const key = provider.apiKey || (await secret(`provider:${provider.id}`)) || (await secret(provider.id));
		if (!key) continue;
		const base = String(provider.baseUrl).replace(/\/+$/, "");
		const url = base.endsWith("/v1") ? `${base}/responses` : `${base}/v1/responses`;
		const thinkers = (provider.models ?? []).filter((m: { supportsThinking?: boolean }) => m.supportsThinking);
		console.log(`\n════ ${provider.id} · ${base} · ${thinkers.length} 个会思考的模型 ════`);
		console.log(`${"模型".padEnd(42)} 现在的形状       修好的形状       降级成文本`);

		for (const model of thinkers) {
			const now = await probe(url, key, body(model.modelId, nowShape));
			const fixed = await probe(url, key, body(model.modelId, fixedShape));
			// 前两个都过就不必再问退路，省一次请求。
			const prose = now.status === 200 && fixed.status === 200
				? { status: 200, note: "（未测）" }
				: await probe(url, key, body(model.modelId, proseShape));
			const cell = (r: { status: number; note: string }) =>
				(r.status === 200 && !r.note ? "✅ 200" : `❌ ${r.status}`).padEnd(16);
			console.log(`${String(model.modelId).slice(0, 41).padEnd(42)} ${cell(now)} ${cell(fixed)} ${cell(prose)}`);
			if (now.note || fixed.note) console.log(`   └ 现在：${now.note || "—"}\n     修后：${fixed.note || "—"}`);
			rows.push({ model: `${provider.id}/${model.modelId}`, now: `${now.status}`, fixed: `${fixed.status}`, prose: `${prose.status}` });
		}
	}

	const broken = rows.filter((r) => r.now !== "200");
	const healed = broken.filter((r) => r.fixed === "200");
	const stillBroken = broken.filter((r) => r.fixed !== "200");
	const regressed = rows.filter((r) => r.now === "200" && r.fixed !== "200");
	console.log(`\n${"═".repeat(72)}`);
	console.log(`会思考的模型共 ${rows.length} 个`);
	console.log(`  现在这个形状就发不出去的： ${broken.length}`);
	console.log(`  换成修好的形状之后治好的： ${healed.length}`);
	console.log(`  换了还是不行的：           ${stillBroken.length}${stillBroken.length ? `  → ${stillBroken.map((r) => r.model).join(", ")}` : ""}`);
	console.log(`  本来好的、被改坏的：       ${regressed.length}${regressed.length ? `  → ${regressed.map((r) => r.model).join(", ")}` : ""}`);
	const proseSaves = stillBroken.filter((r) => r.prose === "200");
	console.log(`  其中靠「降级成文本」能救的：${proseSaves.length}/${stillBroken.length}`);
}

await main();
