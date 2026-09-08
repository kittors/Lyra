/**
 * 一张真值表，回答「哪些失败会被重试」。
 *
 * 不是断言，是测量。重试的判断散在四处——HTTP 状态码白名单、传输异常白名单、流内 error 事件的
 * 早退、以及整轮恢复的 `retryable` 布尔——每一处都只认自己见过的东西，而它们互不知情。这个脚本
 * 把十六种真实故障形态喂给真正的 `streamAssistant`，只看结果：配置说重试两次，实际重试了几次，
 * 最后救回来没有。
 *
 * 每个用例的剧本都一样：前两次故障，第三次正常应答。所以「最终成功」等价于「这种故障被覆盖了」，
 * 一列就够，不用去猜内部走了哪条分支。
 *
 * 改动前后各跑一遍，两张表并排看：
 *   node --experimental-strip-types packages/core/test/failure-matrix.ts
 *   node --experimental-strip-types packages/core/test/failure-matrix.ts --json > /tmp/after.json
 */

import { streamAssistant } from "../src/ai/index.ts";
import type { LlmContext, ModelConfig, ProviderConfig, RetryPolicy } from "../src/types.ts";

// 间隔取下限 1 秒（`normalizeRule` 不接受更小的），两次重试最多等两秒。
const POLICY: RetryPolicy = {
	network: { retries: 2, strategy: "fixed", intervalMs: 1000, maxIntervalMs: 1000 },
	upstream: { retries: 2, strategy: "fixed", intervalMs: 1000, maxIntervalMs: 1000 },
};

const PROVIDER: ProviderConfig = {
	id: "fake",
	name: "假中转",
	baseUrl: "https://relay.test",
	api: "openai-responses",
	apiKey: "sk-test",
	enabled: true,
	models: [],
};

const MODEL: ModelConfig = { id: "m", name: "m", modelId: "gpt-test" };

const CONTEXT: LlmContext = { systemPrompt: "", messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: 0 }], tools: [] };

const encoder = new TextEncoder();

/** 一个 SSE 应答。`cut` 为真时流在中途被掐断，模拟连接掉在一半。 */
function sse(frames: string[], options: { cut?: boolean; status?: number } = {}): Response {
	const body = new ReadableStream({
		start(controller) {
			for (const frame of frames) controller.enqueue(encoder.encode(`${frame}\n\n`));
			if (options.cut) controller.error(Object.assign(new Error("terminated"), { cause: { code: "UND_ERR_SOCKET" } }));
			else controller.close();
		},
	});
	return new Response(body, { status: options.status ?? 200, headers: { "content-type": "text/event-stream" } });
}

const frame = (payload: unknown) => `data: ${JSON.stringify(payload)}`;

/** 一次完整、正常的应答——每个用例的第三次调用都返回它。 */
const ok = () =>
	sse([
		frame({ type: "response.output_item.added", output_index: 0, item: { type: "message", id: "msg_1" } }),
		frame({ type: "response.output_text.delta", output_index: 0, delta: "好了" }),
		frame({ type: "response.output_item.done", output_index: 0, item: { type: "message", id: "msg_1", content: [{ text: "好了" }] } }),
		frame({ type: "response.completed", response: { id: "resp_1", usage: { input_tokens: 1000, output_tokens: 20 } } }),
	]);

/** 吐了一半内容才失败——这些 token 服务商已经收过钱了。 */
const halfSpent = (tail: unknown) =>
	sse([
		frame({ type: "response.output_item.added", output_index: 0, item: { type: "message", id: "msg_1" } }),
		frame({ type: "response.output_text.delta", output_index: 0, delta: "我开始回答了……" }),
		frame({ type: "response.in_progress", response: { usage: { input_tokens: 1000, output_tokens: 800 } } }),
		frame(tail),
	]);

const err = (code: string) => Object.assign(new Error("fetch failed"), { cause: { code } });

interface Case {
	id: string;
	what: string;
	/** 第 `call` 次调用（从 1 起）该发生什么。前两次故障，第三次正常。 */
	fail: () => Response | never;
}

const CASES: Case[] = [
	{ id: "net-reset", what: "连接被重置 (ECONNRESET)", fail: () => { throw err("ECONNRESET"); } },
	{ id: "net-timeout", what: "响应头超时 (UND_ERR_HEADERS_TIMEOUT)", fail: () => { throw err("UND_ERR_HEADERS_TIMEOUT"); } },
	{ id: "net-dns", what: "DNS 暂时失败 (EAI_AGAIN)", fail: () => { throw err("EAI_AGAIN"); } },
	{ id: "net-bare", what: "只有 fetch failed，没有 cause", fail: () => { throw new Error("fetch failed"); } },
	{ id: "http-429", what: "429 限流（带 Retry-After）", fail: () => new Response("slow down", { status: 429, headers: { "retry-after": "1" } }) },
	{ id: "http-503-body", what: "503，等待时间只写在 body 里", fail: () => new Response(JSON.stringify({ error: { code: "model_unavailable", reset_seconds: 1 } }), { status: 503 }) },
	{ id: "http-500", what: "500 上游异常", fail: () => new Response("boom", { status: 500 }) },
	{ id: "http-520", what: "520 Cloudflare（白名单外）", fail: () => new Response("unknown error", { status: 520 }) },
	{ id: "http-530", what: "530 中转自定义码", fail: () => new Response("origin unreachable", { status: 530 }) },
	{ id: "http-200-json", what: "200 但返回的是错误 JSON，不是流", fail: () => new Response(JSON.stringify({ error: { message: "上游繁忙" } }), { status: 200, headers: { "content-type": "application/json" } }) },
	{ id: "stream-error-msg", what: "流内 error 事件，带 message", fail: () => halfSpent({ type: "error", message: "upstream temporarily unavailable" }) },
	{ id: "stream-error-bare", what: "流内 error 事件，什么都没带 ← 截图里的那个", fail: () => halfSpent({ type: "error" }) },
	{ id: "stream-failed", what: "response.failed 事件", fail: () => halfSpent({ type: "response.failed", response: { error: { message: "internal" } } }) },
	{ id: "stream-cut", what: "流吐到一半连接断了", fail: () => sse([frame({ type: "response.output_item.added", output_index: 0, item: { type: "message", id: "m" } }), frame({ type: "response.output_text.delta", output_index: 0, delta: "半句" })], { cut: true }) },
	{ id: "stream-empty", what: "200，流是空的，一个事件都没有", fail: () => sse([]) },
	{ id: "stream-garbage", what: "200，流里全是非法 JSON", fail: () => sse(["data: {不是 JSON", "data: <html>502</html>"]) },
	{ id: "http-401", what: "401 密钥被拒（应当不重试）", fail: () => new Response("invalid api key", { status: 401 }) },
	{ id: "http-404", what: "404 模型不存在（应当不重试）", fail: () => new Response("model not found", { status: 404 }) },
	{ id: "http-402-quota", what: "402 余额不足（应当不重试）", fail: () => new Response(JSON.stringify({ error: { code: "insufficient_quota" } }), { status: 402 }) },
];

