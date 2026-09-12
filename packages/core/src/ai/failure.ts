/**
 * 一次失败是什么、值不值得再试一次——只在这里回答一次。
 *
 * 从前这个判断被写了四遍：HTTP 状态码一份白名单（`isRetryableStatus`），传输异常一份白名单
 * （`isRetryableError`），流内 error 事件干脆当成「服务商本人拒绝了」直接早退，整轮恢复那层再
 * 拿一个 `retryable` 布尔自己判一次。四份名单互不知情，于是同一个故障在这一层算「可以再试」、
 * 在下一层算「没救了」，设置页写着「无限重试」而请求在第一次就放弃——因为那种失败压根没进过
 * 重试的门。
 *
 * 更要命的是四份都是**白名单**：只有见过的才重试。中转每换一种错法就多一个漏网的，而中转换错法
 * 这件事是不会停的。所以这里把默认值翻过来：
 *
 *   只有明确「再问一百遍也是这个答复」的才是 `fatal`，其余一切都值得再试。
 *
 * 黑名单是有限的、确定的、几乎不增长的——密钥、模型名、请求体、配额、内容策略，就这几样。而
 * 「其余一切」是敞开的：下一个没见过的状态码、下一种错误体格式、下一个只写着 `Unknown provider
 * error` 的空事件，不改一行代码就自动落进 `upstream`。
 *
 * 两个可重试的值刻意只有两个，因为设置页上就是两行（`RetryPolicy`）。类型层面保证「界面上能配
 * 的」和「实际会重试的」不会各说各话——想加第三类，改这个枚举，编译器会把该改的地方全指出来。
 */

/**
 * 摘要的长度上限。
 *
 * 界面上这句话只有一行的位置，而中转的错误体动辄是一整页 JSON 或者一段 HTML。原文不会丢——它在
 * `detail` 里，界面把它折进可滚动的区域和悬停提示——但顶在最前面的必须是一句能一眼看完的话。
 */
const SUMMARY_MAX = 48;

/** 原文留多少。够看清是什么，又不至于把一页 HTML 塞进会话日志的每一条记录。 */
const DETAIL_MAX = 2000;

type FailureKind = "network" | "upstream" | "fatal";

/**
 * 界面据此挂动作：401 旁边给「去检查密钥」，404 给「换个模型」。
 *
 * 是分类的产物而不是界面自己猜的，所以加一个动作不用碰分类逻辑，认一种新错误也不用碰界面。
 */
type FailureHint = "check-key" | "check-model" | "check-billing" | "check-request" | "blocked";

export interface Failure {
	kind: FailureKind;
	/** 一句话，一行放得下，给人看的。 */
	summary: string;
	/** 服务商原文，展开或悬停才看。 */
	detail?: string;
	/** 服务器自己说的等待时间，比任何我们猜的曲线都准。 */
	retryAfterMs?: number;
	hint?: FailureHint;
	/**
	 * 「还是刚才那个错误吗」的答案。
	 *
	 * 无限重试撞上一个我们不认识的终局错误时，界面唯一能说的真话就是「已经重连 47 次，一直是
	 * 同一个错误」。指纹让这句话不需要认识任何具体的错误就能说出口——真正的临时故障，文案和状态
	 * 码会变；一字不差重复几十次的，人一眼就知道不是在排队。
	 */
	fingerprint: string;
	/**
	 * 这一种失败自己的重试上限，和用户的策略取更严的那个。
	 *
	 * 绝大多数失败不该有这个——「重试几次」是用户的决定，设置页上那个「一直重试」写着的就是
	 * 「网络回来之前别放弃」，那是他要的。
	 *
	 * 例外是重发根本不可能改变结果的那些。空回答是眼下唯一一种：重发的是逐字节相同的请求体，
	 * 拿回来的是逐字节相同的空。服务端状态的波动（503、限流、实例在换）几次之内就会变个样子，
	 * 而几十次一模一样的，只说明这个请求在这个端点上就是会得到空——再等一百次也是。
	 *
	 * 真实日志里量到过一次：同一个请求重发 222 次、34 分钟，直到人工按停。
	 */
	retryLimit?: number;
	/**
	 * 这次失败有没有已经花掉 token。
	 *
	 * 流已经开始吐字，说明请求被受理了，那些 token 服务商已经收过钱——重试就是再付一次。连接在
	 * 握手阶段就断掉则一分钱没花。两者都该重试，但只有前者需要把代价摆到界面上，否则一个开着
	 * 无限重试的窗口可以安静地烧穿账单。
	 */
	costIncurred?: boolean;
}

