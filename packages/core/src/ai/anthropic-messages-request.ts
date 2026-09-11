/**
 * Our messages, in the shape the Messages API wants.
 *
 * A translation and nothing else. Anthropic's shape differs from ours in two ways that matter and
 * are easy to get wrong: tool results are user-role blocks rather than their own role, and a
 * thinking block has to be replayed with a `signature` field — though **whether that signature has
 * to verify depends on the endpoint**, which is why `thinkingReplay` is a parameter and not a
 * constant. See `thinkingReplay` in `anthropic-messages.ts`.
 */

import type { AssistantMessage, Message, ToolResultMessage, ToolSpec, UserContent } from "../types.ts";

/**
 * One block of content, in the wire shape.
 *
 * Open-ended on purpose: the API keeps adding block kinds, and a closed type would mean this file
 * has to be edited before a new one can be passed through untouched.
 */
interface AnthropicBlock {
	type: string;
	[key: string]: unknown;
}

/** One message in the wire shape. Exported because the caller assembles a request around it. */
export interface AnthropicMessage {
	role: "user" | "assistant";
	content: AnthropicBlock[];
}

/**
 * 无签名的思考块在下一轮请求里的去向。
 *
 * 三档，从发得最多到发得最少。**没有一档对所有端点都对**——这正是它是参数的原因，默认值由
 * `anthropic-messages.ts` 按端点算，撞了再往下走一格。
 *
 *   - `"unsigned"`：连没签名的也回放，送 `signature: ""`。非签名端点（DeepSeek / Z.AI / Moonshot
 *     的 Anthropic 兼容端点）上的推理模型要的是这一档：它们不签名，但要求把推理带回来。
 *   - `"signed-only"`：只发带签名的，没签名的整块丢掉。官方 `api.anthropic.com` 要的是这一档——它
 *     会验签，`signature: ""` 过不去。
 *   - `"none"`：一块都不发。签名是别的部署签的、连剥都救不回来时的最后一格。
 *
 * 丢掉而不是降级成文本块，是刻意的：官方 Anthropic 上把推理改写成普通文本会撞上
 * reasoning_extraction 分类器（oh-my-pi `transform-messages.ts:822-828` 记着这件事）。
 */
export type ThinkingReplay = "unsigned" | "signed-only" | "none";

export interface AnthropicEncodeOptions {
	/** 无签名思考块的去向。默认 `"signed-only"`——官方端点的行为，也是这个文件一直以来的行为。 */
	thinkingReplay?: ThinkingReplay;
	/** 这个模型收不收图片。默认 `true`。 */
	supportsImages?: boolean;
	/**
	 * 在消息尾部滚动几个提示缓存断点。默认 0。
	 *
	 * Anthropic 一个请求总共只给 4 个断点（官方文档：`Max 4 cache_control breakpoints per
	 * request`），system 和工具列表各占一个，所以这里最多 2。
	 */
	cacheBreakpoints?: number;
}

/**
 * Anthropic requires tool results to arrive as `tool_result` blocks inside a *user* message,
 * and consecutive results must be merged into one message. Our flat message list has one
 * entry per result, so this collapses runs of them.
 *
 * The merged blocks are put back into the order the calls were made, which is not the order the
 * results were recorded in: tools run in parallel and each result is written down as it finishes,
 * so a history rebuilt from the log has the quickest tool first. Anthropic matches by
 * `tool_use_id` and accepts either, but the request should not differ depending on which tool won
 * the race — an identical conversation that serialises two ways defeats prompt caching for
 * everything after it.
 */
