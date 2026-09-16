/**
 * Noticing that a turn has stopped getting anywhere.
 *
 * A model that cannot work something out sometimes stops varying its attempts: the same probe,
 * with the same arguments, returning the same answer, over and over. Every round looks like
 * progress from inside the loop — a tool was called, a result came back — and the run happily
 * spends hours this way.
 *
 * The signal is not "the same tool twice", which is ordinary (read a file, read it again after an
 * edit). It is the same tool, the same arguments, *and* the same result: nothing about the world
 * changed, so asking again cannot tell it anything new.
 *
 * Two thresholds, because the two responses are different. The first says so — a model told
 * plainly that it is repeating itself usually changes approach. The second stops the turn, because
 * a model that has been told and carried on regardless is not going to stop on its own, and the
 * person who asked deserves to hear about it rather than come back to a spinner.
 */

import { createHash } from "node:crypto";
import type { Message } from "../types.ts";

/** Say something. */
export const REPEAT_WARN = 3;
/**
 * 纠正了这么多次还在重复，就不用再试了。
 *
 * 从 6 放宽到 10，因为第 3 次起的每一次都已经便宜得多：那时候不再把一模一样的结果重贴一遍，只回一句
 * 「这是第 N 次」（见 `agent/loop.ts` 里用 `repeats` 的那一段）。省下的空间换成多给七次纠正的机会。
 *
 * 但**上限必须存在**。纠正过七次还在问同一个问题，继续跑就只是烧钱了——项目第一原则的第二条
 * （更快更省）在这里生效，它不和第一条冲突：一个已经证明自己走不下去的回合，停下来不会让任何需求
 * 少完成一件。
 */
export const REPEAT_STOP = 10;
// Zero stops in the 266-session audit on 2026-09-16: this is an exact-repeat backstop,
// not a general detector of unproductive work. Do not lower it to catch unrelated calls.

/**
 * How many times the same *question* can be asked, however the paging is dressed up.
 *
 * Deliberately far above `REPEAT_WARN`. This line watches a weaker signal — same tool, same
 * arguments apart from where-in-the-results, with no requirement that the answer be unchanged —
 * and a weaker signal earns a later threshold. Legitimate paging exists: reading a long file a
 * screenful at a time is a dozen calls that differ only in `offset`, and every one of them is
 * work.
 *
 * Calibrated against the failure it exists for. One session paged a single query 37 times, another
 * 33, another 31, while the exact-fingerprint watch stayed silent the whole way because both the
 * arguments and the answers kept changing. Twelve is comfortably past honest paging and far short
 * of thirty.
 */
export const INTENT_WARN = 12;

/**
 * Consecutive screenshot-slicing / pixel-measuring probes, regardless of the exact script.
 *
 * Exact fingerprints miss this: each round writes a new Python file or changes crop coordinates,
 * so the call looks new and a successful `write` used to clear the other tables. The signal is
 * the *activity* — generating band_*.png, reading those slices, histogramming pixels — not the
 * arguments. Warn, then stop if the correction is ignored, same order as exact repeats.
 */
export const PROBE_WARN = 5;
export const PROBE_STOP = 10;

/*
 * 这里一度有一条「连着 60 轮一个字都没对人说过就停」，2026-09-16 拆掉了。留着这段是因为它错得很
 * 有代表性，而下一个想加同类规则的人会先读到这里。
 *
 * 它上线八小时就掐断了一次正常的发版：那个会话 63 次工具调用、63 个互不相同的指纹、改了 6 个文件，
 * 唯一的「异常」是 60 轮一个字没写——而它用的 gemini-3.8-flash-high 本来就只调工具不说话，攒到最后
 * 才总结。我标定阈值时拿的对照是 deepseek-flash，那个模型每轮都写几句。**我用一个模型的习惯，定了
 * 一条对所有模型生效的硬停规则。**
 *
 * 换个信号也不行。后来在全部 98 个会话上量过「既没说话、又没改动任何东西、拿到的还全是见过的语义
 * 指纹」这种「空转轮」：那个烧掉 $15 的病态会话最长只连续空转 8 轮，而一个完全正常的会话连续空转
 * 过 36 轮，另一个正常跑到了 2376 轮。**打转和埋头干活，在这些可观测量上分不开。**
 *
 * 所以这里不再试图自动判断「它是不是在打转」。判错一次的代价是掐断真实工作，而这个判断没有一个
 * 可靠的信号支持它。
 *
 * 也别改成「花到多少钱就提醒一下」——那条也试过并且拆掉了：人要的是任务跑完，不是在对话里被念账单，
 * 花销该待在设置页里。这个循环唯一该做的事是把活干完。
 */