export type FailureInput =
	/** fetch 本身抛了：连接没建立，或者建立后断了。 */
	| { from: "transport"; error: unknown }
	/** 服务器答了，但状态码不是 2xx。 */
	| { from: "status"; status: number; body?: string }
	/** 连接和状态码都正常，错误写在流里面。 */
	| { from: "stream"; message?: string; raw?: string; spent?: boolean }
	/** 流正常结束，但一个字都没有——见 `emptyReply`。 */
	| { from: "empty"; why: "no-content" | "no-frames" | "unparsable"; body?: string };

// ---------------------------------------------------------------------------
// 黑名单：唯一需要维护的名单
// ---------------------------------------------------------------------------

/**
 * 再问一百遍也是同一个答复的状态码。
 *
 * 401/403 是密钥，404 是模型名或地址，402 是钱，400/413/422 是请求体本身——注意最后这组在到达
 * 这里之前，`loop.ts` 已经试过裁掉历史重发一次了，所以走到这一步意味着裁完还是不行。
 *
 * 429 明显不在里面：它是「现在别问，等会儿再问」，是最该重试的一个。
 */
const FATAL_STATUS = new Map<number, { summary: string; hint: FailureHint }>([
	[400, { summary: "请求不被接受", hint: "check-request" }],
	[401, { summary: "密钥被拒绝", hint: "check-key" }],
	[403, { summary: "没有访问权限", hint: "check-key" }],
	[404, { summary: "模型或地址不存在", hint: "check-model" }],
	[402, { summary: "额度不足", hint: "check-billing" }],
	[413, { summary: "请求内容过大", hint: "check-request" }],
	[422, { summary: "请求参数不合法", hint: "check-request" }],
]);

/**
 * 证书出问题不是网络抖动。
 *
 * 一张过期的证书、一个对不上的域名，重试一百次还是同一张证书。这几个码是从旧的
 * `isRetryableError` 原样搬过来的——那里它们是白名单里的例外，在这里它们回到了自己该在的位置：
 * 黑名单本身。
 */
const FATAL_CAUSES = new Set([
	"ERR_TLS_CERT_ALTNAME_INVALID",
	"CERT_HAS_EXPIRED",
	"DEPTH_ZERO_SELF_SIGNED_CERT",
	"UNABLE_TO_VERIFY_LEAF_SIGNATURE",
	"SELF_SIGNED_CERT_IN_CHAIN",
	"ERR_INVALID_URL",
]);

/**
 * 写在错误正文里的终局理由。
 *
 * 中转很少给出规矩的状态码——一个欠费的账号可能收到 200 加一个流内 error 事件。能认出来的就认，
 * 认不出来的落进 `upstream` 去重试，再由界面把「一直是同一个错误」说出来。所以这张表宁可短一些
 * 也不要猜：错判成 `fatal` 会让一次本可以自愈的抖动直接终止，那比多重试几次糟得多。
 */
const FATAL_PHRASES: { match: RegExp; summary: string; hint: FailureHint }[] = [
	{ match: /insufficient[_\s-]?quota|exceeded your current quota|余额不足|额度不足|欠费/i, summary: "额度不足", hint: "check-billing" },
	{ match: /invalid[_\s-]?api[_\s-]?key|incorrect api key|unauthorized|api key not valid|密钥无效/i, summary: "密钥被拒绝", hint: "check-key" },
	{ match: /account[_\s-]?(deactivated|disabled|suspended|banned)|账号已(停用|禁用|封禁)/i, summary: "账号已停用", hint: "check-billing" },
	{ match: /content[_\s-]?filter|content[_\s-]?policy|safety|违反.{0,6}政策|内容审核/i, summary: "内容被安全策略拒绝", hint: "blocked" },
	{ match: /model[_\s-]?not[_\s-]?found|does not exist|no such model|模型不存在/i, summary: "模型或地址不存在", hint: "check-model" },
	{ match: /context[_\s-]?length[_\s-]?exceeded|maximum context length|too many tokens/i, summary: "上下文超出模型上限", hint: "check-request" },
];

