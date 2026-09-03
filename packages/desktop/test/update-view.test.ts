/**
 * Every phase of an update, through every rule that draws it.
 *
 * The point of these is coverage of the *set*, not of any one case. A download has six phases and
 * two surfaces showing them, and the failures that actually happen are the combinations nobody
 * pictured: a percentage computed before the first response header arrives (45/0 → `Infinity%`),
 * a 继续 button greyed out in the one phase where continuing is the entire point, a 取消 offered
 * for a download that has not started. None of those is visible when reading one ternary; all of
 * them are visible when you walk the phases in a row.
 *
 * So `PHASES` is exported from the module under test rather than written out here — a phase added
 * later joins these tests automatically, instead of being the one nobody remembered to add.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
	confirmLabel,
	controlsFor,
	fractionOf,
	labelFor,
	mb,
	PHASES,
	readyNote,
	shouldShow,
	versionNote,
	type Phase,
} from "../src/features/update/view.ts";

const update = { available: true, latest: "0.3.2" };

test("every phase has a label, and none of them says NaN or undefined", () => {
	for (const phase of PHASES) {
		const label = labelFor(phase, "0.3.2");
		assert.ok(label.length > 0, `${phase.at} 没有文案`);
		assert.doesNotMatch(label, /NaN|undefined|Infinity/, `${phase.at} 的文案是：${label}`);
	}
});

test("every phase has a confirm label, and none of them is empty", () => {
	for (const phase of PHASES) {
		assert.ok(confirmLabel(phase).length > 0, `${phase.at} 的主按钮没有文案`);
	}
});

test("a fraction is either absent or a real number between 0 and 1", () => {
	for (const phase of PHASES) {
		const fraction = fractionOf(phase);
		if (fraction === null) continue;
		assert.ok(Number.isFinite(fraction), `${phase.at} 的进度不是有限数：${fraction}`);
		assert.ok(fraction >= 0 && fraction <= 1, `${phase.at} 的进度越界：${fraction}`);
	}
});

test("a total of zero is nought percent, not a division by zero", () => {
	/*
	 * The first `downloading` event fires before any response header has landed, so `total` is 0 and
	 * `received` may already be positive. `45/0` is `Infinity`, which reaches the DOM as
	 * `width: Infinity%` and an arc that disappears — a badge that breaks in the first frame of
	 * every download and is fixed by the second.
	 */
	assert.equal(fractionOf({ at: "downloading", received: 45, total: 0 }), 0);
	assert.equal(fractionOf({ at: "paused", received: 45, total: 0 }), 0);
});

test("a server that sends more than it promised does not overrun the ring", () => {
	assert.equal(fractionOf({ at: "downloading", received: 120, total: 100 }), 1);
});

test("idle and failed have no progress; the finished phases are full", () => {
	assert.equal(fractionOf({ at: "idle" }), null, "没开始就不该画进度环");
	assert.equal(fractionOf({ at: "failed", error: "x", received: 0, total: 0 }), null);
	assert.equal(fractionOf({ at: "preparing", received: 1, total: 1 }), 1);
	assert.equal(fractionOf({ at: "ready", relaunch: true }), 1);
});

test("the label carries the percentage while it is moving and while it is not", () => {
	assert.equal(labelFor({ at: "downloading", received: 45, total: 100 }, "0.3.2"), "下载中 45%");
	assert.equal(labelFor({ at: "paused", received: 45, total: 100 }, "0.3.2"), "已暂停 45%");
});

test("idle names the version, because that is the announcement", () => {
	assert.equal(labelFor({ at: "idle" }, "0.3.2"), "新版本 0.3.2");
});

/*
 * The controls. One test per rule, stated as the rule rather than as the phases it happens to
 * cover — the phases are walked in the round-trip test below.
 */

test("the confirm button is disabled only while something is genuinely working", () => {
	for (const phase of PHASES) {
		const { confirmDisabled } = controlsFor(phase);
		const working = phase.at === "downloading" || phase.at === "preparing";
		assert.equal(confirmDisabled, working, `${phase.at} 的主按钮可用性不对`);
	}
});

test("paused offers a way to continue, which is the whole reason to allow pausing", () => {
	const paused: Phase = { at: "paused", received: 45, total: 100 };
	assert.equal(controlsFor(paused).confirmDisabled, false);
	assert.equal(confirmLabel(paused), "继续下载");
});

test("a failure offers a retry, and it is not greyed out", () => {
	const failed: Phase = { at: "failed", error: "下载中断了。", received: 45, total: 100 };
	assert.equal(controlsFor(failed).confirmDisabled, false);
	assert.equal(confirmLabel(failed), "重试");
});

test("暂停 and 关闭 never appear together, and one of them always does", () => {
	/*
	 * They occupy the same slot: during a download 暂停 is the more useful thing to offer there, and
	 * outside one it has nothing to stop. Both at once would be two buttons for one position;
	 * neither would leave a gap where a control belongs.
	 */
	for (const phase of PHASES) {
		const { pause, close } = controlsFor(phase);
		assert.notEqual(pause, close, `${phase.at} 的这两个按钮应当恰好出现一个`);
	}
});

test("取消 is offered only when there is something to throw away", () => {
	assert.equal(controlsFor({ at: "idle" }).cancel, false, "还没开始，没有东西可取消");
	assert.equal(controlsFor({ at: "downloading", received: 1, total: 2 }).cancel, true);
	assert.equal(controlsFor({ at: "paused", received: 1, total: 2 }).cancel, true);
	assert.equal(controlsFor({ at: "failed", error: "x", received: 5, total: 9 }).cancel, true, "有碎片就能清掉");
	assert.equal(controlsFor({ at: "failed", error: "x", received: 0, total: 9 }).cancel, false, "没下到东西就没得取消");
});

