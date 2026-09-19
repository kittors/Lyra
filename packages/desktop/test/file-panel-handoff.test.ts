import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { FileContents } from "../electron/ipc-types.ts";
import type { FilePanelState, FilePanelVersion } from "../shared/file-panel-state.ts";
import { readFilePanelState, requestFilePanel } from "../shared/file-panel-state.ts";

const reads: string[] = [];
const a = { path: "/project/alpha.ts", name: "alpha.ts" };
const b = { path: "/project/beta.ts", name: "beta.ts" };
const initial: FilePanelState = { path: b.path, tabs: [a, b], drafts: { [a.path]: "alpha draft", [b.path]: "beta draft" }, wrap: true, showSource: true };
let listener: ((input: FilePanelVersion & { previous?: FilePanelState }) => void) | null = null;
let remote: FilePanelVersion = { version: 1, state: initial };
let delay: Promise<void> | null = null;
let detached = false;
let diskText = "disk baseline";
let readDelay: Promise<void> | null = null;
const writes: FilePanelVersion[] = [];
Object.defineProperty(globalThis, "window", { configurable: true, value: { lyra: {
	get bootWindow() { return detached ? { kind: "panel", panelKind: "file" } : { kind: "primary" }; },
	files: { read: async (path: string): Promise<FileContents> => { reads.push(path); if (readDelay) await readDelay; return { text: diskText, truncated: false }; } },
	windows: {
		onFilePanelState: (fn: typeof listener) => { listener = fn; return () => { listener = null; }; },
		filePanelState: async (input?: FilePanelVersion): Promise<FilePanelVersion | null> => {
			if (!input) return remote;
			writes.push(input);
			if (!readFilePanelState(input.state)) return null;
			if (delay) await delay;
			if (input.version !== remote.version) return remote;
			remote = { version: remote.version + 1, state: input.state };
			return remote;
		},
	},
} } });
const { useOpenFile } = await import("../src/store/openFile.ts");
const { applyFilePanelState, filePanelSnapshot, flushFilePanelState, watchFilePanelState } = await import("../src/store/file-panel-handoff.ts");
async function settled() { for (let i = 0; i < 12; i++) await Promise.resolve(); }

beforeEach(() => {
	useOpenFile.getState().clear();
	useOpenFile.setState({ wrap: false, showSource: false });
	reads.length = writes.length = 0;
	remote = { version: 1, state: structuredClone(initial) };
	delay = null;
	detached = false;
	diskText = "disk baseline";
	readDelay = null;
});

test("a new renderer restores active file, both tabs, drafts and view options through a normal read", async () => {
	await applyFilePanelState(initial);
	assert.deepEqual(reads, [b.path]);
	assert.deepEqual(filePanelSnapshot(), initial);
	assert.equal(useOpenFile.getState().contents?.text, "disk baseline");
	assert.equal(useOpenFile.getState().drafts[b.path], "beta draft");
});

test("every detached edit reaches the main-process snapshot before a return or close completes", async () => {
	detached = true;
	const errors: unknown[] = [];
	const stop = watchFilePanelState((error) => errors.push(error));
	try {
		await settled();
		useOpenFile.getState().setDraft(b.path, "latest native edit");
		await flushFilePanelState();
		assert.equal(remote.state.drafts[b.path], "latest native edit");
		assert.deepEqual(errors, []);
	} finally { stop(); }
});

test("closing waits for the last keystroke, including one typed while an earlier update is pending", async () => {
	detached = true;
	const errors: unknown[] = [];
	const stop = watchFilePanelState((error) => errors.push(error));
	try {
		await settled();
		let resume = () => {};
		delay = new Promise<void>((resolve) => { resume = resolve; });
		useOpenFile.getState().setDraft(b.path, "first pending edit");
		useOpenFile.getState().setDraft(b.path, "last keystroke before close");
		let closed = false;
		const close = flushFilePanelState().then(() => { closed = true; });
		await settled();
		assert.equal(closed, false);
		delay = null;
		resume();
		await close;
		assert.equal(remote.state.drafts[b.path], "last keystroke before close");
		assert.equal(closed, true);
		assert.deepEqual(errors, []);
	} finally { stop(); }
});

