/**
 * Which task a scheduler notice is about, and where a failure late in a turn ends up.
 *
 * The window puts a notice on the task's card and follows the run's session to see it end, so each
 * notice has to say which task and which session. And a turn that fails minutes after it started
 * has to reach the task itself: the card reads `lastError`, and before this only a session that
 * could not be created ever wrote one.
 */

import assert from "node:assert/strict";
import { after, test } from "node:test";
import { DEFAULT_SETTINGS, type AgentSession, type ScheduledTask, type Settings } from "@lyra/core";
import { setInterfaceLocaleSource } from "../electron/i18n.ts";
import { Scheduler, type SchedulerNotice } from "../electron/scheduler.ts";

// The notices are read in English; the main process reads the interface language from the settings.
setInterfaceLocaleSource(() => "en");
after(() => setInterfaceLocaleSource(() => "zh-CN"));

const NOW = Date.UTC(2026, 8, 27, 1, 0);
const HOUR = 60 * 60_000;

const TASK: ScheduledTask = {
	id: "nightly",
	name: "Nightly review",
	cwd: "/tmp/project",
	prompt: "Review the uncommitted changes.",
	schedule: { kind: "interval", minutes: 60 },
	enabled: true,
};

/** A turn the test ends by hand, the way a real one ends minutes after it started. */
function pendingTurn() {
	let fail: (error: Error) => void = () => {};
	const promise = new Promise<void>((_resolve, reject) => {
		fail = reject;
	});
	return { promise, fail };
}

/**
 * A scheduler over one due task, keeping every notice it sends and every turn it starts.
 *
 * `slowSave` stands in for `applySettings`, which writes the file first and moves the value in
 * memory only after — so anything reading the settings during a save still sees the old ones.
 * `failAtOnce` makes the turn reject straight away, while the start is still being saved.
 */
function harness(options: { unavailable?: string; failAtOnce?: string; slowSave?: boolean } = {}) {
	let settings: Settings = { ...DEFAULT_SETTINGS, uiLocale: "en", scheduledTasks: [TASK] };
	const notices: SchedulerNotice[] = [];
	const turns: ReturnType<typeof pendingTurn>[] = [];
	let created = 0;
	const scheduler = new Scheduler({
		getSettings: () => settings,
		saveSettings: async (next) => {
			if (options.slowSave) await pause(20);
			settings = next;
		},
		createSession: async () => {
			if (options.unavailable) throw new Error(options.unavailable);
			const id = `session-${++created}`;
			if (options.failAtOnce) {
				const reason = options.failAtOnce;
				return { meta: { id }, prompt: () => Promise.reject(new Error(reason)) } as unknown as AgentSession;
			}
			const turn = pendingTurn();
			turns.push(turn);
			return { meta: { id }, prompt: () => turn.promise } as unknown as AgentSession;
		},
		notify: (message, level, about) => {
			notices.push({ ...about, message, level });
		},
	});
	return { scheduler, notices, turns, task: () => settings.scheduledTasks[0] };
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** Long enough for a failed turn's handler to finish, slow save included. */
const settled = () => pause(60);

test("each notice says which task it is about, and a run's notices which session", async () => {
	const failing = harness();
	await failing.scheduler.tick(NOW);
	failing.turns[0].fail(new Error("rate limited"));
	await settled();
	const refused = harness({ unavailable: "no such folder" });
	await refused.scheduler.tick(NOW);

	assert.deepEqual(
		[...failing.notices, ...refused.notices],
		[
			{ taskId: "nightly", kind: "started", sessionId: "session-1", level: "info", message: "Scheduled task “Nightly review” started" },
			{ taskId: "nightly", kind: "failed", sessionId: "session-1", level: "error", message: "Scheduled task “Nightly review” failed: rate limited" },
			// No session was made, so there is none to name.
			{ taskId: "nightly", kind: "cannotStart", level: "error", message: "Scheduled task “Nightly review” could not start: no such folder" },
		],
	);
});

test("a turn that fails after it started is written on the task, where its card shows it", async () => {
	const run = harness();
	await run.scheduler.tick(NOW);
	assert.equal(run.task().lastError, undefined, "the start itself records no error");

	run.turns[0].fail(new Error("rate limited"));
	await settled();

	assert.equal(run.task().lastError, "rate limited");
	assert.equal(run.task().lastSessionId, "session-1");
	assert.equal(run.task().lastRunAt, NOW);
});

test("a turn that fails while its start is still being saved is not lost", async () => {
	/*
	 * The failure arrives before the attempt is in memory. Read then, the task still names no
	 * session, so the failure would look like it belonged to some other run and be dropped.
	 */
	const run = harness({ failAtOnce: "the model is unavailable", slowSave: true });
	await run.scheduler.tick(NOW);
	await settled();

	assert.equal(run.task().lastSessionId, "session-1");
	assert.equal(run.task().lastError, "the model is unavailable");
});

test("a late failure from an earlier run does not land on a later one", async () => {
	const run = harness();
	await run.scheduler.tick(NOW);
	await run.scheduler.tick(NOW + HOUR);
	assert.equal(run.task().lastSessionId, "session-2");

	run.turns[0].fail(new Error("from the first run"));
	await settled();

	assert.equal(run.task().lastError, undefined, "the second run has not failed");
	// The first run did fail, and the window is still told so.
	assert.deepEqual(
		run.notices.map((notice) => [notice.kind, notice.sessionId]),
		[
			["started", "session-1"],
			["started", "session-2"],
			["failed", "session-1"],
		],
	);
});

test("a task that could not start keeps the reason on the task, as it did before", async () => {
	const run = harness({ unavailable: "no such folder" });
	await run.scheduler.tick(NOW);

	assert.equal(run.task().lastError, "no such folder");
	assert.equal(run.task().lastSessionId, undefined);
});
