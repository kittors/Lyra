/**
 * Logic and suppression guards for system notifications on task completion, and the language
 * their text is written in.
 */

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { AgentEvent, UiLocale } from "@lyra/core";
import { configureNotify, notifyNeedAssistance, notifyAgentEvent, notifyTaskDone, type NotificationInstance, type WindowLike } from "../electron/notify.ts";

function mockWindow(overrides: Partial<WindowLike> = {}): WindowLike {
	return {
		isDestroyed: () => false,
		isVisible: () => true,
		isFocused: () => true,
		isMinimized: () => false,
		...overrides,
	};
}

/*
 * The language is module state like every other dependency, so a test that switches it would
 * leak into the tests after it. Each one starts from Simplified Chinese, the catalog's source.
 */
beforeEach(() => {
	configureNotify({ uiLocale: () => "zh-CN", systemLocale: () => "zh-CN" });
});

/** The body of every notification `show` puts up, with the window out of view. */
function bodiesIn(uiLocale: UiLocale, systemLocale: string, show: () => void): string[] {
	const bodies: string[] = [];
	configureNotify({
		isSupported: () => true,
		window: () => mockWindow({ isFocused: () => false }),
		uiLocale: () => uiLocale,
		systemLocale: () => systemLocale,
		createNotification: (options) => ({ on: () => {}, show: () => { bodies.push(options.body); } }),
	});
	show();
	return bodies;
}

test("notifyTaskDone: suppresses notification when window is focused and visible", () => {
	let created = false;
	configureNotify({
		isSupported: () => true,
		window: () => mockWindow({ isFocused: () => true, isVisible: () => true }),
		createNotification: () => {
			created = true;
			return { show: () => {}, on: () => {} };
		},
	});

	notifyTaskDone({ sessionId: "sess-1", title: "Test Task" });
	assert.equal(created, false, "Window is focused; notification must not be created");
});

test("notifyTaskDone: suppresses notification when OS does not support it", () => {
	let created = false;
	configureNotify({
		isSupported: () => false,
		window: () => mockWindow({ isFocused: () => false }),
		createNotification: () => {
			created = true;
			return { show: () => {}, on: () => {} };
		},
	});

	notifyTaskDone({ sessionId: "sess-1", title: "Test Task" });
	assert.equal(created, false, "Notifications unsupported; must not attempt creation");
});

test("notifyTaskDone: shows notification when window is not focused, and sends the session to the shared tray dispatcher on click", () => {
	let shown = false;
	let capturedOptions: unknown = null;
	let clickHandler: (() => void) | null = null;
	let sentCommand: string | null = null;

	const dummyNotification: NotificationInstance = {
		show: () => {
			shown = true;
		},
		on: (event: string, handler: () => void) => {
			if (event === "click") clickHandler = handler;
		},
	};

	configureNotify({
		isSupported: () => true,
		window: () => mockWindow({ isFocused: () => false }),
		appIcon: () => "/path/to/icon.png",
		createNotification: (options) => {
			capturedOptions = options;
			return dummyNotification;
		},
		sendTrayCommand: (cmd) => {
			sentCommand = cmd;
		},
	});

	notifyTaskDone({ sessionId: "sess-42", title: "重构登录逻辑" });

	assert.equal(shown, true, "Notification should be shown");
	assert.deepEqual(capturedOptions, {
		title: "Lyra",
		body: "「重构登录逻辑」已完成",
		icon: "/path/to/icon.png",
		silent: false,
	});

	// Simulate user clicking on notification
	assert.ok(clickHandler, "Click handler must be registered");
	(clickHandler as () => void)();

	assert.equal(sentCommand, "open-session:sess-42", "Must navigate to target session");
});

test("notifyTaskDone: shows notification when window is minimized even if previously focused", () => {
	let shown = false;
	configureNotify({
		isSupported: () => true,
		window: () => mockWindow({ isFocused: () => true, isMinimized: () => true }),
		createNotification: () => ({
			show: () => {
				shown = true;
			},
			on: () => {},
		}),
	});

	notifyTaskDone({ sessionId: "sess-min", title: "Minimized task" });
	assert.equal(shown, true, "Minimized window must receive notification");
});

test("notifyTaskDone: falls back to default body when title is empty or missing", () => {
	let capturedOptions: unknown = null;
	const dummyNotification: NotificationInstance = {
		show: () => {},
		on: () => {},
	};

	configureNotify({
		isSupported: () => true,
		window: () => mockWindow({ isFocused: () => false }),
		createNotification: (options) => {
			capturedOptions = options;
			return dummyNotification;
		},
	});

	notifyTaskDone({ sessionId: "sess-plain" });
	assert.equal(
		(capturedOptions as { title: string; body: string })?.body,
		"任务已完成",
	);
});