export function toAnthropicMessages(messages: Message[], options: AnthropicEncodeOptions = {}): AnthropicMessage[] {
	const replay = options.thinkingReplay ?? "signed-only";
	const vision = options.supportsImages ?? true;
	const out: AnthropicMessage[] = [];
	const ids = safeToolIds(messages);
	const ordered = orderResultsByCall(messages);
	/** 最后一条助手消息的位置——Anthropic 对「它自己最近那条回复」有一条额外的规矩。见 `untrustedSignatures`。 */
	let latestAssistant = -1;
	for (let at = 0; at < ordered.length; at++) if (ordered[at].role === "assistant") latestAssistant = at;

	/*
	 * 当前这一串 `tool_result` 落在哪条消息里，以及要跟在它后面的图片。
	 *
	 * 显式记着这条消息，而不是每次回头猜「上一条是不是一串工具结果」——因为提升出来的图片一进去，
	 * 「全是 tool_result」这个判断就不成立了，后面的结果会被拆进新消息里，而 Anthropic 要求一轮里
	 * 所有结果并在一条消息里（拆开会让模型学着不再并行调工具）。
	 */
	let run: AnthropicMessage | undefined;
	let runHoist: AnthropicBlock[] = [];
	const closeRun = (): void => {
		if (run && runHoist.length > 0) run.content.push(...runHoist);
		run = undefined;
		runHoist = [];
	};

	for (let at = 0; at < ordered.length; at++) {
		const message = ordered[at];
		if (message.role === "user") {
			closeRun();
			const blocks = toContentBlocks(message.content, vision);
			if (blocks.length > 0) out.push({ role: "user", content: blocks });
			continue;
		}

		if (message.role === "assistant") {
			closeRun();
			const untrusted = untrustedSignatures(message, at === latestAssistant);
			const blocks: AnthropicBlock[] = [];
			for (let i = 0; i < message.content.length; i++) {
				const c = message.content[i];
				if (c.type === "text") {
					if (c.text) blocks.push({ type: "text", text: wellFormed(c.text) });
				} else if (c.type === "thinking") {
					if (replay === "none") continue;
					// 密文那一档跟签名无关：它本身就是可回放的那一份。
					if (c.redacted && c.encrypted) {
						blocks.push({ type: "redacted_thinking", data: c.encrypted });
						continue;
					}
					const trusted = untrusted === "all" || (untrusted === "last-block" && i === message.content.length - 1) ? undefined : c.signature;
					if (trusted) blocks.push({ type: "thinking", thinking: wellFormed(c.thinking), signature: trusted });
					else if (replay === "unsigned" && c.thinking.trim()) blocks.push({ type: "thinking", thinking: wellFormed(c.thinking), signature: "" });
				} else {
					blocks.push({
						type: "tool_use",
						id: ids.get(c.id) ?? c.id,
						name: c.name,
						// 模型自己就会在工具参数 JSON 里吐孤立代理项——流出来时没事，回放时被严格 UTF-8
						// 校验 400。`wellFormedDeep` 保身份，没问题的参数一个字节都不动，缓存前缀不受影响。
						input: wellFormedDeep(c.arguments) as Record<string, unknown>,
					});
				}
			}
			if (blocks.length > 0) out.push({ role: "assistant", content: blocks });
			continue;
		}

		const block = toToolResultBlock(message, ids, vision, runHoist);
		if (run) run.content.push(block);
		else {
			run = { role: "user", content: [block] };
			out.push(run);
		}
	}
	closeRun();

	applyPromptCaching(out, options.cacheBreakpoints ?? 0);
	return out;
}

/**
 * 一组 `text`/`image` 内容换成线上的块，顺手把这个模型接不了的图片换成说明文字。
 *
 * 换成文字而不是丢掉，是因为「这里本来有张图」本身是模型需要知道的上下文：工具结果里少了一张截图，
 * 模型会以为工具什么都没返回。
 */
function toContentBlocks(content: UserContent[], vision: boolean): AnthropicBlock[] {
	const blocks: AnthropicBlock[] = [];
	for (const c of content) {
		if (c.type === "text") {
			blocks.push({ type: "text", text: wellFormed(c.text) });
			continue;
		}
		if (!vision) {
			blocks.push({ type: "text", text: "[image omitted: model does not support vision]" });
			continue;
		}
		const mediaType = normalizeImageMediaType(c.mimeType);
		if (!mediaType) {
			blocks.push({ type: "text", text: `[unsupported image: ${c.mimeType}]` });
			continue;
		}
		blocks.push({ type: "image", source: { type: "base64", media_type: mediaType, data: c.data } });
	}
	return blocks;
}

/**
 * Anthropic 收的图片就这四种。
 *
 * 不在表里的换成文字，而不是原样透传：`tools/paths.ts` 的 `IMAGE_EXTENSIONS` 里有 `.bmp`，MCP 服务器
 * 也可以给回任意 mimeType，而**那个 tool_result 一旦进了历史，之后每一轮都带着它**——透传换来的不是
 * 一次失败，是一个再也说不了话的会话。
 *
 * `image/jpg` 是个常见的写法，改成 `image/jpeg` 而不是判死刑。
 */