interface Row {
	id: string;
	what: string;
	retries: number;
	recovered: boolean;
	stopReason: string;
	retryable: boolean | undefined;
	tokens: number;
	/**
	 * 回答里真正有多少字。
	 *
	 * 加这一列是因为第一版跑出来有三行写着「覆盖」而它们其实什么都没救回来：一个返回错误 JSON 的
	 * 200、一个空流、一串非法 JSON，三者都以 `stopReason: "stop"` 收场——没有报错，也没有内容。
	 * 只看结局的话它们和成功长得一模一样，而屏幕上是一条空回复。比报错更糟的一类。
	 */
	chars: number;
	error: string;
}

async function run(testCase: Case): Promise<Row> {
	let calls = 0;
	let retries = 0;
	const started = Date.now();

	const fetchImpl = (async () => {
		calls += 1;
		if (calls >= 3) return ok();
		return testCase.fail();
	}) as unknown as typeof globalThis.fetch;

	try {
		const stream = streamAssistant(PROVIDER, MODEL, CONTEXT, {
			fetch: fetchImpl,
			retryPolicy: POLICY,
			onRetry: () => {
				retries += 1;
			},
		});
		let result = await stream.next();
		while (!result.done) result = await stream.next();
		const message = result.value;
		const chars = message.content.reduce((sum, block) => sum + (block.type === "text" ? block.text.length : 0), 0);
		return {
			id: testCase.id,
			what: testCase.what,
			retries,
			recovered: (message.stopReason === "stop" || message.stopReason === "toolUse") && chars > 0,
			stopReason: message.stopReason,
			retryable: message.errorRetryable,
			tokens: message.usage.total,
			chars,
			error: (message.errorMessage ?? "").slice(0, 60).replace(/\s+/g, " "),
		};
	} catch (error) {
		return {
			id: testCase.id,
			what: testCase.what,
			retries,
			recovered: false,
			stopReason: "throw",
			retryable: undefined,
			tokens: 0,
			chars: 0,
			error: String(error instanceof Error ? error.message : error).slice(0, 60).replace(/\s+/g, " "),
		};
	} finally {
		void started;
	}
}

const EXPECT_FATAL = new Set(["http-401", "http-404", "http-402-quota"]);

async function main() {
	const rows: Row[] = [];
	for (const testCase of CASES) rows.push(await run(testCase));

	if (process.argv.includes("--json")) {
		console.log(JSON.stringify(rows, null, 2));
		return;
	}

	/** 静默失败：没报错、没重试、也没有内容——屏幕上是一条空回复。 */
	const silent = (row: Row) => !row.recovered && row.stopReason !== "error" && row.stopReason !== "throw";

	const verdict = (row: Row) => {
		if (EXPECT_FATAL.has(row.id)) return row.recovered ? "⚠️ 不该重试" : "✅ 正确拒绝";
		if (row.recovered) return "✅ 覆盖";
		return silent(row) ? "🕳 静默失败" : "❌ 漏网";
	};

	console.log("\n| 故障形态 | 配置重试 | 实际重试 | 结局 | 回答字数 | 判定 |");
	console.log("| --- | --- | --- | --- | --- | --- |");
	for (const row of rows) {
		console.log(`| ${row.what} | 2 | ${row.retries} | ${row.stopReason} | ${row.chars} | ${verdict(row)} |`);
	}

	const missed = rows.filter((row) => !EXPECT_FATAL.has(row.id) && !row.recovered && !silent(row));
	const quiet = rows.filter((row) => !EXPECT_FATAL.has(row.id) && silent(row));
	const ignoredSetting = rows.filter((row) => !EXPECT_FATAL.has(row.id) && !row.recovered && row.retries === 0);
	console.log(`\n共 ${rows.length} 种故障：漏网 ${missed.length} 种，静默失败 ${quiet.length} 种。`);
	if (missed.length) console.log(`漏网（报错但不重试）：${missed.map((row) => row.id).join("、")}`);
	if (quiet.length) console.log(`静默失败（当成空回复）：${quiet.map((row) => row.id).join("、")}`);
	if (ignoredSetting.length) console.log(`一次都没重试（设置形同虚设）：${ignoredSetting.map((row) => row.id).join("、")}`);
}

await main();
