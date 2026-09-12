/** Minimal SSE reader. Yields one parsed frame per `data:` payload. */

export interface SseFrame {
	event?: string;
	data: string;
}

export async function* readSse(response: Response, signal?: AbortSignal): AsyncGenerator<SseFrame> {
	const body = response.body;
	if (!body) throw new Error("Response has no body");

	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	const onAbort = () => void reader.cancel().catch(() => {});
	signal?.addEventListener("abort", onAbort, { once: true });

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });

			// Frames are separated by a blank line. \r\n is tolerated for proxies that rewrite line endings.
			let sep: number;
			while ((sep = findFrameBoundary(buffer)) !== -1) {
				const raw = buffer.slice(0, sep);
				buffer = buffer.slice(sep).replace(/^(\r?\n){2}/, "");
				const frame = parseFrame(raw);
				if (frame) yield frame;
			}
		}
		const tail = parseFrame(buffer);
		if (tail) yield tail;
	} finally {
		signal?.removeEventListener("abort", onAbort);
		reader.releaseLock?.();
	}
}

function findFrameBoundary(buffer: string): number {
	const lf = buffer.indexOf("\n\n");
	const crlf = buffer.indexOf("\r\n\r\n");
	if (lf === -1) return crlf;
	if (crlf === -1) return lf;
	return Math.min(lf, crlf);
}

function parseFrame(raw: string): SseFrame | null {
	const lines = raw.split(/\r?\n/);
	let event: string | undefined;
	const dataLines: string[] = [];
	for (const line of lines) {
		if (line.startsWith("event:")) event = line.slice(6).trim();
		else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
	}
	if (dataLines.length === 0) return null;
	return { event, data: dataLines.join("\n") };
}

/**
 * 同一条 SSE 流，加一个空闲闸。
 *
 * `readSse` 只接一个 AbortSignal，没有计时器：上游把连接挂住不再发帧时，那个 `await reader.read()`
 * 就一直等下去，界面上是一个永远转着的圈，用户只能按停。计时另起一个控制器加在外面，和调用方那个
 * 信号并起来交给它，每收到一帧把计时拨回去。**默认行为一个字节都不变**——正常流里唯一多出来的事是
 * 一次 `clearTimeout` + 一次 `setTimeout`。
 *
 * 住在这里而不是某一条链里：三条链的上游都会挂住，而这个函数本来写着「它被三条链共用」的注释，却
 * 只有 Anthropic 那条接了——两条 OpenAI 链一直是裸的 `readSse`，挂住就无限等。共用的东西放在共用的
 * 地方，是这件事不会再走岔的唯一办法。
 *
 * 取舍两点，都记在这里：
 *
 *   - 计时是**帧级**的，不是字节级的。一个把半个帧挂在那里的上游要等到下一帧才算超时，多等一个阈值。
 *     真正的死连接两者没有区别。
 *   - `readSse` 收到 abort 之后走的是 `reader.cancel()`，那个生成器会**正常结束**而不是抛。所以闸掉
 *     这件事得另外写在 `state.tripped` 上让调用方看——不看的话，一条挂死的流会被当成「模型没话说」，
 *     或者更糟：一个截断了的回答被当成完整的。
 */
export async function* readSseWithIdleTimeout(
	response: Response,
	signal: AbortSignal | undefined,
	idleMs: number,
	state: { tripped: boolean },
): AsyncGenerator<SseFrame> {
	const idle = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const bump = (): void => {
		if (timer !== undefined) clearTimeout(timer);
		timer = setTimeout(() => {
			state.tripped = true;
			idle.abort();
		}, idleMs);
		// 挂死的流那一侧本来就把事件循环撑着，这里不该再多撑一个 10 分钟的计时器。
		(timer as { unref?: () => void }).unref?.();
	};
	try {
		bump();
		for await (const frame of readSse(response, signal ? AbortSignal.any([signal, idle.signal]) : idle.signal)) {
			bump();
			yield frame;
		}
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

/**
 * 一条流安静多久算它已经死了。
 *
 * 十分钟，不是一个延迟指标而是一个死锁闸：生成期间各家都会周期性地发 `ping` 之类的保活帧，任何一帧
 * 都把计时重新拨回去。所以走到这个阈值意味着**一帧都没有**，那不是「在想」。
 *
 * 数字跟 oh-my-pi 给推理流留的 `BEDROCK_REASONING_STREAM_IDLE_TIMEOUT_MS = 600_000` 一致。
 */
export const STREAM_IDLE_TIMEOUT_MS = 600_000;

/**
 * Parse tool-call arguments that may be truncated mid-stream.
 *
 * A model that hits the output limit leaves `{"path": "/a/b` on the wire. Returning `{}` there
 * would hand the tool a silently empty argument set, so callers get `null` and fail the call
 * instead of executing something wrong.
 */
/**
 * 一段工具参数，变成能往字符串上接的样子。
 *
 * 协议写的是「参数按 JSON 字符串分片流式发来」，两条 OpenAI 链的解码器都照这个写：`raw += 片段`。
 * 有的宿主不这么发——它一次给一个**完整的对象**（Google 的 `part.functionCall.args` 就是，中转站转译时
 * 也会变成这样）。对象碰上 `+` 会被 JS 悄悄转成 `"[object Object]"`，于是模型明明说了参数，工具收到的
 * 是这么一串东西：
 *
 *     "tool_calls": [{ "function": { "name": "calc", "arguments": "[object Object]" } }]
 *
 * 这一条特别难查，因为它不报错：请求发得出去，工具照跑，只是参数没了。真实端点上量到过一次，
 * `deepseek-v4-flash:0731` 经中转站走 Chat Completions，第二轮的错是上游解析那串东西时报的
 * 「Value looks like object, but can't find closing」——离真正的原因隔了一整个来回。
 *
 * 对象序列化成 JSON；字符串原样。其余（数字、布尔）按空处理：那不是参数分片，接上去只会污染缓冲区。
 */
export function argumentFragment(value: unknown): string {
	if (typeof value === "string") return value;
	if (value !== null && typeof value === "object") {
		try {
			return JSON.stringify(value);
		} catch {
			return "";
		}
	}
	return "";
}

export function parseToolArguments(text: string): Record<string, unknown> | null {
	const trimmed = text.trim();
	if (!trimmed) return {};
	try {
		const parsed = JSON.parse(trimmed);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}
