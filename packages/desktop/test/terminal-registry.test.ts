/**
 * Which shell a pane gets, and what it takes to end one.
 *
 * The whole point of this registry is that a shell outlives the pane showing it: panes are
 * unmounted constantly — closing one, switching to a conversation laid out differently, making
 * another pane full screen — and every one of those used to kill the shell underneath. So the
 * claims worth testing are all about identity and survival: connecting twice reaches the same
 * shell, a detach ends nothing, and what the shell said while nobody was watching comes back.
 *
 * Driven through `createTerminalRegistry` with a stand-in pty, so none of this needs Electron —
 * and so "did it spawn a second shell?" is a countable fact rather than something inferred from
 * output that looks familiar.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createTerminalRegistry, type LiveTerminal } from "../electron/terminal-registry.ts";

interface FakePty {
	pid: number;
	killed: boolean;
	writes: string[];
	sizes: [number, number][];
	say(data: string): void;
	quit(code: number): void;
}

/** A registry and the shells it started, with nothing real on the other end. */
function harness() {
	const terminals = new Map<string, LiveTerminal>();
	const spawned: FakePty[] = [];
	/** Every `terminal:data` that reached a renderer, so "was this forwarded?" is countable. */
	const sent: { channel: string; payload: { id: string; data?: string } }[] = [];
	const otherSent: typeof sent = [];
	let nextPid = 1000;

	const spawnPty = () => {
		const dataHandlers: ((data: string) => void)[] = [];
		const exitHandlers: ((event: { exitCode: number }) => void)[] = [];
		const pty = {
			pid: nextPid++,
			killed: false,
			writes: [] as string[],
			sizes: [] as [number, number][],
			write: (data: string) => pty.writes.push(data),
			resize: (cols: number, rows: number) => pty.sizes.push([cols, rows]),
			kill: () => {
				pty.killed = true;
			},
			onData: (fn: (data: string) => void) => dataHandlers.push(fn),
			onExit: (fn: (event: { exitCode: number }) => void) => exitHandlers.push(fn),
			say: (data: string) => dataHandlers.forEach((fn) => fn(data)),
			quit: (code: number) => exitHandlers.forEach((fn) => fn({ exitCode: code })),
		};
		spawned.push(pty as unknown as FakePty);
		return pty as never;
	};

	const registry = createTerminalRegistry({
		terminals,
		spawnPty,
		// Every path is a project here; which paths qualify is decided elsewhere and tested there.
		insideAProject: () => true,
		eachWindow: (visit: (window: import("electron").BrowserWindow) => void) => {
			for (const messages of [sent, otherSent]) visit({
				isDestroyed: () => false,
				webContents: { isDestroyed: () => false, send: (channel: string, payload: { id: string; data?: string }) => messages.push({ channel, payload }) },
			} as never);
		},
	});

	return { registry, terminals, spawned, sent, otherSent };
}

test("terminal output and exit reach every live app window without requiring focus", () => {
	const { registry, spawned, sent, otherSent } = harness();
	const shell = registry.open("/work/app", 80, 24);
	registry.attach(shell.id, 80, 24);
	spawned[0].say("background build output");
	spawned[0].quit(7);
	assert.deepEqual(otherSent, sent);
	assert.equal(otherSent.length, 2);
	assert.equal(otherSent[0].payload.data, "background build output");
	assert.equal(otherSent[1].channel, "terminal:exit");
});

test("detaching the newest view keeps an older view of the same shell receiving output", () => {
	const { registry, spawned, sent, terminals } = harness();
	const shell = registry.open("/work/app", 80, 24);
	const first = registry.attach(shell.id, 80, 24);
	const second = registry.attach(shell.id, 40, 24);
	assert.ok(first && second);
	registry.detach(shell.id, second.epoch);
	assert.equal(terminals.get(shell.id)?.attached, true);
	spawned[0].say("older view is still listening");
	assert.equal(sent.at(-1)?.payload.data, "older view is still listening");
	registry.detach(shell.id, first.epoch);
	assert.equal(terminals.get(shell.id)?.attached, false);
	spawned[0].say("scrollback only");
	assert.equal(sent.length, 1);
});