test("notifyNeedAssistance: suppresses notification when window is focused and visible", () => {
	let created = false;
	configureNotify({
		isSupported: () => true,
		window: () => mockWindow({ isFocused: () => true, isVisible: () => true }),
		createNotification: () => {
			created = true;
			return { show: () => {}, on: () => {} };
		},
	});

	notifyNeedAssistance({ sessionId: "sess-ask-1", title: "Test Task", question: "需要删除临时文件吗？" });
	assert.equal(created, false, "Window is focused; assistance notification must not be created");
});

test("notifyNeedAssistance: suppresses notification when OS does not support it", () => {
	let created = false;
	configureNotify({
		isSupported: () => false,
		window: () => mockWindow({ isFocused: () => false }),
		createNotification: () => {
			created = true;
			return { show: () => {}, on: () => {} };
		},
	});

	notifyNeedAssistance({ sessionId: "sess-ask-2", title: "Test Task", question: "需要删除临时文件吗？" });
	assert.equal(created, false, "Notifications unsupported; must not attempt creation");
});

test("notifyNeedAssistance: shows notification when window is blurred and navigates on click", () => {
	let shown = false;
	let capturedOptions: unknown = null;
	let clickHandler: (() => void) | null = null;
	let receivedCommand: string | null = null;

	const mockNotificationInstance: NotificationInstance = {
		show: () => {
			shown = true;
		},
		on: (event: string, handler: () => void) => {
			if (event === "click") {
				clickHandler = handler;
			}
		},
	};

	configureNotify({
		isSupported: () => true,
		window: () => mockWindow({ isFocused: () => false }),
		appIcon: () => "/path/to/icon.png",
		sendTrayCommand: (cmd) => {
			receivedCommand = cmd;
		},
		createNotification: (options) => {
			capturedOptions = options;
			return mockNotificationInstance;
		},
	});

	notifyNeedAssistance({
		sessionId: "sess-ask-99",
		title: "重构数据库",
		question: "请选择迁移模式：自动还是手动？",
	});

	assert.equal(shown, true, "Notification must be shown when window is not focused");
	assert.deepEqual(capturedOptions, {
		title: "Lyra",
		body: "「重构数据库」等待回复：请选择迁移模式：自动还是手动？",
		icon: "/path/to/icon.png",
		silent: false,
	});

	assert.ok(clickHandler, "Click handler must be registered");
	clickHandler!();

	assert.equal(receivedCommand, "open-session:sess-ask-99", "Must navigate to the session requesting assistance");
});

test("notifyNeedAssistance: handles missing title or question and truncates long question", () => {
	let capturedOptions: unknown = null;
	const dummyNotification: NotificationInstance = {
		show: () => {},
		on: () => {},
	};

	configureNotify({
		isSupported: () => true,
		window: () => mockWindow({ isFocused: () => false }),
		createNotification: (options) => {
			capturedOptions = options;
			return dummyNotification;
		},
	});

	notifyNeedAssistance({ sessionId: "sess-empty" });
	assert.equal(
		(capturedOptions as { title: string; body: string })?.body,
		"等待回复",
	);

	const longQuestion = "a".repeat(100);
	notifyNeedAssistance({ sessionId: "sess-long", question: longQuestion });
	assert.equal(
		(capturedOptions as { title: string; body: string })?.body,
		`等待回复：${"a".repeat(77)}...`,
	);
});

test("notifyNeedAssistance: shows notification when window is minimized", () => {
	let shown = false;
	configureNotify({
		isSupported: () => true,
		window: () => mockWindow({ isFocused: () => true, isMinimized: () => true }),
		createNotification: () => ({
			show: () => {
				shown = true;
			},
			on: () => {},
		}),
	});

	notifyNeedAssistance({ sessionId: "sess-min", title: "后台任务", question: "是否继续？" });
	assert.equal(shown, true, "Minimized window must receive assistance notification");
});

