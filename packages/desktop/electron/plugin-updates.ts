/**
 * 装过的插件、MCP 服务和技能集，市场上有了新版就换上——或者至少说一声。
 *
 * 从前「可更新」只在市场页的卡片上算：人不打开那一页，就永远不知道自己用的是哪一版；打开了，也
 * 得一张张点。市场那头每天从上游重建一次，这头却要等人想起来——两头的「实时」差了一个人。
 *
 * 现在主进程自己隔一阵读一次索引（和市场页共用 `plugin-index.ts` 的缓存），跟账本（`installs.json`）
 * 对一遍：
 *   - 自动更新开着（缺省就是开），落后的逐个换成新版，换的方式和人点「更新」完全一样——先下到暂存
 *     目录、验过再换，失败了原来那份不动；
 *   - 关着，就只把「谁落后了」告诉窗口，侧栏和两个插件页据此画「可更新」。
 *
 * 逐个、排队，不并排：一次更新会停掉这个包正在跑的 MCP 服务，并排跑十个就是十个服务同时断开。
 */

import { access, readdir } from "node:fs/promises";
import { join } from "node:path";

import { bundleRoot, installEntry, isOutdated, readInstalls, type InstallRecord, type RegistryEntry, type Settings } from "@lyra/core";
import { readRegistry, withBundle } from "./plugin-index.ts";
import { releaseBundle, settingsAfterInstall } from "./ipc/plugin-actions.ts";
import { sessions } from "./session-hub.ts";
import { eachAppWindow } from "./window.ts";
import type { PluginUpdateState } from "./ipc-types.ts";

/** 启动后多久第一次看：窗口先起来、会话先恢复，这件事不急于那几秒。 */
const FIRST_CHECK_MS = 40_000;
/** 之后多久看一次。平台那头也是隔一阵才从上游重建，比它勤快没有意义。 */
const CHECK_EVERY_MS = 30 * 60_000;
/** 定时检查时，索引多旧就重新抓一次——比市场页的缓存短，免得定时器一直读窗口半小时前抓的那份。 */
const CHECK_MAX_AGE_MS = 5 * 60_000;

export interface PluginUpdatesDeps {
	settings(): Settings;
	saveSettings(next: Settings): Promise<unknown>;
}

export interface PluginUpdates {
	state(): PluginUpdateState;
	/** 重新对一遍账（`force` 时索引也重新抓），自动更新开着就顺手更新。 */
	check(force?: boolean): Promise<PluginUpdateState>;
	/** 更新这几个（缺省：全部落后的），不看自动更新开没开——这是人点的。 */
	update(ids?: string[]): Promise<PluginUpdateState>;
	/** 装、卸、更新过之后：只按手上的索引重新对账，不抓网络；`changed` 时记一次磁盘变化。 */
	recount(changed?: boolean): Promise<PluginUpdateState>;
	stop(): void;
}

interface Offer {
	entry: RegistryEntry;
	from: string;
}