test("renderer cleanup removes all its connections while preserving another renderer's views", () => {
	const { registry, spawned, sent, terminals } = harness();
	const shared = registry.open("/work/app", 80, 24);
	const own = registry.open("/work/app", 80, 24);
	const survivor = registry.attach(shared.id, 80, 24, 10);
	const gone = registry.attach(shared.id, 40, 24, 20);
	registry.attach(shared.id, 50, 24, 20);
	registry.attach(own.id, 50, 24, 20);
	assert.ok(survivor && gone);
	registry.detachOwner(20);
	assert.equal(terminals.get(shared.id)?.connections.size, 1);
	assert.equal(terminals.get(shared.id)?.attached, true);
	assert.equal(terminals.get(own.id)?.attached, false);
	registry.detach(shared.id, gone.epoch);
	spawned[0].say("still connected elsewhere");
	spawned[1].say("only scrollback");
	assert.equal(sent.length, 1);
	const reloaded = registry.attach(shared.id, 40, 24, 20);
	assert.ok(reloaded);
	registry.detachOwner(10);
	assert.equal(terminals.get(shared.id)?.attached, true);
	registry.detach(shared.id, reloaded.epoch);
	assert.equal(terminals.get(shared.id)?.attached, false);
	assert.equal(spawned.some((pty) => pty.killed), false);
});

test("opening always starts another shell — that is what the tab strip's + is for", () => {
	const { registry, spawned } = harness();

	const first = registry.open("/work/app", 80, 24);
	const second = registry.open("/work/app", 80, 24);

	assert.equal(spawned.length, 2);
	assert.notEqual(second.id, first.id);
	assert.deepEqual([first.title, second.title], ["终端 1", "终端 2"], "and it is numbered in order");
});

test("a directory can still be asked what it has, which is what prewarming reads", () => {
	const { registry } = harness();

	registry.open("/work/app", 80, 24);
	registry.open("/work/app", 80, 24);
	registry.open("/work/docs", 80, 24);

	assert.equal(registry.list("/work/app").length, 2);
	assert.equal(registry.list("/work/docs").length, 1);
});

test("tab names are unique across every shell, not restarted in each directory", () => {
	/*
	 * The strip shows all of them at once, so numbering within a directory gave two tabs both called
	 * 「终端 1」 as soon as a shell was started somewhere else — on a strip whose whole job is to let
	 * you pick one by name.
	 */
	const { registry } = harness();

	registry.open("/work/app", 80, 24);
	registry.open("/work/docs", 80, 24);
	registry.open("", 80, 24);

	const titles = registry.listAll().map((tab) => tab.title);
	assert.deepEqual(titles, ["终端 1", "终端 2", "终端 3"]);
	assert.equal(new Set(titles).size, titles.length, "no two tabs answer to the same name");
});

test("attaching reaches the shell that is already there rather than starting one", () => {
	const { registry, spawned } = harness();

	const opened = registry.open("/work/app", 80, 24);
	const again = registry.attach(opened.id, 80, 24);

	assert.equal(spawned.length, 1, "no second shell was started");
	assert.equal(again?.pid, opened.pid, "and it is the same process");
});

test("attaching to a shell that is gone says so instead of quietly starting a new one", () => {
	const { registry, spawned } = harness();

	const opened = registry.open("/work/app", 80, 24);
	registry.kill(opened.id);

	assert.equal(registry.attach(opened.id, 80, 24), null);
	assert.equal(spawned.length, 1, "and nothing was spawned behind the caller's back");
});

test("a number is only reused once the tab holding it has gone", () => {
	const { registry } = harness();

	const first = registry.open("/work/app", 80, 24);
	registry.open("/work/app", 80, 24);
	registry.kill(first.id);

	assert.equal(registry.open("/work/app", 80, 24).title, "终端 1", "the free number came back");
});

