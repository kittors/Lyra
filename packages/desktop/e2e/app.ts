/**
 * Starting the real app, and talking to the window it opens.
 *
 * Driven over the DevTools protocol rather than through a test framework: Electron already speaks
 * it, so this needs no driver, no browser download and no second way of describing a click.
 *
 * Shared by every end-to-end test, because "boot it and wait for the shell" has three failure
 * modes that each took a while to work out — a preview server that outlives the process you
 * killed, a window that exists before React has mounted into it, and a start that fails with no
 * explanation unless you kept what the app printed. Solving those once is the point of this file.
 *
 * One app at a time: `test:e2e` passes `--test-concurrency=1`. Each file here starts a real
 * Electron process, and three of them competing for a laptop produced timing failures in tests
 * that measure layout — which is the worst kind of red, since the code under test was fine.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const BOOT_TIMEOUT_MS = 90_000;

/**
 * Kill a detached Electron (or any child) and wait until it is actually gone.
 *
 * SIGTERM-and-forget is how a suite that had already passed hung CI for six hours: the mock
 * model server's `close()` waits for keep-alive sockets, those sockets belong to Electron, and
 * Electron was still alive. The test runner's stdio pipes to that process then keep the event
 * loop open, so the next file never starts (`--test-concurrency=1`) and GitHub's default job
 * timeout is 360 minutes.
 */
export async function stopProcessGroup(
	child: ChildProcess | undefined,
	graceMs = 3_000,
): Promise<void> {
	if (!child?.pid) return;
	const pid = child.pid;
	const exited = new Promise<void>((resolve) => {
		if (child.exitCode !== null || child.signalCode !== null) {
			resolve();
			return;
		}
		child.once("exit", () => resolve());
	});
	if (process.platform === "win32") {
		// Node's child.kill only terminates the parent on Windows; Electron owns renderer/GPU children.
		await new Promise<void>((resolve, reject) => {
			const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", timeout: 5_000 });
			killer.once("error", reject);
			killer.once("exit", (code) => {
				if (code !== 0 && child.exitCode === null && child.signalCode === null) {
					reject(new Error(`taskkill failed for test process ${pid} (exit ${code})`));
				} else resolve();
			});
		});
		await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 1_000))]);
		child.stdout?.destroy();
		child.stderr?.destroy();
		child.unref();
		return;
	}

	const signal = (sig: NodeJS.Signals) => {
		try {
			process.kill(-pid, sig);
		} catch {
			try {
				child.kill(sig);
			} catch {
				try {
					process.kill(pid, sig);
				} catch {
					/* already gone */
				}
			}
		}
	};
	signal("SIGTERM");
	await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, graceMs))]);
	signal("SIGKILL");
	await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 1_000))]);
	// If it still has not exited, drop the pipes so this process can finish anyway.
	child.stdout?.destroy();
	child.stderr?.destroy();
	child.unref();
}

/**
 * Close a mock HTTP server without waiting forever for Electron's keep-alive sockets.
 *
 * `server.close()` does not return until every connection is gone. Combined with a leaked
 * Electron that is the last client, that wait is unbounded — which is the hang `--test-timeout`
 * cannot see, because it lives in `after()`, not in a test.
 */
export async function closeListeningServer(
	server: {
		close: (cb?: (err?: Error) => void) => void;
		closeAllConnections?: () => void;
		unref?: () => void;
	} | undefined,
	ms = 2_000,
): Promise<void> {
	if (!server) return;
	try {
		server.closeAllConnections?.();
	} catch {
		/* already closing */
	}
	await Promise.race([
		new Promise<void>((resolve) => {
			server.close(() => resolve());
		}),
		new Promise<void>((resolve) => setTimeout(resolve, ms)),
	]);
	// Returning from the race is not enough: an unclosed server still holds the event loop.
	try {
		server.unref?.();
	} catch {
		/* already closed */
	}
}