test("取消 is not offered once it is downloaded and waiting on a restart", () => {
	// There is nothing left to cancel: the bytes are unpacked and the old app is still running.
	assert.equal(controlsFor({ at: "ready", relaunch: true }).cancel, false);
	assert.equal(controlsFor({ at: "ready", relaunch: false }).cancel, false);
});

/*
 * The two endings of `ready`.
 *
 * macOS unpacks the update and can restart into it; Windows and Linux hand an installer to the OS
 * and the rest happens in a window this app does not own. Drawn from `at` alone — which is what a
 * release shipped — the second one gets 立即重启, a button wired to a relaunch that has nothing
 * staged to relaunch into, and therefore does nothing at all when pressed. Nothing about that is
 * visible in the component: it is one `phase.at === "ready"` reading exactly as intended.
 */

test("a staged update offers a restart; an opened installer does not pretend to", () => {
	assert.equal(confirmLabel({ at: "ready", relaunch: true }), "立即重启");
	assert.equal(confirmLabel({ at: "ready", relaunch: false }), "重新打开安装包");
});

test("the badge says which ending this is, in the space it has", () => {
	assert.equal(labelFor({ at: "ready", relaunch: true }, "0.3.2"), "重启更新");
	assert.equal(labelFor({ at: "ready", relaunch: false }, "0.3.2"), "去安装");
});

test("the note under a finished download describes what actually happens next", () => {
	assert.match(readyNote(true), /重启 Lyra/);
	// The one that mattered: this used to promise a restart on a platform where the installer is
	// what finishes the job, so the sentence and the button beside it were both describing macOS.
	assert.match(readyNote(false), /安装程序/);
	assert.doesNotMatch(readyNote(false), /重启 Lyra 即可/);
});

/* Whether the badge is on screen at all. */

test("no update means no badge", () => {
	assert.equal(shouldShow({ available: false, latest: "0.3.2" }), false);
	assert.equal(shouldShow(null), false);
});

test("an available update shows, and there is nothing that takes it away", () => {
	/*
	 * The whole rule, and the regression this replaced.
	 *
	 * 以后再说 used to hide the badge for the version in hand, which meant the one thing on screen
	 * saying an update existed could be removed by pressing a button — and it was reported as a bug
	 * the day it shipped. There is no argument to this function any more that could hide it: as
	 * long as a newer version exists, so does the dot.
	 */
	assert.equal(shouldShow(update), true);
});

/*
 * There is no test walking `shouldShow` across `PHASES`, and there should not be.
 *
 * The old rule was phase-dependent — hidden in `idle` and `failed`, which is to say in the two
 * states an update sits in when nobody is currently doing anything about it, precisely when it
 * most needs to still be findable. A loop over the phases now would call the same one-argument
 * function seven times and assert the same thing seven times: a test that looks thorough and
 * checks nothing. What replaced that rule is in the signature, where the compiler holds it.
 */

/*
 * The line under 版本 in 设置 → 关于.
 *
 * The case worth having a test for is the third one, which for a while was not a case at all: a
 * check that could not reach GitHub returns the running version as the newest, so folding it in
 * with "up to date" produced an app that told someone with no network they had the latest release.
 */

test("a failed check is not reported as being up to date", () => {
	const offline = { current: "0.3.1", latest: "0.3.1", available: false, checked: false };
	const note = versionNote(offline, { at: "idle" });
	assert.doesNotMatch(note, /最新/, `离线时说了：${note}`);
	assert.match(note, /网络/);
});

test("a successful check on the newest version says so", () => {
	const current = { current: "0.3.2", latest: "0.3.2", available: false, checked: true };
	assert.match(versionNote(current, { at: "idle" }), /已经是最新版本/);
});

test("an available update carries the phase, so the row means something mid-download", () => {
	const update = { current: "0.3.1", latest: "0.3.2", available: true, checked: true };
	assert.match(versionNote(update, { at: "idle" }), /新版本 0\.3\.2/);
	assert.match(versionNote(update, { at: "downloading", received: 45, total: 100 }), /下载中 45%/);
	assert.match(versionNote(update, { at: "paused", received: 45, total: 100 }), /已暂停 45%/);
});

test("the version is named in every phase, and never as NaN or undefined", () => {
	for (const phase of PHASES) {
		for (const info of [
			{ current: "0.3.1", latest: "0.3.2", available: true, checked: true },
			{ current: "0.3.2", latest: "0.3.2", available: false, checked: true },
			{ current: "0.3.2", latest: "0.3.2", available: false, checked: false },
		]) {
			const note = versionNote(info, phase);
			assert.match(note, /当前 0\.3\./, `${phase.at} 没有说当前版本：${note}`);
			assert.doesNotMatch(note, /NaN|undefined|Infinity/, `${phase.at} 的文案是：${note}`);
		}
	}
});

test("before the first answer arrives it says so, rather than inventing a version", () => {
	assert.equal(versionNote(null, { at: "idle" }), "正在读取版本…");
});

test("bytes are rendered as something a person reads", () => {
	assert.equal(mb(0), "0.0MB");
	assert.equal(mb(1_048_576), "1.0MB");
	assert.equal(mb(141_557_760), "135.0MB");
});
