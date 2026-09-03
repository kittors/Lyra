/**
 * What a failure means, said in the language of the person reading it.
 *
 * Errors arrive here as whatever threw them: a sentence from Chromium, a provider's JSON, an errno
 * from the filesystem. Passed through untouched they are at best unhelpful and at worst misleading
 * — `Failed to get sources.` appeared over the top of macOS's own screen-recording prompt, in
 * English, saying nothing about the permission the dialog behind it was asking for. Two accounts of
 * one moment, and the wrong one on top.
 *
 * So known shapes are recognised and restated: what happened, and what to do about it. Anything not
 * recognised is passed through, because a wrong translation is worse than an untranslated one — the
 * original at least leads somewhere when searched for.
 *
 * Pure, so `node --test` can hold it to every case below.
 */

export interface Explained {
	/** The headline, in the reader's language. */
	message: string;
	/** What to do about it, when there is something. */
	hint?: string;
	/**
	 * Whether to say it at all.
	 *
	 * Some failures are already being reported by the system, better than this could: macOS puts up
	 * its own dialog naming the app and offering to open the settings page. A toast beside it is a
	 * second voice on the same subject.
	 */
	silent?: boolean;
}

/** One rule: what it recognises, and what it says instead. */
interface Rule {
	match: RegExp;
	explain: Explained;
}

const RULES: Rule[] = [
	{
		/*
		 * The screen-recording refusal, which macOS is already explaining in a dialog of its own.
		 *
		 * Silent rather than restated: the system prompt names the app, says what it wants and opens
		 * the settings page. Anything added beside it is noise on top of a better explanation, and
		 * the English sentence Chromium throws — `Failed to get sources.` — reads as a bug rather
		 * than as a permission that has not been granted.
		 */
		match: /failed to get sources/i,
		explain: { message: "截图需要屏幕录制权限", hint: "在系统设置 › 隐私与安全性 › 屏幕录制里勾选 Lyra，然后重启应用", silent: true },
	},
	{
		match: /\bEACCES\b|\bEPERM\b|operation not permitted/i,
		explain: { message: "没有权限访问这个文件", hint: "检查文件的读写权限，或换一个位置" },
	},
	{
		match: /\bENOENT\b|no such file or directory/i,
		explain: { message: "找不到这个文件或目录", hint: "它可能已经被移动或删除" },
	},
	{
		match: /\bENOSPC\b|no space left/i,
		explain: { message: "磁盘空间不足", hint: "腾出一些空间后再试" },
	},
	{
		match: /\bECONNREFUSED\b/i,
		explain: { message: "连接被拒绝", hint: "对方服务可能没有启动，或者地址和端口不对" },
	},
	{
		match: /\bETIMEDOUT\b|\bESOCKETTIMEDOUT\b|timed? ?out/i,
		explain: { message: "请求超时", hint: "网络或中继不稳定，稍后会自动重试" },
	},
	{
		match: /\bENOTFOUND\b|getaddrinfo/i,
		explain: { message: "域名解析失败", hint: "检查网络连接，或确认地址拼写正确" },
	},
	{
		match: /\bECONNRESET\b|\bEPIPE\b|socket hang up/i,
		explain: { message: "连接被中断", hint: "网络抖动，稍后会自动重试" },
	},
	{
		/*
		 * A provider's own 5xx, usually arriving as a wall of JSON.
		 *
		 * The status code is the only part worth reading at a glance; the rest belongs in the
		 * transcript's error line where it can be expanded, not in a toast.
		 */
		match: /HTTP 5\d\d|internal_server_error|"type"\s*:\s*"server_error"/i,
		explain: { message: "模型服务暂时不可用", hint: "对方返回了服务端错误，稍后会自动重试" },
	},
	{
		match: /HTTP 429|rate.?limit/i,
		explain: { message: "请求太频繁，被限流了", hint: "等一会儿再试，或换一个供应商" },
	},
	{
		match: /HTTP 401|HTTP 403|invalid.?api.?key|unauthorized/i,
		explain: { message: "凭证被拒绝", hint: "检查设置里这个供应商的 API Key 是否正确、是否过期" },
	},
];

/**
 * Restate a failure, or hand it back unchanged.
 *
 * The first matching rule wins, so the list above is ordered from most specific to least.
 */
export function explain(message: string): Explained {
	const text = message.trim();
	for (const rule of RULES) {
		if (rule.match.test(text)) return rule.explain;
	}
	return { message: text };
}