/**
 * 传输层的老面孔，用来把 `network` 和 `upstream` 分开。
 *
 * 注意这已经不是准入名单了——认不出来的不会被拒之门外，只是归到 `upstream` 而已。它现在只负责
 * 回答「该用哪一条规则的间隔」，而不再决定「要不要重试」。这两件事从前是搅在一起的。
 */
const TRANSPORT_CAUSES = /^(UND_ERR_|ECONN|ETIMEDOUT|EPIPE|EAI_|ENOTFOUND|ENETUNREACH|EHOSTUNREACH|ECONNRESET|EHOSTDOWN|ENETDOWN|EADDRNOTAVAIL)/;
const TRANSPORT_WORDS = /fetch failed|socket hang up|premature close|terminated|stream_read_error|network|connection|timeout|aborted|ecconn/i;

// ---------------------------------------------------------------------------
// 从原文里挑出一句人话
// ---------------------------------------------------------------------------

/** 常见状态码的固定说法，比把服务器的原文直接顶上去要好读。 */
const STATUS_WORDS = new Map<number, string>([
	[408, "请求超时"],
	[425, "请求过早"],
	[429, "被限流"],
	[500, "服务端异常"],
	[502, "网关错误"],
	[503, "服务暂时不可用"],
	[504, "网关超时"],
	[520, "中转返回未知错误"],
	[521, "源站拒绝连接"],
	[522, "连接源站超时"],
	[524, "源站响应超时"],
	[529, "服务过载"],
	[530, "源站不可达"],
]);

/** HTML 不是给人读的错误信息——一段 `<html><head><title>502` 顶在界面上等于什么都没说。 */
const looksLikeMarkup = (text: string) => /^\s*<(!doctype|html|head|body|pre|center)\b/i.test(text);

/**
 * 错误正文里那句真正说明问题的话。
 *
 * 每家中转把它放在不同的地方，所以按常见程度依次找。找不到就返回空，让调用方退回到状态码的固定
 * 说法——那也比把整个 JSON 糊在界面上强。
 */
export function messageFromBody(body: string | undefined): string {
	if (!body) return "";
	const text = body.trim();
	if (!text || looksLikeMarkup(text)) return "";
	try {
		const parsed: unknown = JSON.parse(text);
		const found = digForMessage(parsed, 0);
		if (found) return found;
	} catch {
		// 不是 JSON。纯文本的短错误照用，长的不要——那多半是一页别的东西。
		if (text.length <= 120 && !text.includes("\n")) return text;
	}
	return "";
}

/** `{error:{message}}`、`{message}`、`{detail}`、`{error:"..."} `——同一件事的四五种写法。 */
function digForMessage(value: unknown, depth: number): string {
	if (depth > 3 || !value) return "";
	if (typeof value === "string") return value.trim();
	if (typeof value !== "object") return "";
	const record = value as Record<string, unknown>;
	for (const key of ["message", "detail", "error_message", "msg", "reason", "description"]) {
		const candidate = record[key];
		if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
	}
	for (const key of ["error", "err", "data", "body"]) {
		if (key in record) {
			const found = digForMessage(record[key], depth + 1);
			if (found) return found;
		}
	}
	return "";
}

/** 一行放得下的一句话。原文完整地留在 `detail` 里，这里只负责开头那句。 */
function shorten(text: string): string {
	const flat = text.replace(/\s+/g, " ").trim();
	if (flat.length <= SUMMARY_MAX) return flat;
	return `${flat.slice(0, SUMMARY_MAX - 1)}…`;
}

/**
 * 服务器说要等多久，毫秒。
 *
 * 从 `Retry-After` 头和错误正文两处找，因为两边都有人用。正文那一路尤其要紧：我们面前这个中转
 * 用 `{"reset_seconds":54}` 回答 503 而完全不发头，从前每一次等待都因此退回到猜的曲线上，几秒钟
 * 就把整个重试预算花在一场它早就说明要持续一分钟的故障上。
 */