export function normalizeImageMediaType(mimeType: string): string | undefined {
	const normalized = mimeType.trim().toLowerCase();
	if (normalized === "image/jpg") return "image/jpeg";
	if (normalized === "image/jpeg" || normalized === "image/png" || normalized === "image/gif" || normalized === "image/webp") return normalized;
	return undefined;
}

/**
 * 一条工具结果消息换成一个 `tool_result` 块。
 *
 * `is_error: true` 的块里不能有图片——Anthropic 的原话是 `all content must be type \`text\` if
 * \`is_error\` is true`。图片不丢，提升到这一串结果后面去（`hoist`），因为「工具失败了，这是失败时的
 * 截图」两样都是模型需要的。MCP 明确支持 `isError: true` 配图片块（`mcp/client.ts:257-261`），所以这
 * 条路是走得到的。
 */
function toToolResultBlock(message: ToolResultMessage, ids: Map<string, string>, vision: boolean, hoist: AnthropicBlock[]): AnthropicBlock {
	let content = toContentBlocks(message.content, vision);
	if (message.isError && content.some((b) => b.type === "image")) {
		for (const b of content) if (b.type === "image") hoist.push(b);
		content = content.filter((b) => b.type !== "image");
		// 图片是这次结果的全部内容时，提升之后块就空了。空的 `content` 在部分兼容端点上也是 400，
		// 而且模型看不出发生过什么，所以留一句话。
		if (content.length === 0) content.push({ type: "text", text: "Tool failed with no output." });
	}
	return {
		type: "tool_result",
		// 和上面那个 `tool_use` 走同一张表。改了一头不改另一头，配对就断了，换来的是另一个 400。
		tool_use_id: ids.get(message.toolCallId) ?? message.toolCallId,
		content,
		...(message.isError ? { is_error: true } : {}),
	};
}

/**
 * 这一轮的思考签名还能不能信。
 *
 * 签名会不可信有两个原因，影响范围差得很远：
 *
 *   - **中断或出错的一轮**：流停在某个块中间，所以只有**最后一个**块的签名可能是半截的。更早的块都
 *     完整——Anthropic 在 `content_block_stop` 才发签名，而那必然发生在下一个块开始之前。把它们一起
 *     剥掉是白扔一条能回放的思维链：想完话、正在输出可见文本时被按停，那个思考块的签名是完好的，剥
 *     掉反而换来 `400 Invalid \`signature\` in \`thinking\` block`。
 *   - **弃用工具的一轮**：这一轮里有工具调用，但它没要求执行（`stopReason !== "toolUse"`）。
 *     `agent/loop.ts:359-370` 会给这些没人答的调用造占位结果好让配对成立，这一轮本身是干净结束的，
 *     但它的签名绑在那个结束状态上，在一个被续写出来的历史里全都验不过——所以**整轮全剥**。
 *
 * 最新那一轮的「弃用工具」例外：Anthropic 要求它自己最近那条回复原样带回，连剥签名都算改动。中断/
 * 出错那条不给例外——那个半截签名留着是必然的 400。
 *
 * 证据：oh-my-pi `transform-messages.ts:716-760`（同一套判断，同一个例外）。
 */
function untrustedSignatures(message: AssistantMessage, isLatest: boolean): "none" | "last-block" | "all" {
	if (message.stopReason === "aborted" || message.stopReason === "error") return "last-block";
	if (message.stopReason === "toolUse") return "none";
	if (!message.content.some((c) => c.type === "toolCall")) return "none";
	return isLatest ? "none" : "all";
}

/**
 * 在消息尾部滚动几个缓存断点。
 *
 * 这条不是 400，是钱：只锚住 system 和工具列表的话，20 轮会话每一轮都把整段历史按全价重读一遍。在
 * 尾部放上断点之后，下一轮那段历史走 `cache_read`（约 1/10 价）。
 *
 * **放在哪不能随便挑**：`cache_control` 能放的块，官方文档列的是 `text` / `image` / `tool_use` /
 * `tool_result` / `document`——`thinking` 和 `redacted_thinking` 不在里面。所以从尾巴往前找第一个能
 * 放的块，找不到就跳过这条消息，而不是硬放在最后一个块上。（`fallback` / `tool_addition` /
 * `tool_removal` 我们不会编出来，一起列上是因为块类型是开放的，将来多一种不该被这里悄悄放坏。）
 */
