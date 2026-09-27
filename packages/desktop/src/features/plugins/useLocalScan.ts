/**
 * 这台机器上装了什么：一次扫盘，大家共用。
 *
 * 从前设置 › 插件一打开就是三趟 `plugins:list`——标签上的数字一趟、插件列表一趟、技能列表一趟，
 * 市场页再来一趟。每一趟都要在主进程里走遍三个目录、读每一份 SKILL.md，而它们问的是同一件事，
 * 在同一个瞬间。
 *
 * 这里把同一时刻的几次问合成一次：键相同、离上一次不到一眼的工夫，就拿同一个答案。「一眼的工夫」
 * 之外照旧重扫——人往目录里拖了一个包再切回来，看到的应该是拖完之后的样子，而不是缓存。
 */

import { useEffect, useState } from "react";

import { useApp } from "../../store/index.ts";
import { bridge } from "../../services/index.ts";

export type LocalScan = Awaited<ReturnType<typeof bridge.plugins.list>>;

/** 同一个键的答案，多久之内算同一次问。 */
const SHARE_MS = 1500;

const recent = new Map<string, { at: number; answer: Promise<LocalScan> }>();
/** 每个目录最近一次的答案：再进来时先画它，不从一片空白开始。 */
const last = new Map<string, LocalScan>();

/** 一次扫盘，或者一次正在进行的、同一个键的扫盘。 */
function scanLocal(cwd: string, key: string): Promise<LocalScan> {
	const id = `${cwd}\u0000${key}`;
	const hit = recent.get(id);
	if (hit && Date.now() - hit.at < SHARE_MS) return hit.answer;
	const answer = bridge.plugins.list(cwd).then((scan) => {
		last.set(cwd, scan);
		return scan;
	});
	recent.set(id, { at: Date.now(), answer });
	// 失败的那一次不留：下一个来问的人应该自己再试一遍，而不是拿到同一个失败。
	answer.catch(() => recent.delete(id));
	for (const [other, entry] of recent) if (Date.now() - entry.at > SHARE_MS * 4) recent.delete(other);
	return answer;
}

/**
 * 当前项目下扫出来的插件、MCP 包、技能和账本。
 *
 * `fresh` 说的是手上这份是不是为当前这个目录扫的：换了项目，旧的那份先留着画，但不当真。
 */
export function useLocalScan(): { scan: LocalScan | null; cwd: string; fresh: boolean } {
	const cwd = useApp((s) => s.workspace?.path ?? "");
	const nonce = useApp((s) => s.extensionsNonce);
	// 开关一个插件会改变扫出来的 `enabled`，所以它也在键里。
	const disabledKey = useApp((s) => (s.settings?.disabledPlugins ?? []).join("|"));
	const [held, setHeld] = useState<{ cwd: string; scan: LocalScan } | null>(() => {
		const seen = last.get(cwd);
		return seen ? { cwd, scan: seen } : null;
	});

	useEffect(() => {
		let alive = true;
		void scanLocal(cwd, `${nonce}|${disabledKey}`)
			.then((scan) => alive && setHeld({ cwd, scan }))
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, [cwd, nonce, disabledKey]);

	return { scan: held?.scan ?? null, cwd, fresh: held?.cwd === cwd };
}