export interface RunningApp {
	/** The profile directory the app was given, so a test can seed or inspect it. */
	home: string;
	/** One expression in the renderer. Promises are awaited; the value comes back by value. */
	evaluate<T>(expression: string): Promise<T>;
	/**
	 * One DevTools protocol call, for the things the page cannot do to itself.
	 *
	 * Resizing is the case this exists for. `window.resizeTo` is ignored for an ordinary Electron
	 * window, and the layout's breakpoints are driven by `window.innerWidth` — so without
	 * `Emulation.setDeviceMetricsOverride` the narrow layout is simply not reachable from a test,
	 * which would leave the half of the dock that only exists below 760px unverified.
	 */
	send<T>(method: string, params?: Record<string, unknown>): Promise<T>;
	stop(): Promise<void>;
}

/**
 * Boot the app on a profile of its own and wait until its shell has painted.
 *
 * `seed` runs after the profile directory is made and before the app starts, which is the only
 * window in which settings can be written for it to read at launch.
 */
export async function startApp({
	port,
	seed,
	scaleFactor,
}: {
	/** A port per test file: two suites running at once must not share a debugger. */
	port: number;
	seed?: (home: string) => Promise<void>;
	/** Exercise Chromium's actual DIP conversion, including native overlay geometry on Windows. */
	scaleFactor?: number;
}): Promise<RunningApp> {
	/*
	 * Refuse to start while something is already on this port.
	 *
	 * This is not tidiness, it is the difference between a test and a lie. The debugger port is how
	 * everything here reaches the app; a leftover instance from an earlier run holds it, the new
	 * Electron fails to bind — it says so on stderr and carries on running — and every probe then
	 * drives *the old process*, with the old code and the old profile directory. Green results,
	 * about a build that no longer exists. That happened, and it is why a set of fixes that passed
	 * here was broken the moment it was installed.
	 */
	await new Promise<void>((resolve, reject) => {
		const probe = createServer();
		probe.once("error", (error: NodeJS.ErrnoException) => {
			reject(
				new Error(
					error.code === "EADDRINUSE"
						? `调试端口 ${port} 已被占用——多半是上一次没退干净的实例。跑之前先清掉：\n` +
							`  pkill -f "node_modules/.pnpm/electron@.*--remote-debugging-port"\n` +
							`  pkill -f "electron-vite.js preview"`
						: `无法确认调试端口 ${port} 是否空闲：${error.message}`,
				),
			);
		});
		probe.listen(port, "127.0.0.1", () => probe.close(() => resolve()));
	});

	/** Kept so a failure to start can show what the app said on its way down. */
	const output: string[] = [];

	/*
	 * The built bundle when `LYRA_E2E_APP` names one, and the built development app otherwise.
	 *
	 * They are not the same program in the ways that have bitten hardest. A packaged build runs out
	 * of an asar, resolves `app.getAppPath()` somewhere else entirely, and has whatever
	 * `electron-builder.yml` decided to include rather than the whole source tree — which is how a
	 * dock icon can be found in development and missing in the app people install. Testing the
	 * thing that ships is the only way to see that class of fault.
	 */
	const bundle = process.env.LYRA_E2E_APP;
	const entry = join(ROOT, "out", "main", "index.js");
	if (!bundle) {
		await access(entry).catch((cause: unknown) => {
			throw new Error("Build the desktop app with pnpm build before running Electron e2e tests", { cause });
		});
	}
	const electron: unknown = bundle ? join(bundle, "Contents", "MacOS", "Lyra") : createRequire(import.meta.url)("electron");
	if (typeof electron !== "string") throw new Error("Electron's executable path is unavailable");
	const executable = electron;
	const argv = bundle
		? [`--remote-debugging-port=${port}`]
		// Keep app.getAppPath() at the package root, exactly as electron-vite's `electron .` does.
		: [ROOT, `--remote-debugging-port=${port}`];
	if (scaleFactor !== undefined) argv.push(`--force-device-scale-factor=${scaleFactor}`);

	// Validate the executable before creating a profile, so failed setup leaves no test data.
	const home = await mkdtemp(join(tmpdir(), "lyra-e2e-"));
	try {
		await seed?.(home);
	} catch (error) {
		await rm(home, { recursive: true, force: true });
		throw error;
	}

	/*
	 * Its own process group.
	 *
	 * Launch the binary directly: Windows cannot spawn a pnpm.cmd shim without a shell, and
	 * electron-vite preview silently rebuilds per suite instead of testing the requested build.
	 */
	const app: ChildProcess = spawn(executable, argv, {
		cwd: ROOT,
		env: { ...process.env, LYRA_HOME: home, ELECTRON_ENABLE_LOGGING: "1" },
		stdio: "pipe",
		detached: true,
	});
	const record = (chunk: Buffer) => {
		output.push(chunk.toString());
		if (process.env.DEBUG_E2E) process.stdout.write(chunk);
	};
	app.stdout?.on("data", record);
	app.stderr?.on("data", record);
	app.on("error", (error) => output.push(`spawn failed: ${error.message}`));

	let target: string;
	try {
		target = await waitForWindow(port, output);
	} catch (error) {
		await stopProcessGroup(app);
		await rm(home, { recursive: true, force: true });
		throw error;
	}
	const evaluate = <T>(expression: string) =>
		call<T>(target, "Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
			userGesture: true,
		}).then((result) => {
			const answer = result as { exceptionDetails?: { text: string }; result?: { value: T } };
			if (answer.exceptionDetails) throw new Error(answer.exceptionDetails.text);
			return answer.result?.value as T;
		});
	try {
		await waitForShell(evaluate);
	} catch (error) {
		await stopProcessGroup(app);
		await rm(home, { recursive: true, force: true });
		throw error;
	}

	return {
		home,
		evaluate,
		send: <T>(method: string, params?: Record<string, unknown>) => call<T>(target, method, params ?? {}),
		stop: async () => {
			await stopProcessGroup(app);
			await rm(home, { recursive: true, force: true }).catch(() => {});
		},
	};
}