function applyPromptCaching(messages: AnthropicMessage[], breakpoints: number): void {
	if (breakpoints <= 0) return;
	let placed = 0;
	for (let at = messages.length - 1; at >= 0 && placed < breakpoints; at--) {
		const blocks = messages[at].content;
		for (let i = blocks.length - 1; i >= 0; i--) {
			const block = blocks[i];
			if (NO_CACHE_CONTROL.has(block.type)) continue;
			if (block.cache_control != null) break;
			blocks[i] = { ...block, cache_control: { type: "ephemeral" } };
			placed++;
			break;
		}
	}
}

const NO_CACHE_CONTROL = new Set(["thinking", "redacted_thinking", "fallback", "tool_addition", "tool_removal"]);

/**
 * 同一段文本，孤立代理项换成 U+FFFD。没有孤立代理项时返回的是**原来那个字符串**。
 *
 * 保身份这件事是硬要求，不是优化：这个函数在每一轮的整段历史上跑一遍，只要它随手返回新串，请求字节
 * 就每轮都在变，后面所有的提示缓存全部作废。
 *
 * 触发场景很日常：读过一个被 emoji 截断的文件、grep 命中半个代理对——流出来时没事，回放时被
 * Anthropic 的严格 UTF-8 校验 400，然后整个会话卡死。
 */
export function wellFormed(text: string): string {
	// `lib` 是 ES2023，而 `toWellFormed` 是 ES2024 加的；运行时（Node ≥ 24）一直都有。
	return (text as unknown as { toWellFormed(): string }).toWellFormed();
}

/** 同上，但走遍一个任意深度的值。没有任何一处需要改时，返回的是**原来那个对象**。 */
export function wellFormedDeep(value: unknown): unknown {
	if (typeof value === "string") return wellFormed(value);
	if (Array.isArray(value)) {
		let changed = false;
		const next = value.map((entry) => {
			const clean = wellFormedDeep(entry);
			if (clean !== entry) changed = true;
			return clean;
		});
		return changed ? next : value;
	}
	if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
		let changed = false;
		const next: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
			const clean = wellFormedDeep(entry);
			if (clean !== entry) changed = true;
			next[key] = clean;
		}
		return changed ? next : value;
	}
	return value;
}

/**
 * 会话里每个不合规的工具调用 id，配一个合规的替身。
 *
 * Anthropic 对 `tool_use.id` 有个硬性的字符集要求，实测把它逼出来过：
 *
 *     messages.1.content.0.tool_use.id: String should match pattern '^[a-zA-Z0-9_-]+$'
 *
 * 我们自己不会起这样的名字，但历史里的 id 不都是我们起的：中转站把工具调用叫 `bash:0`，那个冒号一旦
 * 进了会话记录就再也出不去——换模型时 `stripStaleHandles` 会剥掉别的句柄，唯独**刻意保留** `toolCall.id`，
 * 因为它是工具结果找回自己那次调用的唯一钥匙。于是这样一段历史换到任何 Anthropic 格式的供应商之后，
 * 每一轮都 400，退不回去也重试不好。
 *
 * 做成一张一次算好的表，而不是每处用到时各自转换一次，是因为一次调用和它的结果必须换成**同一个**新
 * id。分别转换在多数情况下碰巧一致，碰撞消歧时就不一致了，那时坏掉的是配对——换来另一个 400，而且更难查。
 *
 * 转换本身是确定的：同样的历史每一轮都算出同样的 id，否则每轮请求都长得不一样，后面所有的提示缓存全部作废。
 */
function safeToolIds(messages: Message[]): Map<string, string> {
	const map = new Map<string, string>();
	const taken = new Set<string>();
	for (const message of messages) {
		if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
		for (const c of message.content) {
			if (c.type !== "toolCall" || map.has(c.id)) continue;
			if (/^[a-zA-Z0-9_-]+$/.test(c.id)) { taken.add(c.id); continue; }
			// 逐字符替换，保住原名里还认得出来的那部分——排查问题时 `bash_0` 比一串哈希有用得多。
			const base = c.id.replace(/[^a-zA-Z0-9_-]/g, "_") || "tool";
			let safe = base;
			for (let n = 2; taken.has(safe); n++) safe = `${base}_${n}`;
			taken.add(safe);
			map.set(c.id, safe);
		}
	}
	return map;
}

