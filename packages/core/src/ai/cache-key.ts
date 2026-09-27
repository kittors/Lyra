/**
 * 让同一段对话的请求落在同一个地方——前缀缓存才接得上。
 *
 * 前缀缓存只在「这台机器上一次见过这段前缀」时才命中。OpenAI 按「前缀 + `prompt_cache_key`」把
 * 请求路由到机器；中转站（sub2api 之类）的号池按同一类信号选上游账号——它的
 * `GenerateSessionHash` 先看 `session_id` 头、`conversation_id` 头、请求体里的 `prompt_cache_key`，
 * 三样都没有就随机分（Wei-Shaw/sub2api#1421）。随机分到一个没见过这段前缀的账号，就是一次全额的
 * 冷启动。
 *
 * 2026-09-26 的真实会话把这件事量得很清楚：四个审查子代理，每个开头三到五次请求缓存全部是 0，
 * 中间还隔三岔五掉回 0（号池里还有没见过它的账号），整个会话只有 76%。而我们的请求里这三样一样
 * 都没有。
 *
 * 两处都放：
 *
 *   - 请求体的 `prompt_cache_key`：OpenAI 官方字段，Responses 和 Chat Completions 都认，
 *     OpenRouter、sub2api 也认。严格校验请求体的兼容实现会拒一个不认识的字段（Mistral 的 422
 *     「Extra inputs are not permitted」就会点名它），撞上一次就记住，以后不发——见
 *     `request-params-compat.ts` 的 `cache-key`。
 *   - `session_id` 头：Codex CLI 发的就是它，sub2api 的粘性会话先看它。头不会被拒，不认识的头
 *     各家都是忽略。放在 `provider.headers` 前面，用户自己配了同名头的，以他的为准。
 *
 * 键本身由调用方给：主会话是会话 id，子代理是它自己的登记 id。同一个子代理从头到尾（包括续跑）
 * 是同一个键，所以它的每一轮都落在同一处；兄弟子代理各用各的，不会全挤到一个账号的并发上。
 */

import type { DroppedParam } from "./request-params-compat.ts";

/** 请求体里的那一项；这个端点撞过一次就不再发。 */
export function cacheKeyFields(key: string | undefined, dropped: ReadonlySet<DroppedParam>): Record<string, string> {
	return key && !dropped.has("cache-key") ? { prompt_cache_key: key } : {};
}

/** 请求头里的那一项。 */
export function cacheKeyHeaders(key: string | undefined): Record<string, string> {
	return key ? { session_id: key } : {};
}
