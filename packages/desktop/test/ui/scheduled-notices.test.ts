/**
 * The scheduler's three notices, from the bridge to what the window draws.
 *
 * `scheduler:notice` was sent from the first version of the app and never listened to: a task
 * started, failed, or could not start, and nothing on screen said so. These follow each notice to
 * the places it is now shown — the task's card, the line above the composer, the count on the
 * sidebar — and check that each goes away when it should.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement as h, Fragment, type ReactNode } from "react";
import { DEFAULT_SETTINGS, type ScheduledTask, type UiLocale } from "@lyra/core";
import type { SessionActivity } from "@lyra/core/activity";

import type { SchedulerNotice } from "../../electron/ipc-types.ts";
import { LayoutProvider } from "../../src/app/layout.tsx";
import { SessionScope } from "../../src/app/session-scope.tsx";
import { ScheduledAlert } from "../../src/features/scheduled/ScheduledAlert.tsx";
import { ScheduledView } from "../../src/features/scheduled/ScheduledView.tsx";
import { receiveNotice, runEnded, useScheduledNotices, useSchedulerNotices } from "../../src/features/scheduled/notices.ts";
import { DestinationNav } from "../../src/features/sidebar/DestinationNav.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useApp } from "../../src/store/index.ts";
import { click, mount, type Mounted } from "../helpers/mount.ts";

const TASK: ScheduledTask = {
	id: "nightly",
	name: "Nightly",
	cwd: "/repo",
	prompt: "Check the build",
	schedule: { kind: "daily", time: "09:00" },
	enabled: true,
};

function notice(kind: SchedulerNotice["kind"], taskId: string, sessionId?: string): SchedulerNotice {
	return {
		taskId,
		kind,
		level: kind === "started" ? "info" : "error",
		message: `Scheduled task “${taskId}” ${kind === "started" ? "started" : kind === "failed" ? "failed: rate limited" : "could not start: no such folder"}`,
		...(sessionId ? { sessionId } : {}),
	};
}

/** What the shell mounts, on its own. */
function Listener() {
	useSchedulerNotices();
	return null;
}

function inApp(locale: UiLocale, children: ReactNode): ReactNode {
	return h(LayoutProvider, { children: h(I18nProvider, { locale, children }) });
}

/**
 * A clean store and bridge for one test, and everything put back after it.
 *
 * `onNotice` keeps the handler the listener subscribes, so a test can play the main process.
 */
async function scenario(
	options: { tasks?: ScheduledTask[] },
	body: (world: { send(notice: SchedulerNotice): Promise<void>; activity(next: Record<string, SessionActivity>): Promise<void>; released(): boolean }) => Promise<void>,
): Promise<void> {
	const previous = useApp.getState();
	let handler: ((notice: SchedulerNotice) => void) | null = null;
	let released = false;
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: {
			scheduler: {
				onNotice: (next: (notice: SchedulerNotice) => void) => {
					handler = next;
					return () => {
						released = true;
					};
				},
			},
		},
	});
	useScheduledNotices.setState({ runs: {}, unseen: [], focus: null });
	useApp.setState({ settings: { ...DEFAULT_SETTINGS, scheduledTasks: options.tasks ?? [TASK] }, saveSettings: async () => {}, activity: {}, view: "chat" } as never);
	try {
		await body({
			send: async (next) => {
				assert.ok(handler, "nothing is listening for scheduler notices");
				await act(async () => handler?.(next));
			},
			activity: async (next) => {
				await act(async () => useApp.setState({ activity: next }));
			},
			released: () => released,
		});
	} finally {
		useApp.setState(previous, true);
		useScheduledNotices.setState({ runs: {}, unseen: [], focus: null });
		Reflect.deleteProperty(window, "lyra");
	}
}

function status(view: Mounted): string | null {
	return view.host.querySelector("[data-scheduled-status]")?.getAttribute("data-scheduled-status") ?? null;
}