/**
 * The same history, with each run of tool results in the order its calls were made.
 *
 * Only runs of two or more are touched, which is the only case where an order exists to get wrong,
 * and the original array is returned untouched when nothing moved — this is called on every request
 * with the whole conversation in it.
 *
 * A result whose call is not in the assistant message above it keeps its place at the end of the
 * run rather than being dropped. It is still history the model should see.
 */
function orderResultsByCall(messages: Message[]): Message[] {
	const out: Message[] = [];
	let moved = false;

	for (let index = 0; index < messages.length; index++) {
		const message = messages[index];
		out.push(message);
		if (message.role !== "assistant") continue;

		const run: ToolResultMessage[] = [];
		let after = index + 1;
		for (; after < messages.length; after++) {
			const next = messages[after];
			if (next.role !== "toolResult") break;
			run.push(next);
		}
		if (run.length < 2) continue;

		const spare = [...run];
		const ordered: ToolResultMessage[] = [];
		for (const content of message.content) {
			if (content.type !== "toolCall") continue;
			const at = spare.findIndex((result) => result.toolCallId === content.id);
			if (at >= 0) ordered.push(...spare.splice(at, 1));
		}
		ordered.push(...spare);

		moved ||= ordered.some((result, at) => result !== run[at]);
		out.push(...ordered);
		index = after - 1;
	}

	return moved ? out : messages;
}

export function toAnthropicTools(tools: ToolSpec[]): unknown[] {
	return tools.map((tool, index) => ({
		name: tool.name,
		description: tool.description,
		input_schema: normalizeToolSchema(tool.parameters),
		// Cache the tool list too — it is stable for the whole session.
		...(index === tools.length - 1 ? { cache_control: { type: "ephemeral" } } : {}),
	}));
}

// ---------------------------------------------------------------------------
// Tool schemas
// ---------------------------------------------------------------------------

/*
 * Anthropic 的工具 schema 校验器只认一小部分 JSON Schema 关键字，别的**整个请求拒收**。
 *
 * 这不是理论问题：装一个 Zod 或 Pydantic 生成 schema 的 MCP 服务器就够了——`minItems: 2`、`pattern`、
 * `format: "slug"`、`oneOf`、`exclusiveMinimum` 都是那两个库的日常输出。原样透传的结果是这个供应商
 * **每一轮**都 400，而用户不会把它联想到刚装的那个 MCP。
 *
 * 白名单跟着 Anthropic 官方 Python SDK 的 `lib/_parse/_transform.py::transform_schema` 走（下面四张
 * 表的内容来自 oh-my-pi `anthropic.ts:4565-4605`，它注明了这个出处）。不在表里的键**降级进
 * `description`**，而不是删掉——`minItems: 2` 删掉之后模型就不知道要给两个了，写进描述里它还看得见。
 *
 * 具体每个键报什么错，oh-my-pi 没留原文，这里也**没有原文可引**（未验证原文）。唯一带说明的是
 * `minItems`/`maxItems` 放在 object 节点上会被拒，连 `minItems: 0` 也拒（oh-my-pi `anthropic.ts:4608`
 * 的注释）。
 */

/** 任何节点上都留着的键。 */
const SCHEMA_KEEP = new Set(["$ref", "$defs", "$schema", "definitions", "type", "anyOf", "allOf", "enum", "const", "description", "title", "default", "nullable"]);
/** `type: "object"` 节点上额外留着的键。 */
const SCHEMA_KEEP_OBJECT = new Set(["properties", "required", "additionalProperties"]);
/** `type: "array"` 节点上额外留着的键。`minItems` 只在值是 0 或 1 时留。 */
const SCHEMA_KEEP_ARRAY = new Set(["items", "prefixItems", "minItems"]);
/** `type: "string"` 节点上额外留着的键。`format` 只在值在下面那张表里时留。 */
const SCHEMA_KEEP_STRING = new Set(["format"]);
/** Anthropic 认的 `format` 值，跟着官方 SDK `_transform.py` 的 `SupportedStringFormats`。 */
const SCHEMA_STRING_FORMATS = new Set(["date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid"]);
/** `oneOf` **不在**白名单里，所以它整块降级进描述——递归只需要走留下来的这两个。 */
const COMBINATORS = ["anyOf", "allOf"] as const;

const isPlainObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** 一个 schema 节点的有效类型。没写 `type` 时按有没有 `properties`/`items` 猜。 */
function effectiveType(schema: Record<string, unknown>): string | undefined {
	const declared = schema.type;
	if (typeof declared === "string") return declared;
	if (Array.isArray(declared)) {
		// 联合里含 array 又含 object 时谁也不算——两张表的键混着留会放进错的节点。
		if (declared.includes("array") && !declared.includes("object")) return "array";
		if (declared.includes("object") && !declared.includes("array")) return "object";
		if (declared.includes("string")) return "string";
		return undefined;
	}
	if (isPlainObject(schema.properties)) return "object";
	if (schema.items !== undefined || Array.isArray(schema.prefixItems)) return "array";
	return undefined;
}

/** 一个节点上留不住的键，写进它的 `description`，模型仍然看得见这条约束。 */
function spillToDescription(node: Record<string, unknown>, spill: Array<[string, unknown]>): void {
	const kept = spill.filter(([, value]) => value !== undefined);
	if (kept.length === 0) return;
	const existing = typeof node.description === "string" ? node.description : "";
	const formatted = `{${kept.map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join(", ")}}`;
	node.description = existing ? `${existing}\n\n${formatted}` : formatted;
}

export function normalizeToolSchema(schema: unknown): unknown {
	return normalizeSchemaNode(schema, new WeakMap());
}

function normalizeSchemaNode(schema: unknown, seen: WeakMap<object, unknown>): unknown {
	if (!isPlainObject(schema)) return schema;
	const already = seen.get(schema);
	if (already !== undefined) return already;

	const result: Record<string, unknown> = {};
	seen.set(schema, result);

	const type = effectiveType(schema);
	const perType = type === "object" ? SCHEMA_KEEP_OBJECT : type === "array" ? SCHEMA_KEEP_ARRAY : type === "string" ? SCHEMA_KEEP_STRING : undefined;
	const spill: Array<[string, unknown]> = [];
	for (const key of Object.keys(schema)) {
		if (SCHEMA_KEEP.has(key) || perType?.has(key)) result[key] = schema[key];
		else spill.push([key, schema[key]]);
	}

	if (type === "string" && typeof result.format === "string" && !SCHEMA_STRING_FORMATS.has(result.format)) {
		spill.push(["format", result.format]);
		delete result.format;
	}
	if (type === "array" && result.minItems !== undefined && result.minItems !== 0 && result.minItems !== 1) {
		spill.push(["minItems", result.minItems]);
		delete result.minItems;
	}

	if (isPlainObject(result.properties)) {
		const properties: Record<string, unknown> = {};
		for (const [name, child] of Object.entries(result.properties)) properties[name] = normalizeSchemaNode(child, seen);
		result.properties = properties;
	}
	if (isPlainObject(result.additionalProperties)) result.additionalProperties = normalizeSchemaNode(result.additionalProperties, seen);
	if (Array.isArray(result.items)) result.items = result.items.map((item) => normalizeSchemaNode(item, seen));
	else if (isPlainObject(result.items)) result.items = normalizeSchemaNode(result.items, seen);
	if (Array.isArray(result.prefixItems)) result.prefixItems = result.prefixItems.map((item) => normalizeSchemaNode(item, seen));
	for (const key of COMBINATORS) {
		const variants = result[key];
		if (Array.isArray(variants)) result[key] = variants.map((variant) => normalizeSchemaNode(variant, seen));
	}
	for (const key of ["$defs", "definitions"] as const) {
		const definitions = result[key];
		if (!isPlainObject(definitions)) continue;
		const next: Record<string, unknown> = {};
		for (const [name, child] of Object.entries(definitions)) next[name] = normalizeSchemaNode(child, seen);
		result[key] = next;
	}

	spillToDescription(result, spill);
	return result;
}