test("detaching leaves the shell running — it is the pane that went away, not the terminal", () => {
	const { registry, spawned, terminals } = harness();

	const { id, epoch } = registry.open("/work/app", 80, 24);
	registry.detach(id, epoch);

	assert.equal(spawned[0].killed, false, "the shell is still running");
	assert.equal(terminals.size, 1, "and still on the books");
});

test("what the shell said while no pane was listening comes back on the next attach", () => {
	const { registry, spawned } = harness();

	const { id, epoch } = registry.open("/work/app", 80, 24);
	spawned[0].say("$ npm run build\r\n");
	registry.detach(id, epoch);
	// A long build carries on in a terminal nobody is looking at. That is the point of it.
	spawned[0].say("built in 12s\r\n");

	const again = registry.attach(id, 80, 24);
	assert.equal(again?.pid, spawned[0].pid, "same shell");
	assert.equal(again?.replay, "$ npm run build\r\nbuilt in 12s\r\n", "and everything it wrote, in order");
});

test("a shell that has just started has nothing to replay", () => {
	const { registry } = harness();
	assert.equal(registry.open("/work/app", 80, 24).replay, "");
});

test("a late detach from a pane that has already been replaced does not mute the shell", () => {
	/*
	 * React mounts, unmounts and remounts an effect in development, and the first mount's `attach`
	 * resolves after the second one has already connected. Its cleanup then detaches an id that
	 * something else is now listening to — and the shell went quiet, because output is only
	 * forwarded while a pane is attached. On screen that was a terminal that opened to nothing at
	 * all and never recovered.
	 *
	 * So a detach says which connection it is ending, and one that has been superseded is ignored.
	 */
	const { registry, terminals } = harness();

	const first = registry.open("/work/app", 80, 24);
	const second = registry.attach(first.id, 80, 24);
	assert.ok(second);
	registry.detach(first.id, first.epoch);

	assert.equal(terminals.get(first.id)?.attached, true, "the shell is still being listened to");

	registry.detach(second.id, second.epoch);
	assert.equal(terminals.get(first.id)?.attached, false, "and the current pane can still let go");
});

test("coming back tells the shell the size of the pane it came back to", () => {
	const { registry, spawned } = harness();

	const { id, epoch } = registry.open("/work/app", 80, 24);
	registry.detach(id, epoch);
	registry.attach(id, 120, 40);

	assert.deepEqual(spawned[0].sizes.at(-1), [120, 40]);
});

test("an attach that does not know the size yet leaves the shell at the size it had", () => {
	const { registry, spawned } = harness();

	const { id, epoch } = registry.open("/work/app", 80, 24);
	registry.detach(id, epoch);
	registry.attach(id, 0, 0);

	assert.deepEqual(spawned[0].sizes, [], "nothing was resized to a sliver on the way to finding out");
});

test("a shell that exits on its own stops being handed out", () => {
	const { registry, spawned, terminals } = harness();

	const { id } = registry.open("/work/app", 80, 24);
	spawned[0].quit(0);

	assert.equal(terminals.size, 0);
	assert.equal(registry.attach(id, 80, 24), null);
	assert.deepEqual(registry.list("/work/app"), [], "and the tab strip stops listing it");
});

test("killing is the one thing that ends a shell", () => {
	const { registry, spawned, terminals } = harness();

	const { id } = registry.open("/work/app", 80, 24);
	registry.kill(id);

	assert.equal(spawned[0].killed, true);
	assert.equal(terminals.size, 0);
});

test("making room never closes a tab of the project you are looking at", () => {
	const { registry, spawned, terminals } = harness();

	// Fifteen elsewhere, all idle, then the ceiling is reached from inside one project.
	for (let i = 0; i < 15; i++) {
		const opened = registry.open(`/other/${i}`, 80, 24);
		registry.detach(opened.id, opened.epoch);
	}
	const mine = registry.open("/work/app", 80, 24);
	registry.detach(mine.id, mine.epoch);
	registry.open("/work/app", 80, 24);

	assert.equal(spawned[0].killed, true, "an idle shell from another project went");
	assert.equal(terminals.has(mine.id), true, "the tab in this project stayed");
	// By identity, not by name: which numbers those two tabs carry depends on what else is running,
	// and the claim here is that neither of them was the one ended.
	assert.equal(registry.list("/work/app").length, 2, "so the strip kept both of its tabs");
});