/**
 * Argument names that say *where in the results* rather than *what is being asked*.
 *
 * Two calls differing only in these are the same question with the bookmark moved. The exact
 * fingerprint treats them as unrelated — which is correct for deciding whether anything was
 * learned, and exactly wrong for noticing a model walking a result set it will never reach the end
 * of.
 */
const PAGING_KEYS = new Set(["offset", "limit", "page", "cursor", "after", "before", "start", "skip", "count"]);

/** 一轮观察下来的几个结论。 */
export interface RepeatRound {
	/** 这一轮里重复得最凶的那一个，已经是第几次。 */
	worst: number;
	/** 头一回够到警告线的那个工具名——够到过就不再报第二次。 */
	warn: string | null;
	/**
	 * 这次警告是哪条线触发的，决定该对模型说哪句话。
	 *
	 * 「同样的参数」对一个每次都在改 offset 的调用来说是假的，而一句和眼前情况对不上的提示，
	 * 模型有充分理由忽略它。
	 */
	kind?: "exact" | "intent" | "probe";
	/**
	 * 这一轮里每个调用各是第几次问出同一个问题（同工具、同参数、同结果），和 `calls` 同序。
	 *
	 * 给调用方用来**纠正**，而不是用来停：问到第三次时，把那份一模一样的结果再贴一遍是纯粹的浪费
	 * ——真实日志里同一段 `read` 贴了 5 遍、同一个 `skill` 注入了 4 次（每次 5,625 token）。换成
	 * 一句「这是第 N 次，结果没变」，模型拿到的信息更明确，账单也不用再付一遍。
	 */
	repeats: number[];
}

export class RepetitionWatch {
	private readonly counts = new Map<string, number>();
	/** Fingerprints already warned about, so one loop produces one warning. */
	private readonly warned = new Set<string>();
	/**
	 * Same tool, same question, any page — counted separately from the exact fingerprints.
	 *
	 * Never consulted by `exhausted`. This line cannot tell a model paging uselessly from one
	 * paging through something real, so it says so once and leaves the decision where it belongs.
	 * Ending a turn on a signal this soft would eventually cut off a legitimate read of a long
	 * file, and a watchdog that does that gets turned off.
	 */
	private readonly intents = new Map<string, number>();
	/** Screenshot-slicing / pixel-measure family. Survives writing a new probe script. */
	private probes = 0;
	private probeWarned = false;
	/**
	 * Record what a round did, and answer both questions it raises in one pass.
	 *
	 * Counting per fingerprint rather than consecutively: a model alternating between two useless
	 * probes is as stuck as one repeating a single probe, and consecutive counting would reset on
	 * every alternation and never notice.
	 *
	 * One pass because there is one set of fingerprints. This was two methods, and the caller ran
	 * both over the same round — so every key was built twice, and a key is the whole argument
	 * object serialised plus 400 characters of the result. The second pass could not disagree with
	 * the first; it only cost.
	 */
	observe(calls: { name: string; arguments: unknown }[], results: Message[]): RepeatRound {
		if (calls.some((call, index) => isWorkspaceProgress(call.name, call.arguments, results[index]))) {
			// A successful workspace mutation invalidates observations made before that change.
			// Writing another measurement script is not progress — that is the loop this watch is for.
			this.counts.clear();
			this.intents.clear();
			this.warned.clear();
			this.probes = 0;
			this.probeWarned = false;
		}
		let worst = 0;
		let warn: string | null = null;
		let kind: "exact" | "intent" | "probe" | undefined;
		const repeats: number[] = [];
		for (const [index, call] of calls.entries()) {
			const key = `${call.name} ${stable(call.arguments)} ${sample(results[index])}`;
			const seen = (this.counts.get(key) ?? 0) + 1;
			this.counts.set(key, seen);
			repeats[index] = seen;
			if (seen > worst) worst = seen;
			// 一个指纹只说一次：说过还照做的，下一道线是收摊，不是再说一遍。
			if (warn === null && seen >= REPEAT_WARN && seen < REPEAT_STOP && !this.warned.has(key)) {
				this.warned.add(key);
				warn = call.name;
				kind = "exact";
			}
		}

		/*
		 * The second pass, and only when the first found nothing.
		 *
		 * An exact repeat is the stronger, more actionable finding — it has already been counted and
		 * is about to be reported. Reporting both in one round would spend two notices on one stuck
		 * turn and leave the model deciding which applies.
		 */
		if (warn === null) {
			for (const call of calls) {
				const key = intentOf(call.name, call.arguments);
				const seen = (this.intents.get(key) ?? 0) + 1;
				this.intents.set(key, seen);
				if (warn === null && seen >= INTENT_WARN && !this.warned.has(key)) {
					this.warned.add(key);
					warn = call.name;
					kind = "intent";
				}
			}
		} else {
			// 计数不能因为这一轮报的是精确重复就停：语义线是跨轮累计的。
			for (const call of calls) {
				const key = intentOf(call.name, call.arguments);
				this.intents.set(key, (this.intents.get(key) ?? 0) + 1);
			}
		}

		for (const call of calls) {
			if (!isProbe(call.name, call.arguments)) continue;
			this.probes += 1;
			if (warn === null && this.probes >= PROBE_WARN && !this.probeWarned) {
				this.probeWarned = true;
				warn = call.name;
				kind = "probe";
			}
		}

		return { worst, warn, kind, repeats };
	}

