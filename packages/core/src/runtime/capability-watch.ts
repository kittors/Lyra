/**
 * 改一个技能文件，不用重启窗口。
 *
 * omp 没有这个——它的文档明说 "There is no continuous file watcher"。而编辑技能和规则是这套
 * 系统里最高频的动作之一：写一条规则、试一句话、再改一版。要求每一版都重启窗口，等于要求
 * 每一版都重新加载全部插件、重连全部 MCP、丢掉正在看的那个对话。
 *
 * 三条决定它安不安全：
 *
 *   **只监听贡献过条目的目录。** 能力可以来自几十个位置，而其中绝大多数在这台机器上根本不
 *   存在。注册表本来就报了 `watched`——每个 provider 都写了这个字段，只是一直没人接。
 *
 *   **一轮跑到一半绝不替换。** 模型正按当前那份技能清单做决策；中途换掉，`skill://x` 会指向
 *   一个已经不在的东西。改动排到这一轮结束。
 *
 *   **防抖。** 保存一个文件在 macOS 上能产生三四个事件，`git checkout` 一个分支能产生几百个。
 */

import { watch, type FSWatcher } from "node:fs";

/** 攒事件的窗口。一次保存产生的那几个事件要合成一次重载。 */
export const DEBOUNCE_MS = 300;

export interface WatchOptions {
	/** 实际读过的目录，来自 `LoadedCapabilities.watched`。 */
	dirs: string[];
	/** 该重载了。抛错由调用方吞掉——重载失败不该带走监听。 */
	reload(): Promise<void>;
	/** 现在能不能替换。false 时改动排队，等 `resume()` 被调用。 */
	idle(): boolean;
	debounceMs?: number;
	/**
	 * 怎么建立监听。默认 `fs.watch`，测试可以换掉。
	 *
	 * 换掉它之后测的是「收到事件之后做什么」——防抖、忙时排队、重载出错不带走监听——而那才是
	 * 这个文件里的代码。「`fs.watch` 会不会发事件」是 Node 的责任，而在负载高的机器上它可能
	 * 要等十几秒；一条本该确定的测试因此变成了一场关于 FSEvents 延迟的赌博，而它输过三次。
	 */
	watchFactory?: typeof watch;
}

/**
 * 盯着这些目录，改了就重载。
 *
 * 不递归：`fs.watch` 的 `recursive` 在 Linux 上要 Node 20+ 且行为不一，而能力目录本来就是
 * 一层——`~/.lyra/skills/<name>/SKILL.md` 里变的是子目录，而父目录的事件足够告诉我们
 * 「这下面有东西动了」。
 */
export class CapabilityWatcher {
	private readonly watchers: FSWatcher[] = [];
	private timer: ReturnType<typeof setTimeout> | null = null;
	/** 有改动在等一轮结束。 */
	private pending = false;
	private readonly options: WatchOptions;

	constructor(options: WatchOptions) {
		this.options = options;
		for (const dir of options.dirs) {
			/*
			 * 目录不存在不是错误，是常态：大多数项目没有大多数这些目录。
			 *
			 * 但这里有一个真实的取舍——一个**还不存在**的目录建不了监听，所以「第一次创建
			 * `.lyra/skills/`」这件事不会被听见。下一次重载会带上它（那时它已经贡献过条目、
			 * 会出现在 `watched` 里）。为一个可能永远不出现的目录去监听它的父目录，代价是
			 * 监听整个项目根。
			 */
			try {
				const watcher = (options.watchFactory ?? watch)(dir, { recursive: true }, () => this.touched());
				watcher.on("error", () => {});
				/*
				 * `unref` 让它不成为进程退出的理由。
				 *
				 * 一个还开着的 `fs.watch` 会拖住事件循环——CLI 跑完一件事之后会挂在那里不退出，
				 * 测试跑完之后 `node --test` 也不会结束。而「有人在改技能文件」从来不是一个值得
				 * 让进程活着的理由：真有会话在用它时，会话自己会让进程活着。
				 */
				watcher.unref?.();
				this.watchers.push(watcher);
			} catch {
				// 目录不在、权限不够、或者平台不支持递归——都不该让会话起不来。
			}
		}
	}

	/** 有多少个目录真的听上了。 */
	get watching(): number {
		return this.watchers.length;
	}

	/** 有改动正等着一轮结束。 */
	get waiting(): boolean {
		return this.pending;
	}

	private touched(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			this.timer = null;
			void this.fire();
		}, this.options.debounceMs ?? DEBOUNCE_MS);
		/*
		 * `unref` 让它不要拖住进程退出。
		 *
		 * 一个等着 300ms 的定时器会让 `node` 多活 300ms——对 CLI 来说，那是每次退出都多出来的
		 * 一段静止。
		 */
		this.timer.unref?.();
	}

	private async fire(): Promise<void> {
		if (!this.options.idle()) {
			this.pending = true;
			return;
		}
		this.pending = false;
		await this.options.reload().catch(() => {});
	}

	/**
	 * 一轮结束了：如果期间有改动，现在替换。
	 *
	 * 由会话在 turn 收尾时调用。这是「流式中不替换」那条硬约束的另一半——排队了就得有人把它
	 * 放出来，否则改动会一直等到下一次文件事件。
	 */
	async resume(): Promise<void> {
		if (!this.pending) return;
		this.pending = false;
		await this.options.reload().catch(() => {});
	}

	close(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		for (const watcher of this.watchers) watcher.close();
		this.watchers.length = 0;
	}
}