test("the ceiling yields rather than close something the user can see", () => {
	const { registry, spawned, terminals } = harness();

	// Every shell alive is a tab of the project in front of you: none of them may be taken away.
	for (let i = 0; i < 17; i++) registry.open("/work/app", 80, 24);

	assert.equal(terminals.size, 17);
	assert.deepEqual(
		spawned.filter((pty) => pty.killed),
		[],
		"nothing on screen was ended underneath the user",
	);
});

test("output is capped, so a runaway shell cannot grow the main process without bound", () => {
	const { registry, spawned } = harness();

	const { id, epoch } = registry.open("/work/app", 80, 24);
	registry.detach(id, epoch);
	// 4MB of `yes`, well past the cap.
	for (let i = 0; i < 4096; i++) spawned[0].say("y\n".repeat(512));

	const replay = registry.attach(id, 80, 24)?.replay ?? "";
	assert.ok(replay.length <= 256 * 1024, `kept ${replay.length} bytes`);
	assert.ok(replay.length > 128 * 1024, "and still enough to redraw a screen from");
});

/*
 * Prewarming: the shell exists before the pane does.
 *
 * A shell needs roughly a third of a second to reach its prompt, and doing that when the pane opens
 * is what made opening the terminal a wait rather than an arrival. Starting one at launch moves the
 * wait to a moment nobody is looking at — but only if the prediction stays a prediction: it must
 * not push output at a renderer that has nothing to show it in, must not multiply when the app
 * returns to a directory it has already prepared, and must be the first thing given up for room.
 */

test("prewarming starts the shell, but nothing is forwarded to a pane that is not showing it", () => {
	const { registry, spawned, sent } = harness();

	registry.prewarm("/work/app", 80, 24);
	assert.equal(spawned.length, 1, "the shell is running");
	spawned[0].say("~ ❯ ");

	assert.deepEqual(sent, [], "and its prompt went to the recording, not to the window");
});

test("what a prewarmed shell said while nobody was watching is what makes opening it instant", () => {
	const { registry, spawned } = harness();

	registry.prewarm("/work/app", 80, 24);
	spawned[0].say("~ ❯ ");

	const [tab] = registry.list("/work/app");
	assert.ok(tab, "it is listed like any other shell");
	assert.equal(registry.attach(tab.id, 80, 24)?.replay, "~ ❯ ", "the prompt is already there to redraw");
	assert.equal(spawned.length, 1, "and attaching did not start a second one");
});

test("prewarming twice is free — a shell that is ready needs nothing", () => {
	const { registry, spawned } = harness();

	registry.prewarm("/work/app", 80, 24);
	registry.prewarm("/work/app", 80, 24);
	registry.prewarm("/work/app", 80, 24);

	assert.equal(spawned.length, 1, "one shell ahead of demand, never a queue of them");
});

test("a shell running anywhere is one the pane can open onto, so nothing more is predicted", () => {
	/*
	 * The strip shows every shell regardless of where it was started, so the gain prewarming exists
	 * for — a pane that opens onto a finished prompt — has already been had as soon as any shell is
	 * running. Predicting one per project would spawn a shell on every project change and buy
	 * nothing with it.
	 */
	const { registry, spawned } = harness();

	registry.open("/work/app", 80, 24);
	registry.prewarm("/work/docs", 80, 24);

	assert.equal(spawned.length, 1, "no shell was started for a project that needs none");
});

test("a shell the user opened is never replaced by a prediction", () => {
	const { registry, spawned } = harness();

	const opened = registry.open("/work/app", 80, 24);
	registry.prewarm("/work/app", 80, 24);

	assert.equal(spawned.length, 1);
	assert.deepEqual(
		registry.list("/work/app").map((tab) => tab.id),
		[opened.id],
		"prewarming yields to whatever is already there",
	);
});