test("the session event boundary notifies both ordinary approvals and interactive questions", () => {
	const bodies: string[] = [];
	configureNotify({ isSupported: () => true, window: () => mockWindow({ isFocused: () => false }),
		createNotification: (options) => ({ on: () => {}, show: () => { bodies.push(options.body); } }),
	});
	const approval: AgentEvent = { type: "approval_request", requestId: "approve-1", toolCallId: "tool-1", kind: "bash",
		title: "运行命令", detail: "command details must stay inside the app", subject: "rm temp" };
	notifyAgentEvent("session-a", approval, "清理项目");
	notifyAgentEvent("session-b", { ...approval, requestId: "ask-1", kind: "interactive", subject: "ask_user", detail: "选择方案", options: ["A", "B"] }, "方案讨论");
	assert.deepEqual(bodies, ["「清理项目」等待批准：运行命令", "「方案讨论」等待回复：选择方案"]);
	for (const reason of ["aborted", "error", "max_turns", "stalled"] as const) notifyAgentEvent("session-a", { type: "agent_end", reason });
	assert.equal(bodies.length, 2, "only normal completion is a completion notification");
});

for (const [name, window] of [
	["closed", () => null],
	["hidden", () => mockWindow({ isVisible: () => false })],
	["destroyed", () => mockWindow({ isDestroyed: () => true })],
] satisfies [string, () => WindowLike | null][]) {
	test(`notifyTaskDone: a ${name} window still receives completion notifications`, () => {
		let shown = 0;
		configureNotify({
			isSupported: () => true,
			window,
			createNotification: () => ({ show: () => { shown++; }, on: () => {} }),
		});
		notifyTaskDone({ sessionId: "background" });
		assert.equal(shown, 1);
	});
}

/** One notification of each shape, so a language is checked on every message it has. */
function showEveryKind(): void {
	notifyTaskDone({ sessionId: "s", title: "Refactor login" });
	notifyTaskDone({ sessionId: "s" });
	notifyNeedAssistance({ sessionId: "s", title: "Clean up", kind: "approval", question: "Run command" });
	notifyNeedAssistance({ sessionId: "s", kind: "approval" });
	notifyNeedAssistance({ sessionId: "s", title: "Pick a plan", kind: "question", question: "A or B?" });
	notifyNeedAssistance({ sessionId: "s", kind: "question" });
}

test("notifications are written in the interface language, not in Chinese for everyone", () => {
	// On a Chinese system, so the English has to come from the setting rather than from the OS.
	assert.deepEqual(bodiesIn("en", "zh-CN", showEveryKind), [
		"“Refactor login” finished",
		"Task finished",
		"“Clean up” needs your approval: Run command",
		"Waiting for your approval",
		"“Pick a plan” needs your input: A or B?",
		"Waiting for your input",
	]);
	// And the other way round: Chinese chosen on an English system.
	assert.deepEqual(bodiesIn("zh-CN", "en-US", showEveryKind), [
		"「Refactor login」已完成",
		"任务已完成",
		"「Clean up」等待批准：Run command",
		"等待批准",
		"「Pick a plan」等待回复：A or B?",
		"等待回复",
	]);
});

test("a \"system\" language setting follows the operating system", () => {
	assert.deepEqual(bodiesIn("system", "ja-JP", () => notifyTaskDone({ sessionId: "s", title: "整理" })), ["「整理」が完了しました"]);
	assert.deepEqual(bodiesIn("system", "zh-Hant-TW", () => notifyNeedAssistance({ sessionId: "s", kind: "approval" })), ["等待核准"]);
	assert.deepEqual(bodiesIn("system", "es-MX", () => notifyTaskDone({ sessionId: "s" })), ["Task finished"]);
});

test("the language is read for each notification, so changing it applies to the next one", () => {
	let language: UiLocale = "en";
	const bodies: string[] = [];
	configureNotify({
		isSupported: () => true,
		window: () => mockWindow({ isFocused: () => false }),
		uiLocale: () => language,
		createNotification: (options) => ({ on: () => {}, show: () => { bodies.push(options.body); } }),
	});
	notifyTaskDone({ sessionId: "s" });
	language = "fr";
	notifyTaskDone({ sessionId: "s" });
	assert.deepEqual(bodies, ["Task finished", "Tâche terminée"]);
});

test("a session title goes in as text, even when it looks like a replacement pattern or a slot", () => {
	assert.deepEqual(
		bodiesIn("en", "en-US", () => {
			notifyTaskDone({ sessionId: "s", title: "Swap $& for $'" });
			notifyNeedAssistance({ sessionId: "s", title: "Fill {detail}", kind: "approval", question: "Run command" });
		}),
		["“Swap $& for $'” finished", "“Fill {detail}” needs your approval: Run command"],
	);
});