export function serverDelayMs(header: string | null | undefined, body?: string): number | undefined {
	if (header) {
		const asSeconds = Number(header);
		const ms = Number.isFinite(asSeconds) ? asSeconds * 1000 : Date.parse(header) - Date.now();
		if (Number.isFinite(ms) && ms > 0) return ms;
	}
	if (!body) return undefined;
	/*
	 * 用正则而不是 `JSON.parse`，是故意的。
	 *
	 * 这个字段藏在不同的层级里，每家还不一样，真要解析就得预先知道所有形状。稳定的是「这个键名
	 * 后面跟着一个数」，而错误正文小到扫一遍不花什么。只认已知的键名，也只认看起来像等待时间的
	 * 数——满世界找数字，迟早会找到一个带数字的模型名然后睡上那么久。
	 */
	const numeric = body.match(/"(?:reset_seconds|retry_after|retry_after_seconds|retryAfter|retry_after_ms)"\s*:\s*(\d+(?:\.\d+)?)/);
	if (numeric) {
		const raw = Number(numeric[1]);
		const ms = numeric[0].includes("_ms") ? raw : raw * 1000;
		if (ms > 0) return ms;
	}
	// `"reset_time":"53s"`——同一件事写成字符串，也有人这么发。
	const written = body.match(/"(?:reset_time|retry_after)"\s*:\s*"(\d+(?:\.\d+)?)s"/);
	if (written) {
		const ms = Number(written[1]) * 1000;
		if (ms > 0) return ms;
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// 指纹
// ---------------------------------------------------------------------------

/**
 * 把一次失败压成一个短串，用来判断「还是刚才那个错误吗」。
 *
 * 归一化掉每次都会变的东西——数字、UUID、时间戳——否则每条带请求 id 的错误都是「新」的，这个
 * 判断就永远不会成立。
 */
function fingerprintOf(kind: FailureKind, key: string): string {
	const normalized = key
		.toLowerCase()
		.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "#")
		/*
		 * 请求 id 多半是十六进制，而不是十进制。
		 *
		 * 只归一化纯数字是不够的：`request 8f2a1b` 和 `request c93d4e` 是同一个错误的两次，而按
		 * 数字规则它们长得完全不同——于是「一直是同一个错误」这句话永远说不出口。要求里面至少有
		 * 一个数字，免得把 `deadbeef` 这样的普通词也吃掉。
		 */
		.replace(/\b(?=[0-9a-f]*\d)[0-9a-f]{6,}\b/g, "#")
		.replace(/\b\d+\b/g, "#")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 120);
	let hash = 0;
	for (let index = 0; index < normalized.length; index++) {
		hash = (Math.imul(hash, 31) + normalized.charCodeAt(index)) | 0;
	}
	return `${kind}:${(hash >>> 0).toString(36)}`;
}

// ---------------------------------------------------------------------------
// 分类
// ---------------------------------------------------------------------------

export function classifyFailure(input: FailureInput): Failure {
	switch (input.from) {
		case "transport":
			return fromTransport(input.error);
		case "status":
			return fromStatus(input.status, input.body);
		case "stream":
			return fromStream(input.message, input.raw, input.spent === true);
		case "empty":
			return fromEmpty(input.why, input.body);
	}
}

/**
 * 状态码写在异常消息里的那些。
 *
 * `FailureError` 之外，还有一类错误是「已经被压成一句话」的：某处 `throw new Error("HTTP 401:
 * ...")`，或者一个库抛出 `400 Bad Request`。从异常的角度看它们没有 `cause.code`、不认识自己，会
 * 一路落到「没见过的连接问题」里去重试——而 401 重试一万次也还是 401。
 *
 * 只认开头那几种明确的写法。满句子找三位数，迟早会把某个带数字的模型名或者一个字节数当成状态码。
 */
const STATUS_IN_TEXT = [/^HTTP (\d{3})\b/, /^(\d{3}) [A-Z]/, /\bstatus(?: code)?[:\s]+(\d{3})\b/i];

