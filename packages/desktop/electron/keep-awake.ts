/**
 * 「Lyra 开着的时候别让电脑睡」。
 *
 * 一个开关，开着的时候持有一个系统级的「别休眠」声明，关掉就放掉。声明由 Electron 的
 * `powerSaveBlocker` 发出，两个平台各自落到自己的系统 API 上：macOS 是 `IOPMAssertion`，
 * Windows 是 `SetThreadExecutionState`。
 *
 * 取 `prevent-display-sleep` 而不是 `prevent-app-suspension`。后者只保证这个应用的 JS 继续跑，
 * 屏幕该黑还是黑、系统该空闲休眠还是休眠——而这个开关要的是「我离开一会儿回来，它还在那儿跑」，
 * 屏幕黑掉之后系统随时会跟着睡下去，那个保证就不成立了。
 *
 * **合盖不在这个开关的能力范围内，这一点在设置页如实写着。** 两个平台的合盖动作都不归应用管：
 * macOS 的 clamshell sleep 由 `pmset disablesleep` 决定，要 root；Windows 的合盖动作是电源计划里
 * 的 LIDACTION，要管理员改。用户态的 `powerSaveBlocker` 拦不住任何一个——真去拦就得替用户改系统
 * 电源策略，那是一件退出应用之后还留在机器上的事，不该由一个开关悄悄做掉。
 *
 * 所以这里保证的是：**不息屏、不因为闲置而休眠**。外接显示器 + 电源的 macOS 合盖（clamshell 模式）
 * 本来就不睡，那种情况下它一样管用。
 *
 * 声明从哪来是注入的，这个文件本身不 import `electron`——否则 `node --test` 连加载它都做不到，
 * 而下面那条幂等的规矩正是最需要被测住的东西。`electron` 的那一版在 `main.ts` 里接上。
 */

import { onSettingsChanged, settings } from "./app-settings.ts";

/** `powerSaveBlocker` 里这个模块用得上的那三个方法。 */
export interface SleepBlocker {
	/** 发一个声明，返回它的 id。 */
	start(): number;
	stop(id: number): void;
	isStarted(id: number): boolean;
}

export interface KeepAwake {
	/** 现在拦着没有。 */
	keeping(): boolean;
	set(on: boolean): void;
}

/**
 * 一个开关，最多持有一个声明。
 *
 * **幂等是这里唯一的规矩，也是唯一会出错的地方。** `applySettings` 的监听器在每一次设置保存时都会
 * 跑——改主题、换模型、开别的开关，全都会走到这里。每次都 `start` 一个新的会攒出一串谁也停不掉的
 * 声明，而 `powerSaveBlocker` 的效果是叠加的：开关关掉之后电脑仍然不睡，且界面上没有任何东西能
 * 解释为什么。
 *
 * 顺带也守住反向那次：没持有的时候 `set(false)` 不该去 `stop` 一个不存在的 id。
 */
export function createKeepAwake(blocker: SleepBlocker): KeepAwake {
	let held: number | null = null;

	const keeping = () => held !== null && blocker.isStarted(held);

	return {
		keeping,
		set(on: boolean) {
			if (on === keeping()) return;
			if (held !== null) {
				// 问过再停：系统可能已经自己收走了它，对一个停掉的 id 再 stop 一次是没定义的。
				if (blocker.isStarted(held)) blocker.stop(held);
				held = null;
			}
			if (on) held = blocker.start();
		},
	};
}

/**
 * 开机时按设置摆好，之后跟着设置走。
 *
 * 在 `main.ts` 里调一次。返回取消订阅，虽然这个应用的生命周期里没人会用到它——写出来是因为
 * `onSettingsChanged` 返回它，把它丢掉会让人以为这个监听器不需要清理。
 */
export function installKeepAwake(keeper: KeepAwake): () => void {
	keeper.set(settings()?.keepAwake === true);
	return onSettingsChanged((next) => {
		keeper.set(next.keepAwake === true);
	});
}