async function waitForWindow(port: number, output: string[]): Promise<string> {
	const deadline = Date.now() + BOOT_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const targets = await fetch(`http://127.0.0.1:${port}/json/list`)
			.then((r) => r.json() as Promise<{ title: string; type: string; webSocketDebuggerUrl?: string }[]>)
			.catch(() => null);
		const page = targets?.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
		if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
		await new Promise((r) => setTimeout(r, 500));
	}
	/*
	 * What it printed, not just that it never appeared.
	 *
	 * The first CI run of this failed with "no window after 90s" and nothing else, which says
	 * only that something went wrong somewhere — the app's own output is the whole diagnosis.
	 */
	throw new Error(
		`no window after ${BOOT_TIMEOUT_MS / 1000}s. What the app printed:\n${output.join("").slice(-4000) || "(nothing)"}`,
	);
}

/**
 * The window exists well before React has mounted into it.
 *
 * Asserting straight after the target appears tests how fast the machine is, not whether the app
 * works — so this waits for the shell to be there, and says what it did see if it never arrives.
 */
async function waitForShell(evaluate: <T>(expression: string) => Promise<T>): Promise<void> {
	const deadline = Date.now() + BOOT_TIMEOUT_MS;
	let last = "";
	while (Date.now() < deadline) {
		const state = await evaluate<{ shell: boolean; body: string }>(
			`({ shell: Boolean(document.querySelector(".ly-shell")), body: document.body.innerText.slice(0, 120) })`,
		).catch(() => null);
		if (state?.shell) return;
		last = state?.body ?? "(no answer from the renderer)";
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(`the shell never rendered. What was on screen:\n${last}`);
}

/** One call, one socket. Slower than keeping it open, and far easier to reason about. */
async function call<T>(target: string, method: string, params: Record<string, unknown>): Promise<T> {
	const socket = new WebSocket(target);
	try {
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				socket.close();
				reject(new Error(`${method} open timed out`));
			}, 10_000);
			socket.addEventListener(
				"open",
				() => {
					clearTimeout(timer);
					resolve();
				},
				{ once: true },
			);
			socket.addEventListener(
				"error",
				() => {
					clearTimeout(timer);
					reject(new Error(`${method} socket error`));
				},
				{ once: true },
			);
		});
		const answer = new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 40_000);
			socket.addEventListener("message", (event) => {
				const message = JSON.parse(String(event.data));
				if (message.id !== 1) return;
				clearTimeout(timer);
				if (message.error) reject(new Error(`${method}: ${message.error.message}`));
				else resolve(message.result as T);
			});
			// Generous, because a test that waits out a toast's lifetime is one expression that
			// deliberately takes ten seconds — and a timeout shorter than that would call it a
			// failure rather than a wait.
		});
		socket.send(JSON.stringify({ id: 1, method, params }));
		return await answer;
	} finally {
		socket.close();
	}
}