function statusFromText(text: string): number | undefined {
	for (const pattern of STATUS_IN_TEXT) {
		const found = text.match(pattern);
		if (found) {
			const status = Number(found[1]);
			if (status >= 400 && status <= 599) return status;
		}
	}
	return undefined;
}

function fromTransport(error: unknown): Failure {
	const code = (error as { cause?: { code?: string } })?.cause?.code;
	const text = error instanceof Error ? error.message : String(error);

	/*
	 * 消息里写着状态码的，按状态码判——它比「这是个异常」这件事说明的多。
	 *
	 * 放在证书检查之后、传输兜底之前：证书问题有自己的 `cause.code`，而这一段针对的是连 code 都
	 * 没有、只剩一句话的那种。
	 */
	if (!code) {
		const status = statusFromText(text);
		if (status !== undefined) return fromStatus(status, text);
	}

	if (code && FATAL_CAUSES.has(code)) {
		return {
			kind: "fatal",
			summary: code === "ERR_INVALID_URL" ? "接口地址无效" : "证书校验失败",
			detail: truncateDetail(`${text}${code ? ` (${code})` : ""}`),
			hint: code === "ERR_INVALID_URL" ? "check-model" : undefined,
			fingerprint: fingerprintOf("fatal", code),
		};
	}

	/*
	 * 认不出来的也算连接问题，只要它是从 fetch 里抛出来的。
	 *
	 * 走到这里意味着连接层出了状况而我们没见过它的名字。归到 `network` 而不是 `upstream`，是因为
	 * 抛出的位置本身就是证据：服务器要是答了话，我们会在状态码那一路见到它。
	 */
	const known = code ? TRANSPORT_CAUSES.test(code) : TRANSPORT_WORDS.test(text);
	return {
		kind: "network",
		summary: known ? "连接中断" : shorten(text) || "连接中断",
		detail: truncateDetail(`${text}${code ? ` (${code})` : ""}`),
		fingerprint: fingerprintOf("network", code ?? text),
	};
}

function fromStatus(status: number, body?: string): Failure {
	const said = messageFromBody(body);
	const detail = truncateDetail(body ?? "");
	const fatal = FATAL_STATUS.get(status);

	if (fatal) {
		return {
			kind: "fatal",
			summary: said ? `${fatal.summary}：${shorten(said)}` : fatal.summary,
			detail,
			hint: fatal.hint,
			fingerprint: fingerprintOf("fatal", `${status}:${said}`),
		};
	}

	/*
	 * 正文里写着终局理由的，即使状态码看着像临时故障也照拒。
	 *
	 * 有的中转把欠费答成 503，重试到天荒地老也不会变成有钱。
	 */
	const phrase = matchFatalPhrase(said || body || "");
	if (phrase) {
		return {
			kind: "fatal",
			summary: phrase.summary,
			detail,
			hint: phrase.hint,
			fingerprint: fingerprintOf("fatal", `${status}:${phrase.summary}`),
		};
	}

	const words = STATUS_WORDS.get(status);
	return {
		kind: "upstream",
		summary: words ? words : said ? shorten(said) : `服务端返回 ${status}`,
		detail,
		retryAfterMs: serverDelayMs(undefined, body),
		fingerprint: fingerprintOf("upstream", `${status}:${said}`),
	};
}

function fromStream(message: string | undefined, raw: string | undefined, spent: boolean): Failure {
	const said = (message ?? "").trim() || messageFromBody(raw);
	const phrase = matchFatalPhrase(said || raw || "");
	if (phrase) {
		return {
			kind: "fatal",
			summary: phrase.summary,
			detail: truncateDetail(raw ?? said),
			hint: phrase.hint,
			fingerprint: fingerprintOf("fatal", phrase.summary),
			costIncurred: spent || undefined,
		};
	}

	/*
	 * 从前这里是直接放弃的。
	 *
	 * 一句「服务商自己拒绝了，再问也是同样答复」的注释，把中转塞进流里的每一种临时故障都判了
	 * 死刑——包括那个连 message 都不给、只能显示成 `Unknown provider error` 的空事件。它现在
	 * 和别的临时故障一样重试，认得出是终局理由的才在上面那一段被拦下。
	 */
	return {
		kind: "upstream",
		summary: said ? shorten(said) : "服务商中断了这次回答",
		detail: truncateDetail(raw ?? said),
		retryAfterMs: serverDelayMs(undefined, raw),
		fingerprint: fingerprintOf("upstream", said || "stream-error"),
		costIncurred: spent || undefined,
	};
}

