/**
 * 后台抽取：从这个项目的历史会话里读出还用得上的东西。
 *
 * 两个方法，而且**都不自己决定要不要跑**。`status` 只回答该不该跑、为什么不跑；跑不跑由窗口
 * 决定，因为「空闲」是界面才知道的事——主进程看不出一个人是在读代码还是去吃饭了。
 *
 * `status` 的 `never-asked` 是这里唯一需要留神的返回值：它不是「不跑」，是「去问」。抽取会把
 * 会话内容发给模型，而一个本地跑的工具在这件事上必须先问一次。
 */

import { ipcMain } from "electron";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import {
	EXTRACTED_KEY,
	lastPassAt,
	projectInjectedPath,
	projectMemoryDir,
	readExtractedMemory,
	readInjected,
	readLessons,
	runMemoryPass,
	shouldRunPass,
	type SessionStorage,
} from "@lyra/core";
import { settings } from "../app-settings.ts";

export interface ProjectMemoryIpcDeps {
	store(): SessionStorage;
}

export function registerProjectMemoryIpc({ store }: ProjectMemoryIpcDeps): void {
	/**
	 * What this project remembers, for the page: each lesson with when it was written and when it
	 * last reached the model, and the extracted file as one item with the same two times.
	 */
	ipcMain.handle("memory:projectList", async (_event, cwd: string) => {
		const [lessons, injected, extracted] = await Promise.all([
			readLessons(cwd).catch(() => []),
			readInjected(projectInjectedPath(cwd)),
			readExtractedMemory(cwd).catch(() => ""),
		]);
		const updatedAt = extracted ? await stat(join(projectMemoryDir(cwd), "MEMORY.md")).then((s) => s.mtimeMs).catch(() => undefined) : undefined;
		return {
			lessons: lessons.map((lesson) => ({ ...lesson, lastInjectedAt: injected[lesson.text] })),
			extracted: extracted ? { text: extracted, updatedAt, lastInjectedAt: injected[EXTRACTED_KEY] } : null,
		};
	});

	ipcMain.handle("memory:projectStatus", async (_event, cwd: string) => {
		const verdict = shouldRunPass(settings(), await lastPassAt(cwd));
		return verdict.run ? { run: true } : { run: false, reason: verdict.reason };
	});

	/*
	 * 不 await 也不行——窗口要拿结果来决定 toast 说什么。
	 *
	 * 它跑在主进程里，一次请求，几秒。真正保证它不打扰人的是调用时机（空闲），不是异步与否。
	 */
	ipcMain.handle("memory:projectExtract", async (_event, cwd: string) =>
		runMemoryPass({ cwd, settings: settings(), storage: store() }),
	);
}