test("saving in the detached window rereads the source's same-path disk baseline", async () => {
	await applyFilePanelState(initial);
	const stop = watchFilePanelState((error) => { throw error; });
	try {
		diskText = "saved in detached window";
		listener?.({ version: 2, previous: initial, state: { ...initial, drafts: { [a.path]: "alpha draft" } } });
		await settled();
		assert.equal(useOpenFile.getState().contents?.text, diskText);
		assert.equal(useOpenFile.getState().drafts[b.path], undefined);
		assert.deepEqual(reads, [b.path, b.path]);
	} finally { stop(); }
});

test("a source open racing a pending edit preserves the last keystroke and new active file", async () => {
	detached = true;
	const errors: unknown[] = [];
	const stop = watchFilePanelState((error) => errors.push(error));
	try {
		await settled();
		let resume = () => {};
		delay = new Promise<void>((resolve) => { resume = resolve; });
		useOpenFile.getState().setDraft(b.path, "racing keystroke");
		const c = { path: "/project/new.ts", name: "new.ts" };
		remote = { version: remote.version + 1, state: requestFilePanel(remote.state, { ...initial, path: c.path, tabs: [...initial.tabs, c] }) };
		listener?.(remote);
		delay = null;
		resume();
		await settled();
		await flushFilePanelState();
		assert.equal(remote.state.path, c.path);
		assert.equal(remote.state.drafts[b.path], "racing keystroke");
		assert.deepEqual(remote.state.tabs, [a, b, c]);
		assert.deepEqual(errors, []);
	} finally { stop(); }
});

test("background draft updates preserve the source's different active project", async () => {
	await applyFilePanelState(initial);
	const c = { path: "/other/work.ts", name: "work.ts" };
	await useOpenFile.getState().open(c);
	useOpenFile.getState().setDraft(c.path, "source draft");
	const stop = watchFilePanelState((error) => { throw error; });
	try {
		listener?.({ version: 2, previous: initial, state: { ...initial, drafts: { ...initial.drafts, [b.path]: "native draft" } } });
		await settled();
		assert.equal(useOpenFile.getState().path, c.path);
		assert.equal(useOpenFile.getState().drafts[c.path], "source draft");
		assert.equal(useOpenFile.getState().drafts[b.path], "native draft");
	} finally { stop(); }
});

test("closing the final detached tab and moving an active file never publish an invalid snapshot", async () => {
	detached = true;
	const errors: unknown[] = [];
	const stop = watchFilePanelState((error) => errors.push(error));
	try {
		await settled();
		useOpenFile.getState().moved(b.path, "/project/renamed.ts");
		await flushFilePanelState();
		assert.equal(remote.state.path, "/project/renamed.ts");
		useOpenFile.getState().closeTab(a.path);
		useOpenFile.getState().closeTab("/project/renamed.ts");
		await flushFilePanelState();
		assert.equal(remote.state.path, null);
		assert.deepEqual(remote.state.tabs, []);
		assert.deepEqual(remote.state.drafts, {});
		assert.deepEqual(errors, []);
		assert.ok(writes.every((input) => readFilePanelState(input.state) !== null));
	} finally { stop(); }
});

test("moving a file while its read is pending restarts at the new path and settles loading", async () => {
	let resume = () => {};
	readDelay = new Promise<void>((resolve) => { resume = resolve; });
	const opening = useOpenFile.getState().open(a);
	useOpenFile.getState().moved(a.path, "/project/renamed.ts");
	resume();
	await opening;
	await settled();
	assert.deepEqual(reads, [a.path, "/project/renamed.ts"]);
	assert.equal(useOpenFile.getState().path, "/project/renamed.ts");
	assert.equal(useOpenFile.getState().opening, null);
	assert.equal(useOpenFile.getState().loading, false);
});