function fromEmpty(why: "no-content" | "no-frames" | "unparsable", body?: string): Failure {
	const said = messageFromBody(body);
	const phrase = matchFatalPhrase(said || body || "");
	if (phrase) {
		return {
			kind: "fatal",
			summary: phrase.summary,
			detail: truncateDetail(body ?? ""),
			hint: phrase.hint,
			fingerprint: fingerprintOf("fatal", phrase.summary),
		};
	}
	/*
	 * 空回复也是失败。
	 *
	 * 从前不是：流正常结束、一个字都没有，会以 `stopReason: "stop"` 收场，屏幕上留下一条空白的
	 * 回答，既不报错也不重试。真值表里有三种故障长这样——一个把错误写成 JSON 却回 200 的中转、
	 * 一个空流、一串非法 JSON——它们和「模型确实没话说」在结局上完全无法区分。
	 */
	const summary = said
		? shorten(said)
		: why === "unparsable"
			? "返回的内容无法解析"
			: "服务商返回了空回答";
	return {
		kind: "upstream",
		summary,
		detail: truncateDetail(body ?? ""),
		fingerprint: fingerprintOf("upstream", `empty:${why}:${said}`),
		/*
		 * 空回答仍然是失败，仍然重试——只是不会重试到地老天荒。见 `Failure.retryLimit`。
		 *
		 * 四次，因为这四次发的是同一个请求体。真临时的波动（中转在重启、实例在换）一两次之内就
		 * 会变个样子，四次是给它的宽限；四次之后还是一模一样的空，继续发第五次唯一确定的事情是
		 * 再等五秒。
		 */
		retryLimit: EMPTY_REPLY_RETRIES,
	};
}

/**
 * 空回答最多重试几次，无论用户把重试设成了什么。
 *
 * 单独命名而不是写成一个字面量，因为解释它的那段话和用到它的地方必须待在一起——下一个想调大
 * 它的人要先读过「重发的是同一个请求体」这句。
 */
const EMPTY_REPLY_RETRIES = 4;

function matchFatalPhrase(text: string): { summary: string; hint: FailureHint } | undefined {
	if (!text) return undefined;
	for (const rule of FATAL_PHRASES) {
		if (rule.match.test(text)) return { summary: rule.summary, hint: rule.hint };
	}
	return undefined;
}

function truncateDetail(text: string): string | undefined {
	const trimmed = text.trim();
	if (!trimmed) return undefined;
	return trimmed.length <= DETAIL_MAX ? trimmed : `${trimmed.slice(0, DETAIL_MAX)}…（还有 ${trimmed.length - DETAIL_MAX} 字）`;
}

/** 值得再试一次吗。三层重试问的都是这一个问题。 */
export const worthRetrying = (failure: Failure): boolean => failure.kind !== "fatal";

/**
 * 一个已经判过的失败，被包成异常往上抛。
 *
 * 少了它就会判两遍，而第二遍是错的：一个 401 在状态码那一路被正确地判成 `fatal`，调用方把它抛成
 * `new Error("HTTP 401: invalid key")`，到了流重试那一层就只剩一个字符串——从异常的角度看它既没有
 * `cause.code` 也不认识自己，于是落进「认不出来的连接问题」，然后被无限重试。判断带着结论一起走，
 * 上面每一层就都不必再猜。
 */
export class FailureError extends Error {
	readonly failure: Failure;
	constructor(failure: Failure) {
		super(failure.summary);
		this.name = "FailureError";
		this.failure = failure;
	}
}

/**
 * 这个异常代表的失败是什么。
 *
 * 已经判过的照搬，没判过的当传输故障判——那是异常唯一可能的另一个来源。
 */
export function failureOf(error: unknown): Failure {
	if (error instanceof FailureError) return error.failure;
	return classifyFailure({ from: "transport", error });
}
