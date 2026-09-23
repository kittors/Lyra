/**
 * The embedded terminal.
 *
 * A pty per project directory, and — the part worth reading — one that outlives the pane showing
 * it. The pane comes and goes constantly: closing it, switching to a conversation whose layout
 * does not include it, or making another pane full screen all unmount it. Tying the shell's life
 * to the pane meant every one of those killed it, so coming back gave you a new shell in the same
 * place: no history, no running process, no half-typed command. That reads as the terminal
 * restarting itself, and next to a real terminal emulator — where a window you are not looking at
 * keeps running — it reads as broken.
 *
 * So the renderer attaches and detaches, and only `kill` ends anything. Detaching keeps the shell
 * running and keeps recording what it writes, and the next attach replays that recording into the
 * fresh xterm, which redraws to exactly what was on screen before.
 *
 * Several can be running at once, which is what the pane's tabs are: `open` always starts a new
 * one, `listAll` reports every shell there is, and `attach` connects to one by id. A shell is
 * started *in* a directory but not filed under it — leaving a project does not hide a terminal that
 * is still running. `prewarm` starts the first one before anybody asks, which is what makes opening
 * the pane instant rather than a third of a second of empty rectangle.
 *
 * Windows are enumerated at delivery time: detached panes keep receiving output even while a
 * different app window has keyboard focus, and destroyed renderers never remain recipients.
 *
 * No Electron values are imported here, only types — so this can be driven straight from a test,
 * which is where every claim above is checked.
 */

