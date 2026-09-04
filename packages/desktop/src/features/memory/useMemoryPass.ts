/**
 * 什么时候跑后台抽取——「空闲五分钟」这件事只有界面知道。
 *
 * 计划里写的是「会话结束 或 应用空闲 5 分钟」，而主进程分不出一个人是在读代码还是去吃饭了。
 * 窗口分得出：一轮结束、没有新的输入、五分钟过去。
 *
 * 三条边界，都是为了让它感觉不到：
 *
 *   **只在这一轮真的结束之后开始计时。** 计时器每次 `running` 变化都重置，所以连着发五条消息
 *   不会在中间某处突然去读四十个会话文件。
 *
 *   **窗口关了就不跑。** 这不是缺陷：抽取的结果是给人看的，没有窗口时没人在看。
 *
 *   **先问一次。** 抽取会把会话内容发给模型。一个默认只在本地跑的工具，在这件事上必须保守——
 *   而「问过、拒绝了」和「还没问过」是两种状态，合成一个布尔就必然坏掉一边。
 */

import { useEffect, useRef } from "react";
import { bridge } from "../../services/host.ts";
import { useApp } from "../../store/index.ts";

/** 一轮结束之后，等多久算「空闲」。 */
export const IDLE_MS = 5 * 60 * 1000;

export interface MemoryPassAsk {
	/** 弹征询用的：同意 / 拒绝，两个都是回答。 */
	onAnswer(yes: boolean): void;
}

/**
 * 挂一次，管整个窗口。
 *
 * `ask` 交给调用方，是因为「怎么问」属于界面而「什么时候问」属于这里——而且问出去的那个框
 * 要停下一切，不能由一个 hook 自己长出来。
 */
export function useMemoryPass(ask: (options: MemoryPassAsk) => void): void {
	const cwd = useApp((s) => s.workspace?.path ?? null);
	const running = useApp((s) => s.running);
	const notify = useApp((s) => s.notify);
	const saveSettings = useApp((s) => s.saveSettings);

	/*
	 * 一个窗口的一生里最多问一次。
	 *
	 * 拒绝会写进设置，所以本来也不会再问；这道保险挡的是另一种情况——征询还开着的时候，
	 * 下一个空闲又到了。
	 */
	const asked = useRef(false);

	useEffect(() => {
		if (!cwd || running) return;

		const timer = window.setTimeout(async () => {
			const status = await bridge.projectMemory.status(cwd).catch(() => null);
			if (!status) return;

			if (!status.run) {
				if (status.reason !== "never-asked" || asked.current) return;
				asked.current = true;
				ask({
					onAnswer: (yes) => {
						const current = useApp.getState().settings;
						if (current) void saveSettings({ ...current, memoryExtraction: yes });
					},
				});
				return;
			}

			const result = await bridge.projectMemory.extract(cwd).catch(() => null);
			/*
			 * 只有真的写了东西才说话。
			 *
			 * 「这几次会话里没什么值得记的」是一个正确的结果，而且是最常见的那个——把它也报出来，
			 * 就是每天一条关于什么都没发生的通知。
			 */
			if (result?.memory) notify(`更新了这个项目的记忆，读了 ${result.sessions} 次会话`);
		}, IDLE_MS);

		return () => window.clearTimeout(timer);
	}, [cwd, running, ask, notify, saveSettings]);
}
