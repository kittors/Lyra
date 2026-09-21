/**
 * Usage, over IPC.
 *
 * One handler, and it is deliberately dumb: it hands back the whole day-by-model table and lets
 * the page decide what a range or a ranking is. The alternative — a handler per question — would
 * put the arithmetic on the far side of a process boundary where it cannot be tested without
 * booting Electron.
 *
 * In flight at most once. The first scan of a large home takes a couple of seconds, and opening
 * the page twice while it runs should wait for the answer rather than start a second read of the
 * same 264MB.
 *
 * 另外两条是关于这些日志本身的：它们占了多少地方，以及怎么删掉一段时间的。删除放在这一组而不是
 * `sessions` 那一组，因为按时间成片地删是从「这一页上的数字」出发的动作，而不是从某一条对话出发
 * 的动作——见 `session-cleanup.ts` 开头那段。
 */

import { ipcMain } from "electron";
import type { SessionStorage } from "@lyra/core";
import { settings } from "../app-settings.ts";
import { sessions } from "../session-hub.ts";
import { clearSessions, storageUse, type ClearRange } from "../session-cleanup.ts";
import { scanUsage, type UsageScan } from "../usage-scan.ts";

let inFlight: Promise<UsageScan> | null = null;

export interface UsageIpcDeps {
	store(): SessionStorage;
}

export function registerUsageIpc({ store: readStore }: UsageIpcDeps): void {
	ipcMain.handle("usage:scan", async () => {
		if (!inFlight) {
			inFlight = scanUsage(undefined, settings().providers).finally(() => {
				inFlight = null;
			});
		}
		return inFlight;
	});

	ipcMain.handle("usage:storage", () => storageUse(readStore()));

	ipcMain.handle("usage:clear", async (_event, range: ClearRange) => {
		const result = await clearSessions(readStore(), range, (id) => sessions.get(id)?.running ?? false);
		/*
		 * 丢掉在飞的那次扫描。
		 *
		 * 磁盘上的缓存不用管：汇总走的是 `logPaths` 实际列出来的文件，删掉的那些不在里面，它们在
		 * 缓存里的桶既不会被加进总数，也会在下一次写缓存时自然消失。
		 *
		 * 要管的是这个内存里的 promise：它可能在删除**开始之前**就已经出发，读的是那份还完整的
		 * 文件列表。留着它，删完之后点刷新拿回的是删除前的数字——看起来像什么都没发生。
		 */
		inFlight = null;
		return result;
	});
}