import type { BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { win32 } from "node:path";
import type { IPty } from "node-pty";
import { envValue, findExecutable } from "./find-executable.ts";

/**
 * One shell, and enough of what it has said to redraw it.
 *
 * `attached` is whether a pane is currently listening. A detached shell keeps running and keeps
 * filling `scrollback`; it simply stops being forwarded to a renderer that has nothing to do with
 * it yet.
 */
export interface LiveTerminal {
	pty: IPty;
	cwd: string;
	attached: boolean;
	/** What the tab is called. Numbered across every shell, and kept when its neighbours close. */
	title: string;
	/** Raw output, in the chunks it arrived in, capped by `SCROLLBACK_BYTES`. */
	scrollback: string[];
	bytes: number;
	/**
	 * A counter, not a clock: which shell was returned to most recently.
	 *
	 * `Date.now()` cannot separate two attaches in the same millisecond, which made "retire the
	 * one idle longest" a coin toss between them — and would have gone wrong in the same way if
	 * the system clock ever stepped backwards.
	 */
	touched: number;
	/**
	 * Which connection is the current one.
	 *
	 * Bumped by every attach, and quoted back by `detach`. React mounts an effect twice in
	 * development, and the first mount's cleanup lands after the second has already connected —
	 * without this, that stale cleanup detached a shell somebody was listening to and the terminal
	 * went silent for good.
	 */
	epoch: number;
	/** Concurrent views identify both their connection and its renderer for crash cleanup. */
	connections: Map<number, number>;
}

/** One shell in a directory, as the tab strip lists it. */
export interface TerminalTab {
	id: string;
	title: string;
}

/** What a pane gets back when it connects. */
export interface Attached {
	id: string;
	title: string;
	pid: number;
	/** This connection's number, to be quoted back to `detach`. */
	epoch: number;
	/** Everything the shell has written, for redrawing a pane that came back. */
	replay: string;
}

export interface TerminalDeps {
	terminals: Map<string, LiveTerminal>;
	spawnPty: (file: string, args: string[], options: Record<string, unknown>) => IPty;
	projectPath?(target: string): string | null;
	insideAProject(target: string): boolean;
	eachWindow(visit: (window: BrowserWindow) => void): void;
	/** The machine's own, unless a test is standing in for Windows. */
	platform?: string;
	env?: NodeJS.ProcessEnv;
	findExecutable?: (command: string) => string | null;
}

/**
 * The shell a new terminal runs.
 *
 * On Windows `SHELL` is set only by something POSIX-flavoured — Git Bash, MSYS2, Cygwin — and it
 * holds that world's path, `/usr/bin/bash`. Launched from Git Bash, Lyra passed that to node-pty,
 * ConPTY could not open it, and no terminal ever started. So on Windows `SHELL` counts only when it
 * is a Windows path to a file that exists; otherwise it is PowerShell 7, then Windows PowerShell
 * (found in System32 even when PATH does not list it), then `%ComSpec%` — which is always there.
 */
export function pickShell(platform: string, env: NodeJS.ProcessEnv, find: (command: string) => string | null): string {
	const declared = env.SHELL?.trim();
	if (platform !== "win32") return declared || "/bin/bash";
	if (declared && /^(?:[a-zA-Z]:[\\/]|\\\\)/.test(declared) && find(declared)) return declared;
	const systemRoot = envValue(env, "SystemRoot", platform);
	const inbox = systemRoot ? win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : null;
	return find("pwsh.exe") ?? find("powershell.exe") ?? (inbox ? find(inbox) : null) ?? envValue(env, "ComSpec", platform) ?? "cmd.exe";
}

/**
 * How much output is kept for redrawing a pane that comes back.
 *
 * Enough for a screen of a long build's output several times over, and small enough that a shell
 * left running `yes` overnight cannot grow the main process without bound. Whole chunks are
 * dropped rather than bytes, because half an escape sequence replays as garbage.
 */
const SCROLLBACK_BYTES = 256 * 1024;

/**
 * How many shells may be alive at once, across every project.
 *
 * They survive their panes, so without a ceiling a week of moving between projects would leave
 * dozens running. When the ceiling is reached it is another project's idle shell that goes: the
 * tabs of the project in front of you are a thing you opened deliberately, and closing one of
 * those to make room for another would be the app taking away work you can see.
 */
const MAX_TERMINALS = 16;

/** Ticks once per attach, so "used most recently" is an order rather than a timestamp. */
let clock = 0;

/**
 * The behaviour, with no Electron in it.
 *
 * Separated from the IPC handlers in `ipc/terminal.ts` so it can be driven directly: which shell an attach lands
 * on, what a detach leaves running and which one gets retired are the whole point of this file,
 * and they are decided here rather than in a message handler.
 */
export function createTerminalRegistry({ terminals, spawnPty, projectPath, insideAProject, eachWindow, ...host }: TerminalDeps) {
	const platform = host.platform ?? process.platform;
	const env = host.env ?? process.env;
	const find = host.findExecutable ?? ((command: string) => findExecutable(command, { platform, env }));
	/** Where a terminal for this path actually starts: the project, or home if it is not one. */
	// `homedir()`, not `process.env.HOME`: Windows spells it `USERPROFILE` and leaves `HOME` unset,
	// so reading the variable there fell through to the process's own directory.
	const resolve = (cwd: string): string => {
		if (projectPath) {
			const resolved = projectPath(cwd);
			if (resolved) return resolved;
		} else if (insideAProject(cwd)) {
			return cwd;
		}
		return homedir();
	};

	/** Every shell this directory has, in the order they were opened. */
	const list = (cwd: string): TerminalTab[] =>
		[...terminals]
			.filter(([, live]) => live.cwd === resolve(cwd))
			.map(([id, live]) => ({ id, title: live.title }));

	/**
	 * Every shell there is, whatever directory it was started in.
	 *
	 * What the pane's tab strip shows. Shells are still *started* somewhere — a new one opens in the
	 * project you are in, or in home when you are in none — but they are not filed under it: leaving
	 * a project is not a reason to stop showing a terminal that is running, any more than closing a
	 * folder in an editor closes the terminal you were building in. The strip used to be keyed by
	 * the current project, so changing projects swapped it for a different set and moving to no
	 * project at all emptied it, while every one of those shells carried on running unseen.
	 */
	const listAll = (): TerminalTab[] => [...terminals].map(([id, live]) => ({ id, title: live.title }));

	/**
	 * Start another shell here.
	 *
	 * Always a new one — this is what the tab strip's `+` does. Joining an existing shell is
	 * `attach`, and which of them a freshly opened pane wants is the pane's decision.
	 *
	 * `attached` is false only for `prewarm`: a shell nobody has asked to see yet must not have its
	 * output forwarded to a pane that is not showing it, and must stay eligible for `retireIdle`.
	 * It still records everything, which is the entire point — the first attach replays it.
	 */
	const open = (cwd: string, cols: number, rows: number, attached = true): Attached => {
		const dir = resolve(cwd);
		retireIdle(terminals, dir);

		const id = randomUUID();
		const shell = pickShell(platform, env, find);
		const child = spawnPty(shell, [], {
			name: "xterm-256color",
			cols: Math.max(2, cols),
			rows: Math.max(2, rows),
			cwd: dir,
			// TERM is what makes a shell emit colour and use cursor addressing at all.
			env: { ...env, TERM: "xterm-256color" } as Record<string, string>,
		});

		const live: LiveTerminal = {
			pty: child,
			cwd: dir,
			title: nextTitle(terminals),
			attached,
			scrollback: [],
			bytes: 0,
			touched: ++clock,
			epoch: 1,
			connections: new Map(),
		};

		child.onData((data) => {
			live.scrollback.push(data);
			live.bytes += data.length;
			while (live.bytes > SCROLLBACK_BYTES && live.scrollback.length > 1) {
				live.bytes -= live.scrollback.shift()?.length ?? 0;
			}
			if (live.attached) eachWindow((win) => {
				if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send("terminal:data", { id, data });
			});
		});
		child.onExit(({ exitCode }) => {
			terminals.delete(id);
			eachWindow((win) => {
				if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send("terminal:exit", { id, code: exitCode });
			});
		});
		terminals.set(id, live);
		return { id, title: live.title, pid: child.pid, epoch: 1, replay: "" };
	};

	/**
	 * Have this directory's first shell running before anyone opens the pane.
	 *
	 * A shell takes about a third of a second to reach its prompt — spawn is immediate, the rest is
	 * the login files and whatever the prompt itself shells out to. Started when the pane opens,
	 * that third of a second is the pane: an empty rectangle, then a prompt. Started at launch, the
	 * prompt is already in `scrollback` and the first attach replays it in one frame, which is the
	 * difference between a terminal that opens and a terminal that is simply there.
	 *
	 * Idempotent, and deliberately only ever the first shell in the app: the strip shows every shell
	 * regardless of where it was started, so one already running is one the pane can open onto
	 * instantly — there is nothing to gain by predicting a second. The strip's `+` is a shell the
	 * user asked for while watching, where a moment of starting is legible rather than a stall.
	 *
	 * Unattached, so this cannot cost anything that is on screen — `retireIdle` may take it back if
	 * sixteen shells are somehow alive, and a prediction is the right thing to lose first.
	 */
	const prewarm = (cwd: string, cols: number, rows: number): void => {
		if (terminals.size > 0) return;
		open(cwd, cols, rows, false);
	};

	/**
	 * Connect a pane to a shell that already exists.
	 *
	 * Returns what the pane needs to redraw itself: everything the shell has written, and an
	 * `epoch` identifying this particular connection, to be handed back to `detach`. `null` if
	 * that shell is gone — it may have exited while the pane was away, and the pane decides what
	 * to do about that rather than being handed a surprise new shell.
	 */
	const attach = (id: string, cols: number, rows: number, owner = 0): Attached | null => {
		const live = terminals.get(id);
		if (!live) return null;

		live.attached = true;
		live.touched = ++clock;
		live.epoch++;
		live.connections.set(live.epoch, owner);
		/*
		 * The pane it left is not the pane it came back to: the dock may have resized in between,
		 * and a shell told nothing wraps every line to a width that is no longer there. A caller
		 * that does not know the size yet passes nothing and is not allowed to shrink the shell to
		 * a sliver on its way to finding out.
		 */
		if (cols > 0 && rows > 0) {
			try {
				live.pty.resize(Math.max(2, cols), Math.max(2, rows));
			} catch {}
		}
		return { id, title: live.title, pid: live.pty.pid, epoch: live.epoch, replay: live.scrollback.join("") };
	};

	/**
	 * The pane has gone, the shell has not.
	 *
	 * Output carries on being recorded so the next attach can redraw it; it just stops being sent
	 * to a renderer with nothing to show it in.
	 *
	 * One view leaving cannot silence another view of the same shell.
	 */
	const detach = (id: string, epoch: number): void => {
		const live = terminals.get(id);
		if (!live) return;
		const removed = live.connections.delete(epoch);
		if (removed || live.epoch === epoch) live.attached = live.connections.size > 0;
	};

	/** A renderer crash or close does not run its React effect cleanup. */
	const detachOwner = (owner: number): void => {
		for (const [id, live] of terminals) {
			for (const [epoch, connectedOwner] of live.connections) {
				if (connectedOwner === owner) detach(id, epoch);
			}
		}
	};

	/**
	 * Send keystrokes to a shell that may already have stopped listening.
	 *
	 * `terminals` is cleaned up in `onExit`, so an id that names a finished shell is normally gone
	 * by the time anything writes to it — but there is a window between the shell closing its end
	 * of the pipe and that event arriving, and a write landing in it fails with `EPIPE`. The
	 * renderer keeps typing into a pane that has not yet been told its shell is over, so the window
	 * is not theoretical: exiting a shell and pressing a key was enough.
	 *
	 * Unhandled, that reached the top of the main process and Electron put up "A JavaScript error
	 * occurred in the main process" over the whole app — a modal crash report for the least
	 * consequential failure there is. Nothing is lost by dropping the write: there is no longer
	 * anything on the other end to receive it.
	 *
	 * `resize` beside this has said the same thing for its own reason since it was written.
	 */
	const write = (id: string, data: string): void => {
		try {
			terminals.get(id)?.pty.write(data);
		} catch {}
	};

	const resize = (id: string, cols: number, rows: number): void => {
		// A zero dimension is fatal to the pty; the renderer can briefly report one mid-layout.
		try {
			terminals.get(id)?.pty.resize(Math.max(2, cols), Math.max(2, rows));
		} catch {}
	};

	const kill = (id: string): void => {
		// Killing something that has already died is not a failure worth propagating; the point of
		// the call is that the shell is gone afterwards, and it is.
		try {
			terminals.get(id)?.pty.kill();
		} catch {}
		terminals.delete(id);
	};

	return { list, listAll, open, prewarm, attach, detach, detachOwner, write, resize, kill };
}


/**
 * Make room, without touching the project in front of you.
 *
 * Candidates are idle shells belonging to some other directory, oldest first. If there are none —
 * everything alive is either on screen or a tab of the current project — the ceiling yields. A
 * shell the user opened and can see is not a leak, and ending one to satisfy a number would be
 * the app closing a tab behind their back.
 */
function retireIdle(terminals: Map<string, LiveTerminal>, keep: string): void {
	while (terminals.size >= MAX_TERMINALS) {
		let oldest: [string, LiveTerminal] | null = null;
		for (const entry of terminals) {
			if (entry[1].attached || entry[1].cwd === keep) continue;
			if (!oldest || entry[1].touched < oldest[1].touched) oldest = entry;
		}
		if (!oldest) return;
		oldest[1].pty.kill();
		terminals.delete(oldest[0]);
	}
}

/**
 * `终端 1`, `终端 2`, … never reusing a number a live tab still has.
 *
 * Across every shell, not per directory. The strip shows all of them side by side, so numbering
 * within a directory produced two tabs both called 「终端 1」 the moment a shell was started
 * somewhere else — a strip whose entire job is to let you pick one by name.
 */
function nextTitle(terminals: Map<string, LiveTerminal>): string {
	const taken = new Set([...terminals.values()].map((live) => live.title));
	for (let n = 1; ; n++) {
		const title = `终端 ${n}`;
		if (!taken.has(title)) return title;
	}
}