test("the shell's listener takes notices off the bridge, and lets go of it on unmount", async () => {
	await scenario({}, async (world) => {
		const view = await mount(h(Listener));
		await world.send(notice("failed", "nightly", "s1"));
		assert.deepEqual(useScheduledNotices.getState().unseen, [{ taskId: "nightly", message: "Scheduled task “nightly” failed: rate limited" }]);
		await view.unmount();
		assert.ok(world.released(), "the subscription outlived the window's shell");
	});
});

test("a started run shows on its card from the notice on, through the session's activity, until it finishes", async () => {
	await scenario({}, async (world) => {
		const view = await mount(h(Fragment, null, h(Listener), inApp("en", h(ScheduledView))));
		try {
			assert.equal(status(view), null, "nothing is running yet");

			// The turn has not begun, so the session has no activity yet; the card already says so.
			await world.send(notice("started", "nightly", "s1"));
			assert.equal(status(view), "running");
			assert.match(view.find("[data-scheduled-status]").textContent ?? "", /Working/);

			await world.activity({ s1: "running" });
			assert.equal(status(view), "running");

			// Held on an approval, which is worth saying differently: it will not finish by itself.
			await world.activity({ s1: "waiting" });
			assert.equal(status(view), "waiting");
			assert.match(view.find("[data-scheduled-status]").textContent ?? "", /Waiting on you/);

			await world.activity({ s1: "done" });
			assert.equal(status(view), null, "the card still says running after the turn finished");
			assert.deepEqual(useScheduledNotices.getState().runs, {});
		} finally {
			await view.unmount();
		}
	});
});

test("a run that is stopped ends on the card too, though its session is left with no activity at all", async () => {
	await scenario({}, async (world) => {
		const view = await mount(h(Fragment, null, h(Listener), inApp("en", h(ScheduledView))));
		try {
			await world.send(notice("started", "nightly", "s1"));
			await world.activity({ s1: "running" });
			await world.activity({});
			assert.equal(status(view), null);
		} finally {
			await view.unmount();
		}
	});
});

test("a turn that fails ends the run, and a task that could not start leaves an earlier run alone", async () => {
	await scenario({}, async (world) => {
		const view = await mount(h(Fragment, null, h(Listener), inApp("en", h(ScheduledView))));
		try {
			await world.send(notice("started", "nightly", "s1"));
			await world.send(notice("cannotStart", "nightly"));
			assert.equal(status(view), "running", "a second attempt that never began says nothing about the first");
			await world.send(notice("failed", "nightly", "s1"));
			assert.equal(status(view), null);
		} finally {
			await view.unmount();
		}
	});
});

test("a card says why its last run failed, in the interface language", async () => {
	for (const [locale, expected] of [
		["en", "Failed: rate limited"],
		["zh-CN", "失败：rate limited"],
	] as const) {
		await scenario({ tasks: [{ ...TASK, lastError: "rate limited" }] }, async () => {
			const view = await mount(inApp(locale, h(ScheduledView)));
			try {
				assert.equal(view.find("[data-scheduled-error]").textContent, expected);
			} finally {
				await view.unmount();
			}
		});
	}
});

test("a failure is said above the composer, the others counted, until someone says they have seen it", async () => {
	await scenario({}, async () => {
		const view = await mount(inApp("en", h(ScheduledAlert)));
		try {
			assert.ok(!view.host.querySelector("[data-scheduled-alert]"), "a line with nothing to say");

			await act(async () => receiveNotice(notice("failed", "nightly", "s1")));
			assert.equal(view.find(".ly-reveal").getAttribute("data-open"), "true");
			assert.match(view.find("[data-scheduled-alert='nightly']").textContent ?? "", /“nightly” failed: rate limited/);
			assert.ok(!view.host.querySelector("[data-scheduled-alert-others]"));

			// The newest is the one said; the rest are a number.
			await act(async () => receiveNotice(notice("cannotStart", "weekly")));
			assert.match(view.find("[data-scheduled-alert='weekly']").textContent ?? "", /could not start/);
			assert.equal(view.find("[data-scheduled-alert-others]").textContent, "+1 more");

			// The same task failing again is one failure, not two.
			await act(async () => receiveNotice(notice("failed", "nightly", "s2")));
			assert.equal(useScheduledNotices.getState().unseen.length, 2);

			await click(view.find("[data-scheduled-alert-dismiss]"));
			assert.deepEqual(useScheduledNotices.getState().unseen, []);
			assert.equal(view.find(".ly-reveal").getAttribute("data-open"), "false");
		} finally {
			await view.unmount();
		}
	});
});

