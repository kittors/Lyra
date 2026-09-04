/**
 * 谁来跑后台抽取，什么时候跑，以及跑之前要不要先问。
 *
 * `memory-extract.ts` 那份代码写完之后，很长一段时间里**没有任何东西调用它**——它自己的注释
 * 写着「同意与调度归调用方」，而那个调用方一直没有写。结果是：抽取出来的 `MEMORY.md` 会被读
 * 进提示词（那一半是接好的），而写它的那一半从不运行，所以那个文件永远是空的。整套东西看起来
 * 完整、测试全绿、一个字节也没产生过。
 *
 * 这个文件就是那个缺掉的一半，三件事：
 *
 *   **同意。** `undefined` 是「还没问过」，`false` 是「问过，不要」——两者必须分开，否则要么
 *   永远不问，要么问过还问。
 *
 *   **节流。** 一次抽取要读几十个会话，问一次模型。每小时跑一遍不会得到更好的记忆，只会得到
 *   更高的账单。
 *
 *   **模型。** `@fast`，跟计划一致：读几十段转录、输出一个列表，便宜比聪明要紧得多。
 */

import { join } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import type { Settings } from "../config/settings.ts";
import { resolveModelRef } from "../config/model-roles.ts";
import { resolveModel } from "../config/settings.ts";
import type { streamAssistant } from "../ai/index.ts";
import { streamAssistant as realStream } from "../ai/index.ts";
import { lyraHome, projectIdFor } from "../session/store.ts";
import type { SessionStorage } from "../session/storage.ts";
import type { ModelConfig, ProviderConfig } from "../types.ts";
import { extractMemory, findCandidates, type ExtractionResult } from "./memory-extract.ts";
import { projectMemoryDir } from "./project-memory.ts";

/**
 * 两次抽取之间至少隔多久。
 *
 * 候选会话本身就要「至少 12 小时没动过」，所以一天跑一次已经覆盖了每一个会变成候选的会话。
 * 更勤只会重复读同样那几十段转录。
 */
export const PASS_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** 抽取该不该跑，以及为什么不跑。 */
export type PassVerdict = { run: true } | { run: false; reason: "never-asked" | "declined" | "too-soon" | "no-model" };

/**
 * 问一次这个项目现在该不该跑。
 *
 * `never-asked` 不是「不跑」的同义词——它是**去问**的信号。分成两个值而不是一个布尔，是因为
 * 「问过、拒绝了」和「还没问过」对界面来说是完全相反的两件事。
 */
export function shouldRunPass(settings: Settings, lastRunAt: number | null, now = Date.now()): PassVerdict {
	if (settings.memoryExtraction === undefined) return { run: false, reason: "never-asked" };
	if (settings.memoryExtraction === false) return { run: false, reason: "declined" };
	if (lastRunAt !== null && now - lastRunAt < PASS_INTERVAL_MS) return { run: false, reason: "too-soon" };
	/*
	 * 没有可用模型不是「跑失败」，是根本没得跑。单独一个原因，是因为一个还没配供应商的窗口
	 * 会每隔五分钟安静地失败一次，而屏幕上没有任何东西说这件事。
	 */
	if (!passModel(settings)) return { run: false, reason: "no-model" };
	return { run: true };
}

/**
 * 抽取用哪个模型：`@fast`，退回会话默认。
 *
 * 这正是那个角色存在的理由——读几十段转录、输出一个列表，便宜比聪明要紧得多。
 */
function passModel(settings: Settings): { provider: ProviderConfig; model: ModelConfig } | null {
	const fallback = resolveModel(settings, settings.defaultModelId ?? "");
	if (fallback) return resolveModelRef(settings, "@fast", fallback);
	const fast = settings.modelRoles?.fast;
	return fast ? resolveModel(settings, fast) : null;
}

/** 上次跑完的时间戳，没跑过就是 null。 */
export async function lastPassAt(cwd: string): Promise<number | null> {
	const raw = await readFile(join(projectMemoryDir(cwd), ".last-pass"), "utf8").catch(() => null);
	const at = raw === null ? Number.NaN : Number.parseInt(raw.trim(), 10);
	return Number.isFinite(at) ? at : null;
}

async function markPass(cwd: string, at: number): Promise<void> {
	const dir = projectMemoryDir(cwd);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, ".last-pass"), String(at), "utf8");
}

export interface PassOptions {
	cwd: string;
	settings: Settings;
	storage: SessionStorage;
	/** 覆盖发请求的方式，跟会话里那个 `streamFn` 同一个用途。 */
	stream?: typeof streamAssistant;
	/** 抽取候选的年龄判断基准，只有测试会传。 */
	now?: number;
	signal?: AbortSignal;
}

/**
 * 跑一遍，或者说清楚为什么没跑。
 *
 * **时间戳在跑之前就写下**。一次没找到候选、或者模型没返回的空跑，跟一次成功的抽取花掉的是
 * 同一批工作（读几十个会话文件）；不记下来，一个没有候选的项目会在每一次空闲时重读一遍全部
 * 转录，永远。
 */
export async function runMemoryPass(options: PassOptions): Promise<ExtractionResult> {
	const now = options.now ?? Date.now();
	const verdict = shouldRunPass(options.settings, await lastPassAt(options.cwd), now);
	if (!verdict.run) return { memory: "", sessions: 0, skipped: verdict.reason };

	const resolved = passModel(options.settings);
	if (!resolved) return { memory: "", sessions: 0, skipped: "no-model" };

	const projectId = projectIdFor(options.cwd);
	const candidates = await findCandidates(
		join(lyraHome(), "sessions"),
		projectId,
		(id) => options.storage.messages(projectId, id),
		now,
	);

	await markPass(options.cwd, now);
	if (candidates.length === 0) return { memory: "", sessions: 0, skipped: "没有符合条件的会话" };

	return extractMemory({
		cwd: options.cwd,
		candidates,
		provider: resolved.provider,
		model: resolved.model,
		stream: options.stream ?? realStream,
		signal: options.signal,
	});
}
