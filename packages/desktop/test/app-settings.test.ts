/**
 * 保存设置这件事，失败起来是什么样子。
 *
 * 监听器跑在写盘之后：改动已经落地、已经生效了。让其中一个的异常冒出去，调用方拿到的是一个
 * rejected promise，于是窗口回滚显示旧值，而磁盘上是新值——一次成功的保存看起来像失败，
 * 两边还对不上。
 *
 * 撞到它的那次是同步服务：端口被另一个进程占着，`startSync` 抛了 EADDRINUSE，于是在设置页
 * **改任何一项**都会失败。改主题、换模型、开个开关，全都一样，而屏幕上只有那个控件默默弹回去。
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { DEFAULT_SETTINGS, type Settings } from "@lyra/core";
import { applySettings, onSettingsChanged, settings } from "../electron/app-settings.ts";

let home: string;

before(async () => {
	home = await mkdtemp(join(tmpdir(), "ly-appset-"));
	process.env.LYRA_HOME = home;
});

after(async () => {
	delete process.env.LYRA_HOME;
	await rm(home, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
});

test("一个监听器抛错，保存仍然算数", async () => {
	const heard: string[] = [];
	const offBad = onSettingsChanged(async () => {
		throw new Error("listen EADDRINUSE: address already in use 0.0.0.0:4517");
	});
	const offGood = onSettingsChanged(async (next) => void heard.push(next.defaultModelId ?? ""));

	try {
		const next = { ...DEFAULT_SETTINGS, defaultModelId: "p/新的" } as Settings;
		const back = await applySettings(next);

		assert.equal(back.defaultModelId, "p/新的", "调用方要拿到保存后的设置，而不是一个异常");
		assert.equal(settings().defaultModelId, "p/新的", "内存里的那份也是新的");
		assert.deepEqual(heard, ["p/新的"], "坏掉的那个不该挡住后面的");

		const onDisk = JSON.parse(await readFile(join(home, "settings.json"), "utf8")) as Settings;
		assert.equal(onDisk.defaultModelId, "p/新的", "磁盘上也是新的——这本来就是它失败得最难看的地方");
	} finally {
		offBad();
		offGood();
	}
});
