/**
 * What every video task API adapter shares: one call's context, the shape of a poll, and the small
 * pieces each would otherwise write again — a JSON request that reads a relay's padded answer, a
 * provider's failed task turned into a `Failure`, and frame sizes from a ratio and a resolution.
 */

import { classifyFailure, type Failure, FailureError } from "../ai/failure.ts";
import { fetchWithRetry, RetryBudget } from "../ai/retry.ts";
import type { ImageInput } from "../images/types.ts";
import type { ModelConfig, ProviderConfig } from "../types/provider.ts";
import type { VideoCallOptions, VideoOutput, VideoRequest } from "./types.ts";

export interface WireCall {
	provider: ProviderConfig;
	model: ModelConfig;
	/** Already wrapped by `quotaGuard`: a spent quota leaves as final before any retry waits on it. */
	fetch: typeof globalThis.fetch;
	signal?: AbortSignal;
	retryAttempts?: number;
	onRetry?: VideoCallOptions["onRetry"];
}

export interface Submitted {
	id: string;
	/** What was asked and could not go as asked — a duration this API rounds, a ratio a first frame overrides. */
	adjusted: string[];
}

export type Poll =
	| { state: "pending"; stage: "queued" | "running"; progress?: number }
	| { state: "done"; outputs: VideoOutput[] }
	| { state: "failed"; failure: Failure };

export interface VideoWire {
	submit(call: WireCall, request: VideoRequest): Promise<Submitted>;
	poll(call: WireCall, id: string): Promise<Poll>;
	/** Seconds between polls the provider asks for, or is comfortable with. */
	interval: number;
}

/** A request that answers JSON; non-2xx leaves as a `FailureError` already classified (`fetchWithRetry`). */
export async function requestJson(call: WireCall, url: string, init: { method: "GET" | "POST"; headers?: Record<string, string>; body?: string | FormData }): Promise<Record<string, unknown>> {
	const response = await fetchWithRetry(
		call.fetch,
		url,
		{
			method: init.method,
			headers: { ...(typeof init.body === "string" ? { "content-type": "application/json" } : {}), ...init.headers, ...call.provider.headers },
			body: init.body,
			signal: call.signal,
		},
		{ budget: new RetryBudget(undefined, call.retryAttempts ?? 3), signal: call.signal, onRetry: call.onRetry },
	);
	// Leading blank lines are a relay's keep-alive while it waits on the upstream.
	const text = (await response.text()).trim();
	try {
		const parsed = JSON.parse(text) as unknown;
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
	} catch {
		throw new FailureError(classifyFailure({ from: "stream", message: `The provider answered with something other than JSON: ${text.slice(0, 200)}` }));
	}
}

export const bearer = (call: WireCall): Record<string, string> => ({ authorization: `Bearer ${call.provider.apiKey}` });

export function dataUrl(picture: ImageInput): string {
	return `data:${picture.mimeType};base64,${picture.data}`;
}

/** A field read through objects that may not be there. */
export function read(value: unknown, ...path: (string | number)[]): unknown {
	let at = value;
	for (const key of path) {
		if (at === null || typeof at !== "object") return undefined;
		at = (at as Record<string | number, unknown>)[key];
	}
	return at;
}

export const text = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined);
export const number = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim() && Number.isFinite(Number(value)) ? Number(value) : undefined);

const MODERATION = /moderat|sensitive|safety|content[_\s-]?policy|inappropriate|blocked|filtered|DataInspection|IPInfringement|审核|敏感|违规/i;
const PERMISSION = /permission|forbidden|not[_\s-]?allowed|unauthori[sz]ed|access[_\s-]?denied|无权/i;

/**
 * A task the provider took and then failed, as a `Failure` the card and the model can speak about.
 * Never retried: the task already ran, and the same brief fails the same way — a content refusal
 * most of all, which is said as one so neither the card nor the model calls it a fault.
 */
export function taskFailure(code: string | undefined, message: string | undefined, fallback: string): Failure {
	const said = [code, message].filter(Boolean).join(": ") || fallback;
	const base = classifyFailure({ from: "stream", message: said });
	if (MODERATION.test(said)) return { ...base, kind: "fatal", summary: "内容被服务商拒绝", detail: said, hint: "blocked", retryLimit: 0 };
	if (PERMISSION.test(said)) return { ...base, kind: "fatal", summary: "没有访问权限", detail: said, hint: "check-key", retryLimit: 0 };
	return { ...base, kind: "fatal", summary: base.summary || fallback, detail: said, retryLimit: 0 };
}

/** A task the provider no longer knows: expired, or a relay that restarted and forgot it. */
export function lostTask(detail: string): Failure {
	return { kind: "fatal", summary: "生成任务找不到了", detail, fingerprint: `lost:${detail.slice(0, 40)}`, retryLimit: 0 };
}

const SHORT_SIDE: Record<string, number> = { "480p": 480, "720p": 720, "1080p": 1080 };

/** Width and height for a ratio at a resolution, the short side being the resolution, both even. */
export function frameSize(ratio: { width: number; height: number } | null, resolution: string | undefined): { width: number; height: number } {
	const short = SHORT_SIDE[resolution ?? "720p"] ?? 720;
	const wide = ratio ? ratio.width / ratio.height : 16 / 9;
	const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
	return wide >= 1 ? { width: even(short * wide), height: short } : { width: short, height: even(short / wide) };
}

/** The allowed value nearest to `wanted`, and a sentence when it is not `wanted`. */
export function nearest(wanted: number, allowed: readonly number[], what: string): { value: number; note?: string } {
	const value = allowed.reduce((best, candidate) => (Math.abs(candidate - wanted) < Math.abs(best - wanted) ? candidate : best), allowed[0]);
	return value === wanted ? { value } : { value, note: `${what} ${wanted} is not offered; ${value} was used.` };
}

/** The listed ratio nearest in shape to the one asked for, and a sentence when it is a different one. */
export function nearestRatio(asked: string, ratio: { width: number; height: number }, allowed: readonly string[], who: string): { value: string; note?: string } {
	const wanted = ratio.width / ratio.height;
	const shape = (value: string) => {
		const [w, h] = value.split(":").map(Number);
		return w / h;
	};
	const value = allowed.reduce((best, candidate) => (Math.abs(Math.log(shape(candidate) / wanted)) < Math.abs(Math.log(shape(best) / wanted)) ? candidate : best), allowed[0]);
	return value === asked ? { value } : { value, note: `${who} has no ${asked}; the nearest it offers, ${value}, was used.` };
}