	/**
	 * 纠正过还在重复——这一轮可以收了。
	 *
	 * **顺序是先纠正、后停，不是直接停。** 从第三次起，调用方就不再把那份一字不差的结果重贴给模型，
	 * 而是回一句「这是第 N 次，它不会因为你再问一次就改变」；问到第十次，说明那句话说了七遍也没用。
	 *
	 * 早先这里直接在第六次结束这一轮，中间没有任何纠正——停下来既没告诉模型该怎么办，也没把等结果的
	 * 人放出来，只是把一次卡住变成一次中断。
	 *
	 * 只认这一条：同一个工具、同样的参数、**同样的结果**。答案一变指纹就变，计数从头开始，所以一个
	 * 真在推进的回合永远走不到这里。
	 */
	exhausted(): boolean {
		for (const seen of this.counts.values()) if (seen >= REPEAT_STOP) return true;
		return this.probes >= PROBE_STOP;
	}
}

/**
 * The same call with every paging argument stripped: what was asked, not which page of it.
 *
 * Non-object arguments fall through to the plain fingerprint — there is no page to strip from a
 * bare string, and treating one as strippable would collapse unrelated calls together.
 */
function intentOf(name: string, args: unknown): string {
	if (args === null || typeof args !== "object" || Array.isArray(args)) return `${name} ${stable(args)}`;
	const kept = Object.entries(args as Record<string, unknown>).filter(([key]) => !PAGING_KEYS.has(key.toLowerCase()));
	return `${name} ${stable(Object.fromEntries(kept))}`;
}

/** Key order must not decide whether two identical calls look identical. */
function stable(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "";
	if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
	const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
	return `{${entries.map(([k, v]) => `${k}:${stable(v)}`).join(",")}}`;
}

const IMAGE_FILE = /\.(?:png|jpe?g|webp|gif)\b/i;
const MEASURE = /numpy|PIL\.|Image\.open|cv2\.|histogram|non[-_]?white|getBoundingClientRect|band_\d+|row_inspect|box_line|pixel.?count|screencast/i;
const SLICE_NAME = /(?:^|\/)(?:band_\d+|row_inspect|box_line|icon_\d+)[^/]*\.(?:png|jpe?g|webp)$/i;

function commandOf(args: unknown): string {
	if (args === null || typeof args !== "object" || !("command" in args)) return "";
	return String((args as { command: unknown }).command);
}

function pathOf(args: unknown): string {
	if (args === null || typeof args !== "object") return "";
	const record = args as { path?: unknown; file_path?: unknown; contents?: unknown };
	if (typeof record.path === "string") return record.path;
	if (typeof record.file_path === "string") return record.file_path;
	return "";
}

function contentsOf(args: unknown): string {
	if (args === null || typeof args !== "object") return "";
	const record = args as { content?: unknown; contents?: unknown };
	if (typeof record.content === "string") return record.content;
	if (typeof record.contents === "string") return record.contents;
	return "";
}

/** Same activity the 2130 loop used: cut images, read the slices, measure pixels. */
function isProbe(name: string, args: unknown): boolean {
	if (name === "bash") {
		const command = commandOf(args);
		return IMAGE_FILE.test(command) && MEASURE.test(command);
	}
	if (name === "read") return SLICE_NAME.test(pathOf(args));
	if (name === "write") {
		const path = pathOf(args);
		const contents = contentsOf(args);
		return SLICE_NAME.test(path) || (path.endsWith(".py") && IMAGE_FILE.test(contents) && MEASURE.test(contents));
	}
	return false;
}

function isWorkspaceProgress(name: string, args: unknown, result: Message | undefined): boolean {
	if ((name !== "edit" && name !== "write") || result?.role !== "toolResult" || result.isError) return false;
	return !isProbe(name, args);
}

function sample(result: Message | undefined): string {
	if (!result || result.role !== "toolResult") return "";
	return createHash("sha256").update(JSON.stringify({ content: result.content, isError: result.isError })).digest("hex");
}