test("查看 opens the schedule with that task's card brought into view, and the schedule counts as seen", async () => {
	const scrolled: string[] = [];
	const original = HTMLElement.prototype.scrollIntoView;
	HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
		scrolled.push(this.getAttribute("data-scheduled-task") ?? "?");
	};
	try {
		await scenario({ tasks: [TASK, { ...TASK, id: "weekly", name: "Weekly" }] }, async () => {
			const line = await mount(inApp("en", h(ScheduledAlert)));
			await act(async () => receiveNotice(notice("failed", "weekly", "s1")));
			await click(line.find("[data-scheduled-alert-look]"));
			await line.unmount();
			assert.equal(useApp.getState().view, "scheduled");

			const page = await mount(inApp("en", h(ScheduledView)));
			try {
				assert.deepEqual(scrolled, ["weekly"]);
				assert.match(page.find("[data-scheduled-task='weekly']").className, /border-accent/);
				assert.doesNotMatch(page.find("[data-scheduled-task='nightly']").className, /border-accent/);
				assert.equal(useScheduledNotices.getState().focus, null, "a later visit would scroll again");
				assert.deepEqual(useScheduledNotices.getState().unseen, [], "the page was on screen and still counts as unseen");
			} finally {
				await page.unmount();
			}
		});
	} finally {
		HTMLElement.prototype.scrollIntoView = original;
	}
});

test("in a split window only the screen in front says it", async () => {
	await scenario({}, async () => {
		useApp.setState({ activeSessionId: "front" } as never);
		await act(async () => receiveNotice(notice("failed", "nightly", "s1")));
		const view = await mount(
			inApp(
				"en",
				h(
					Fragment,
					null,
					h("div", { "data-screen": "front" }, h(SessionScope.Provider, { value: "front" }, h(ScheduledAlert))),
					h("div", { "data-screen": "beside" }, h(SessionScope.Provider, { value: "beside" }, h(ScheduledAlert))),
				),
			),
		);
		try {
			assert.equal(view.all("[data-scheduled-alert]").length, 1);
			assert.ok(view.find("[data-screen='front'] [data-scheduled-alert]"));
		} finally {
			await view.unmount();
		}
	});
});

test("the sidebar counts the failures nobody has seen, and not while the schedule is open", async () => {
	await scenario({}, async () => {
		await act(async () => {
			receiveNotice(notice("failed", "nightly", "s1"));
			receiveNotice(notice("cannotStart", "weekly"));
		});
		const view = await mount(inApp("en", h(DestinationNav, { onNavigate: () => {} })));
		try {
			const badge = view.find("[aria-label='Failed tasks: 2']");
			assert.equal(badge.textContent, "2");
			assert.match(badge.closest("button")?.textContent ?? "", /Scheduled/);

			await act(async () => useApp.setState({ view: "scheduled" }));
			assert.ok(!view.host.querySelector("[aria-label^='Failed tasks']"));
		} finally {
			await view.unmount();
		}
	});
});

test("a run is over once its session is done or failed, or stops after it had been going", () => {
	const cases: [SessionActivity | undefined, SessionActivity | undefined, boolean][] = [
		[undefined, undefined, false], // started, turn not begun yet
		[undefined, "running", false],
		["running", "running", false],
		["running", "waiting", false],
		[undefined, "done", true],
		[undefined, "failed", true], // no model: failed without ever running
		["running", "done", true],
		["waiting", "failed", true],
		["running", undefined, true], // stopped, or finished while on screen
		["waiting", undefined, true],
	];
	for (const [before, now, over] of cases) assert.equal(runEnded(before, now), over, `${before} → ${now}`);
});
