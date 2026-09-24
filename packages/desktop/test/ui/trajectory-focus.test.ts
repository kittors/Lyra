import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement as h } from "react";
import type { AgentEvent, SessionMeta, TrajectoryChanges } from "@lyra/core";
import type { Entry } from "@lyra/core/trajectory-view";
import { useApp } from "../../src/store/index.ts";
import { useOpenFile } from "../../src/store/openFile.ts";
import { provideScope, usePaneDock } from "../../src/features/dock/index.ts";
import { consumeTraceFocus, showTrace, useTraceFocus } from "../../src/features/conversation/trajectory/navigation.ts";
import { TrajectoryPanel } from "../../src/features/conversation/trajectory/TrajectoryPanel.tsx";
import { click, mount } from "../helpers/mount.ts";

const target: Entry = { id: "focused-tool", seq: 2, ts: 2, source: "tool-call", correlationId: "call-focus", summary: "目标工具调用", detail: "完整调用正文", metadata: { outputPath: "/tmp/trace-output.txt" } };
const correlationId = "call-focus";
function fixture(id: string) {
	const meta: SessionMeta = { id, projectId: "p", projectName: "QA", cwd: "/tmp", title: "Focus", createdAt: 1, updatedAt: 1, messageCount: 1, seq: 1, modelId: "qa", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
	const reads: { id: string; resolve: (changes: TrajectoryChanges) => void }[] = [];
	const exports: { format: string; entry?: { id: string }; resolve: (path: string) => void; reject: (error: Error) => void }[] = [];
	const files: { path: string; resolve: () => void; reject: (error: Error) => void }[] = [];
	const panes: string[] = [], errors: string[] = [];
	const listeners = new Set<(payload: { sessionId: string; event: AgentEvent }) => void>();
	const previousBridge = Object.getOwnPropertyDescriptor(window, "lyra");
	const app = useApp.getState(), dock = usePaneDock.getState(), file = useOpenFile.getState(), focus = useTraceFocus.getState();
	Object.defineProperty(window, "lyra", { configurable: true, value: {
		sessions: {
			trajectoryChanges: (_project: string, sessionId: string) => new Promise<TrajectoryChanges>(resolve => reads.push({ id: sessionId, resolve })),
			exportTrajectory: (_project: string, _sessionId: string, format: string, entry?: { id: string }) => new Promise<string>((resolve, reject) => exports.push({ format, entry, resolve, reject })),
		},
		agent: { onEvent: (listener: (payload: { sessionId: string; event: AgentEvent }) => void) => { listeners.add(listener); return () => listeners.delete(listener); } },
	} });
	useApp.setState({ meta, notify: message => errors.push(message) });
	// Panels open in the screen the person is in; record which ones were asked for.
	provideScope(() => id);
	usePaneDock.setState({ open: (_scope, kind) => { panes.push(kind); return true; } });
	useOpenFile.setState({ open: entry => new Promise<void>((resolve, reject) => files.push({ path: entry.path, resolve, reject })) });
	useTraceFocus.setState({ sessionId: "", correlationId: "", nonce: 0 });
	return { meta, reads, exports, files, panes, errors, listeners, restore() {
		useApp.setState(app); usePaneDock.setState(dock); useOpenFile.setState(file); useTraceFocus.setState(focus); provideScope(() => null);
		if (previousBridge) Object.defineProperty(window, "lyra", previousBridge); else Reflect.deleteProperty(window, "lyra");
	} };
}

function inspector() { return document.querySelector<HTMLElement>(".ly-trace-inspector"); }
async function action(label: string) {
	if (label === "返回记录") {
		const button = document.querySelector('.ly-trace-inspector [aria-label="返回记录"]'); assert.ok(button); await click(button); return;
	}
	const menu = document.querySelector('.ly-trace-inspector [aria-label="记录操作"]'); assert.ok(menu); await click(menu);
	const item = [...document.querySelectorAll('[role="menuitem"]')].find(element => element.textContent === label); assert.ok(item); await click(item);
}

test("an old focus nonce cannot clear a newer request, including one for the same record", () => {
	const state = fixture("trace-focus-nonce");
	try {
		showTrace(state.meta.id, correlationId);
		const oldNonce = useTraceFocus.getState().nonce;
		showTrace(state.meta.id, correlationId);
		const pending = useTraceFocus.getState();
		consumeTraceFocus(oldNonce);
		assert.equal(useTraceFocus.getState(), pending);
		consumeTraceFocus(pending.nonce);
		assert.deepEqual(useTraceFocus.getState(), { sessionId: "", correlationId: "", nonce: pending.nonce });
		showTrace("another-session", "another-call");
		consumeTraceFocus(pending.nonce);
		assert.deepEqual(useTraceFocus.getState(), { sessionId: "another-session", correlationId: "another-call", nonce: pending.nonce + 1 });
	} finally { state.restore(); }
});

test("a trace link waits for its tool call, is consumed once applied, and never replays after a session switch", async () => {
	const state = fixture("trace-focus-lifecycle");
	showTrace(state.meta.id, correlationId);
	const nonce = useTraceFocus.getState().nonce;
	const view = await mount(h(TrajectoryPanel));
	try {
		assert.equal(state.reads.length, 1); assert.equal(inspector(), null);
		const other: Entry = { ...target, id: "other-source", seq: 1, source: "request" };
		await act(async () => state.reads[0].resolve({ cursor: "focus:1", reset: true, upserts: [other], removals: [] }));
		assert.equal(inspector(), null);
		assert.equal(useTraceFocus.getState().correlationId, target.correlationId, "missing tool calls must keep waiting, including when another source shares the ID");
		await act(async () => { for (const listener of state.listeners) listener({ sessionId: state.meta.id, event: { type: "compacted", before: 20, after: 8 } }); });
		assert.equal(state.reads.length, 2);
		await act(async () => state.reads[1].resolve({ cursor: "focus:2", reset: false, upserts: [target], removals: [] }));
		assert.ok(inspector()?.textContent?.includes(target.summary));
		assert.equal(view.find('[data-trace-entry="focused-tool"]').getAttribute("aria-pressed"), "true");
		assert.deepEqual(useTraceFocus.getState(), { sessionId: "", correlationId: "", nonce });
		await action("返回记录"); assert.equal(inspector(), null);
		await act(async () => useApp.setState({ meta: { ...state.meta, id: "trace-focus-other" } }));
		await act(async () => state.reads[2].resolve({ cursor: "other:1", reset: true, upserts: [], removals: [] }));
		await act(async () => useApp.setState({ meta: state.meta }));
		await act(async () => state.reads[3].resolve({ cursor: "focus:2", reset: false, upserts: [], removals: [] }));
		assert.equal(inspector(), null, "returning to a session must not replay an already handled link");
		await act(async () => showTrace(state.meta.id, correlationId));
		assert.ok(inspector()?.textContent?.includes(target.summary), "a fresh request for the same call still opens it");
		assert.equal(useTraceFocus.getState().nonce, nonce + 1);
		assert.equal(useTraceFocus.getState().sessionId, "");
	} finally { await view.unmount(); assert.equal(state.listeners.size, 0); state.restore(); }
});

test("viewing a trace file retains the inspector on failure and closes only after the file opens", async () => {
	const state = fixture("trace-focus-export");
	showTrace(state.meta.id, correlationId);
	const view = await mount(h(TrajectoryPanel));
	try {
		await act(async () => state.reads[0].resolve({ cursor: "export:1", reset: true, upserts: [target], removals: [] }));
		await action("在文件中查看完整记录");
		assert.equal(state.exports[0].format, "json"); assert.deepEqual(state.exports[0].entry, { id: target.id });
		await act(async () => state.exports[0].reject(new Error("export failed")));
		assert.ok(inspector()); assert.match(state.errors[0], /export failed/); assert.equal(state.files.length, 0);
		await action("在文件中查看完整记录");
		await act(async () => state.exports[1].resolve("/tmp/record.json"));
		assert.ok(inspector()); assert.equal(state.files[0].path, "/tmp/record.json");
		await act(async () => state.files[0].reject(new Error("file read failed")));
		assert.ok(inspector()); assert.match(state.errors[1], /file read failed/); assert.ok(!state.panes.includes("file"));
		await action("在文件中查看完整记录");
		await act(async () => state.exports[2].resolve("/tmp/record.json"));
		await act(async () => state.files[1].resolve());
		assert.equal(state.panes.at(-1), "file"); assert.equal(inspector(), null);
		await act(async () => showTrace(state.meta.id, correlationId));
		await action("查看完整原始输出");
		assert.equal(state.exports[3].format, "output");
		await act(async () => state.exports[3].resolve("/tmp/trace-output.txt"));
		assert.ok(inspector());
		await act(async () => state.files[2].resolve());
		assert.equal(state.panes.at(-1), "file"); assert.equal(inspector(), null);
	} finally { await view.unmount(); state.restore(); }
});
