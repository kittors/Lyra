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