export function startPluginUpdates(deps: PluginUpdatesDeps): PluginUpdates {
	let current: PluginUpdateState = { outdated: [], checkedAt: null, auto: autoOf(deps.settings()), updating: [], failed: [], revision: 0 };
	let offers: Offer[] = [];
	let running: Promise<PluginUpdateState> | null = null;
	let stopped = false;

	const announce = (next: PluginUpdateState) => {
		current = next;
		eachAppWindow((win) => win.webContents.send("plugins:changed", next));
		return next;
	};

	const read = async (force: boolean, maxAge?: number): Promise<void> => {
		const settings = deps.settings();
		const urls = [...new Set([...settings.pluginRegistries, ...settings.skillRegistries])];
		const answers = await Promise.all(urls.map((url) => readRegistry(url, force, maxAge)));
		offers = answers.flatMap((answer) => (answer.ok ? answer.registry.entries.map((entry) => ({ entry, from: answer.registry.name })) : []));
	};

	/** 账本上有、磁盘上也还在、市场上又不一样了的那些。 */
	const behind = async (): Promise<{ offer: Offer; record: InstallRecord }[]> => {
		const installs = await readInstalls();
		const found: { offer: Offer; record: InstallRecord }[] = [];
		for (const [id, record] of Object.entries(installs)) {
			// 同一个 id 两个市场都有时，认装它的那一个。
			const candidates = offers.filter((offer) => offer.entry.id === id);
			const offer = candidates.find((candidate) => candidate.from === record.from) ?? candidates[0];
			if (!offer || !isOutdated(record, offer.entry)) continue;
			if (!(await onDisk(id, record))) continue;
			found.push({ offer, record });
		}
		return found;
	};

	const tally = async (patch: Partial<PluginUpdateState> = {}): Promise<PluginUpdateState> => {
		const lagging = await behind();
		return {
			...current,
			auto: autoOf(deps.settings()),
			outdated: lagging.map(({ offer }) => ({ id: offer.entry.id, name: offer.entry.name, version: offer.entry.version, from: offer.from })),
			...patch,
		};
	};

	const apply = async (ids: string[] | null): Promise<PluginUpdateState> => {
		const lagging = (await behind()).filter(({ offer }) => !ids || ids.includes(offer.entry.id));
		const failed: PluginUpdateState["failed"] = current.failed.filter((failure) => !lagging.some(({ offer }) => offer.entry.id === failure.id));
		for (const { offer } of lagging) {
			if (stopped) break;
			const { entry, from } = offer;
			announce({ ...current, updating: [...current.updating, entry.id] });
			try {
				await withBundle(entry.id, async () => {
					const installed = await installEntry(entry, from, true, { beforeReplace: () => releaseBundle(sessions.values(), entry.id) });
					const next = settingsAfterInstall(deps.settings(), entry.id, installed);
					if (next) await deps.saveSettings(next);
				});
				current = { ...current, revision: current.revision + 1 };
			} catch (cause) {
				failed.push({ id: entry.id, name: entry.name, message: cause instanceof Error ? cause.message : String(cause) });
			}
			announce({ ...current, updating: current.updating.filter((id) => id !== entry.id) });
		}
		return announce(await tally({ failed }));
	};

	/** 一次只跑一轮：定时器、人点的「全部更新」、装完之后的对账，排成一队。 */
	const serial = (work: () => Promise<PluginUpdateState>): Promise<PluginUpdateState> => {
		const run = (running ?? Promise.resolve(current)).catch(() => current).then(work);
		running = run.finally(() => {
			if (running === run) running = null;
		});
		return run;
	};

	const check = (force = false) =>
		serial(async () => {
			await read(force, force ? undefined : CHECK_MAX_AGE_MS);
			const checkedAt = Date.now();
			if (autoOf(deps.settings())) {
				current = { ...current, checkedAt };
				return apply(null);
			}
			return announce(await tally({ checkedAt }));
		});

	const first = setTimeout(() => void check().catch(() => undefined), FIRST_CHECK_MS);
	const every = setInterval(() => void check().catch(() => undefined), CHECK_EVERY_MS);

	return {
		state: () => current,
		check,
		/*
		 * Both re-read through the shared cache rather than trusting `offers`: the market page may
		 * have just fetched a newer index (刷新), and an update that compared against the copy this
		 * timer read half an hour ago would find nothing to do. A cache hit costs no network.
		 */
		update: (ids) =>
			serial(async () => {
				await read(false);
				return apply(ids ?? null);
			}),
		recount: (changed = false) =>
			serial(async () => {
				if (changed) current = { ...current, revision: current.revision + 1 };
				await read(false);
				return announce(await tally());
			}),
		stop: () => {
			stopped = true;
			clearTimeout(first);
			clearInterval(every);
		},
	};
}

/** 缺省是开——`undefined` 是「没人动过」，不是「关」。 */
function autoOf(settings: Settings): boolean {
	return settings.autoUpdatePlugins !== false;
}

/**
 * 这个 id 装下的东西还在不在磁盘上。
 *
 * 账本只记「装过」，不记「还在」：人手动删掉的目录，账本那一行还留着。拿一行对不上实物的账去
 * 「更新」，等于把人删掉的东西装回来。
 */
async function onDisk(id: string, record: InstallRecord): Promise<boolean> {
	const exists = (path: string) =>
		access(path).then(
			() => true,
			() => false,
		);
	if ((await exists(join(bundleRoot("plugin"), id))) || (await exists(join(bundleRoot("mcp"), id)))) return true;
	if (record.skills) {
		for (const skill of record.skills) if (await exists(join(bundleRoot("skill"), skill))) return true;
		return false;
	}
	// 账本还不记目录名那会儿装的技能集：只剩 `<id>-` 这个前缀可认。
	return (await readdir(bundleRoot("skill")).catch((): string[] => [])).some((name) => name.startsWith(`${id}-`));
}