test("a prediction is the first thing given up when the ceiling is reached", () => {
	const { registry, terminals, spawned } = harness();

	registry.prewarm("/idle/guess", 80, 24);
	const guess = spawned[0];
	// Fill the rest of the ceiling with shells of another project, all of them on screen.
	for (let i = 0; i < 15; i++) registry.open("/work/app", 80, 24);
	assert.equal(terminals.size, 16);

	registry.open("/work/other", 80, 24);

	assert.ok(guess.killed, "the unattached guess went, not a shell anyone is looking at");
	assert.equal(terminals.size, 16, "and the ceiling held");
});

/*
 * A terminal is not a view of the current project.
 *
 * Everything here used to be filed under the directory in front of you: the strip asked for the
 * current project's shells, so moving to another project swapped them for a different set and
 * moving to no project at all showed nothing — while every one of those shells carried on running
 * where nobody could reach it. Closing a folder in an editor does not close the build you are
 * watching, and this should not either.
 */

test("every shell is listed, wherever it was started — leaving a project does not hide it", () => {
	const { registry } = harness();

	registry.open("/work/app", 80, 24);
	registry.open("/work/docs", 80, 24);
	// The home shell, which is what "no project" resolves to.
	registry.open("", 80, 24);

	assert.equal(registry.listAll().length, 3, "the strip can reach all of them at once");
});

test("a shell started in a project is still there after moving to another", () => {
	const { registry } = harness();

	const inProject = registry.open("/work/app", 80, 24);
	// The window moves on: another project, then none at all. Neither touches what is running.
	registry.open("/work/docs", 80, 24);

	assert.ok(
		registry.listAll().some((tab) => tab.id === inProject.id),
		"the terminal you were using is still one of the tabs",
	);
	assert.equal(registry.attach(inProject.id, 80, 24)?.pid, inProject.pid, "and still the same shell");
});

test("data and exit events are silently ignored when window or webContents is destroyed", () => {
	const terminals = new Map();
	let dataHandler: ((data: string) => void) | undefined;
	let exitHandler: ((event: { exitCode: number }) => void) | undefined;
	let destroyed = false;

	const spawned = {
		pid: 1234,
		killed: false,
		write: () => {},
		resize: () => {},
		kill: () => {},
		onData: (fn: (d: string) => void) => {
			dataHandler = fn;
		},
		onExit: (fn: (e: { exitCode: number }) => void) => {
			exitHandler = fn;
		},
	};

	let sendCount = 0;
	const registry = createTerminalRegistry({
		terminals,
		spawnPty: () => spawned as never,
		insideAProject: () => true,
		eachWindow: (visit) =>
			visit({
				isDestroyed: () => destroyed,
				webContents: {
					isDestroyed: () => destroyed,
					send: () => {
						sendCount++;
					},
				},
			} as never),
	});

	const tab = registry.open("/work/app", 80, 24);
	assert.ok(tab);

	dataHandler?.("hello");
	assert.equal(sendCount, 1);

	// Destroy window and ensure events don't throw or send
	destroyed = true;
	assert.doesNotThrow(() => {
		dataHandler?.("world");
		exitHandler?.({ exitCode: 0 });
	});
	assert.equal(sendCount, 1);
});

test("starts in home when outside a project, and starts in the normalized project path when inside", () => {
	let spawnedCwd = "";
	const appPath = "/work/app";
	const outsidePath = "/other/dir";

	const projectRegistry = createTerminalRegistry({
		terminals: new Map(),
		spawnPty: (_file, _args, options) => {
			spawnedCwd = options.cwd as string;
			return {
				pid: 1234,
				onData: () => {},
				onExit: () => {},
				resize: () => {},
				write: () => {},
				kill: () => {},
			} as never;
		},
		projectPath: (target: string) => (target.startsWith(appPath) ? appPath : null),
		insideAProject: (target: string) => target.startsWith(appPath),
		eachWindow: () => {},
	});

	projectRegistry.open("/work/app/src", 80, 24);
	assert.equal(spawnedCwd, appPath);

	projectRegistry.open(outsidePath, 80, 24);
	assert.notEqual(spawnedCwd, outsidePath);
});
