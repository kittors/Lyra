/**
 * What the update badge and dialog show, per phase, as decisions rather than as markup.
 *
 * A download now has six phases and two surfaces drawing them, which is twelve combinations plus
 * the rules about which controls appear in each. Left inline, that is a dozen ternaries spread over
 * two components — readable one at a time and impossible to check as a set, which is exactly how a
 * state ends up with a button that cannot work in it or a percentage that says NaN.
 *
 * So the rules are here, they are pure, and the tests walk every phase through every one of them.
 * The components below this are then only layout: they ask what to show and show it.
 */

import type { UpdatePhase } from "../../../electron/ipc-types.ts";

export type Phase = UpdatePhase;

/**
 * Every phase, so a test can walk the whole set rather than the ones somebody remembered.
 *
 * `ready` appears twice because it is two endings wearing one name. On macOS the update is unpacked
 * and waiting, and the app can finish the job itself; on Windows and Linux the installer has been
 * handed to the OS and the rest happens in a window this app does not own. Treating them as one
 * phase is how 立即重启 came to be offered on a platform with nothing staged to restart into —
 * a button that did precisely nothing, for a whole release, because it was drawn from `at` alone.
 */
export const PHASES: Phase[] = [
	{ at: "idle" },
	{ at: "downloading", received: 45, total: 100 },
	{ at: "paused", received: 45, total: 100 },
	{ at: "preparing", received: 100, total: 100 },
	{ at: "ready", relaunch: true },
	{ at: "ready", relaunch: false },
	{ at: "failed", error: "下载中断了。", received: 45, total: 100 },
];

/**
 * How far along, 0–1, or null when this phase has no progress to speak of.
 *
 * Null rather than 0 for the phases without one: a ring at zero and no ring at all are different
 * pictures, and `idle` should be the second. Clamped, because a server that sends more than it
 * promised would otherwise push the arc past a full circle and back around.
 */
export function fractionOf(phase: Phase): number | null {
	if (phase.at === "downloading" || phase.at === "paused") {
		// Guarded: `total` is 0 until the first response header lands, and 45/0 is Infinity, which
		// reaches the DOM as a width of `Infinity%` and an arc that vanishes.
		if (!(phase.total > 0)) return 0;
		return Math.min(1, Math.max(0, phase.received / phase.total));
	}
	if (phase.at === "preparing" || phase.at === "ready") return 1;
	return null;
}

/** What the badge says once it opens. Short: it is a label, not a sentence. */
export function labelFor(phase: Phase, version: string): string {
	const percent = Math.round((fractionOf(phase) ?? 0) * 100);
	switch (phase.at) {
		case "downloading":
			return `下载中 ${percent}%`;
		case "paused":
			return `已暂停 ${percent}%`;
		case "preparing":
			return "准备中";
		case "ready":
			// Two endings, two words: one restarts into the new version, the other points at an
			// installer that is already open and waiting to be told to go ahead.
			return phase.relaunch ? "重启更新" : "去安装";
		case "failed":
			return "下载失败";
		default:
			return `新版本 ${version}`;
	}
}

/** What the dialog's confirming button says. */
export function confirmLabel(phase: Phase): string {
	switch (phase.at) {
		case "downloading":
			return "下载中";
		case "paused":
			return "继续下载";
		case "preparing":
			return "准备中";
		case "ready":
			return phase.relaunch ? "立即重启" : "重新打开安装包";
		case "failed":
			return "重试";
		default:
			return "下载安装";
	}
}

/**
 * What the dialog says once the bytes are down — which is a different sentence per ending.
 *
 * Here rather than in the component because it is the same kind of decision as the labels beside
 * it, and because getting it wrong is not a layout bug: the version that said 「重启 Lyra 即可用上
 * 新版本」 on Windows was describing something that could not happen, next to a button that could
 * not do it.
 */
export function readyNote(relaunch: boolean): string {
	return relaunch
		? "已下载完成。重启 Lyra 即可用上新版本，正在进行的对话会中断。"
		: "已下载完成，安装程序已经打开。按它的提示装完，再重新启动 Lyra 就是新版本了。";
}

/**
 * Which controls the dialog offers in this phase.
 *
 * The rules, stated once:
 *
 *   - `confirm` is disabled only while something is genuinely working. Paused and failed are both
 *     actionable — disabling them was how the old dialog said "wait", which it then never stopped
 *     saying if the download had quietly died.
 *   - `pause` replaces `close` while downloading, rather than joining it: the two want the same
 *     slot, and a dialog that can be left by pressing Escape does not need a button saying so
 *     during the one phase where stopping is the more useful thing to offer.
 *   - `cancel` appears only when there is something to throw away. On an untouched update it would
 *     be a second 关闭 wearing a more alarming word.
 */
export function controlsFor(phase: Phase): {
	confirmDisabled: boolean;
	pause: boolean;
	close: boolean;
	cancel: boolean;
} {
	const running = phase.at === "downloading";
	return {
		confirmDisabled: running || phase.at === "preparing",
		pause: running,
		close: !running,
		cancel: running || phase.at === "paused" || (phase.at === "failed" && phase.received > 0),
	};
}

/**
 * Whether the badge is on screen at all.
 *
 * One rule: there is a newer version than the one running. It stays until that stops being true,
 * which happens exactly once — when the update is installed.
 *
 * There was a second rule, and it was reported as a bug within a day of shipping: 以后再说 hid the
 * badge for that version, so the one thing on screen saying an update existed could be made to
 * vanish by pressing a button that sounded like "remind me later". The reasoning was that
 * re-raising an answered announcement is nagging — true of a notification, and this is not one. It
 * is a 20px dot at the bottom of the sidebar whose entire job is to be findable later. A dot that
 * disappears when acknowledged is not a quieter version of that job; it is the opposite of it.
 */
export function shouldShow(update: { available: boolean } | null): boolean {
	return Boolean(update?.available);
}

/**
 * The line under 版本 in 设置 → 关于, which is three different statements wearing one sentence.
 *
 * Here rather than in the component for the reason everything else in this file is: the case that
 * goes wrong is not any one of them, it is the one that was folded into another. A check that
 * could not reach GitHub returns the running version as the newest — the same shape as a
 * successful check on an up-to-date app — so a row written as `available ? … : 已经是最新版本`
 * tells someone with no network that they have the latest release. They have no information at
 * all, and that is the only honest thing to print.
 */
export function versionNote(
	info: { current: string; latest: string; available: boolean; checked: boolean } | null,
	phase: Phase,
): string {
	if (!info) return "正在读取版本…";
	// The phase said in words, so the row means something *during* a download and not only before
	// one: 「新版本 0.3.2」, 「下载中 45%」, 「已暂停 45%」, 「重启更新」…
	if (info.available) return `当前 ${info.current}，${labelFor(phase, info.latest)}`;
	if (!info.checked) return `当前 ${info.current}，没能连上 GitHub，检查一下网络再试`;
	return `当前 ${info.current}，已经是最新版本`;
}

/** Bytes as something a person reads at a glance. One decimal: 90.4MB, not 90.37MB. */
export function mb(bytes: number): string {
	return `${(bytes / 1_048_576).toFixed(1)}MB`;
}
