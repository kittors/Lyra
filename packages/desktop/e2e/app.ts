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
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
		try {
			const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; output: string }>((resolve, reject) => {
				const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], timeout: 5_000 });
				let output = "";
				const record = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-8_000); };
				killer.stdout.on("data", record); killer.stderr.on("data", record);
				killer.once("error", reject);
				killer.once("close", (code, signal) => resolve({ code, signal, output }));
			});
			// Windows queues each process exit independently; taskkill can close before the target's notification.
			await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 1_000))]);
			if (result.code !== 0 && child.exitCode === null && child.signalCode === null) {
				throw new Error(`taskkill failed for test process ${pid} (exit ${result.code}, signal ${result.signal}): ${result.output}`);
			}
		} finally {
			// A failed process-tree kill must still release the runner's own pipe handles.
			child.stdin?.destroy(); child.stdout?.destroy(); child.stderr?.destroy(); child.unref();
		}
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
/**
 * How a Lyra instance is launched, for the tests that start a second one themselves.
 *
 * The binary directly, never `electron-vite preview`: Windows cannot spawn a `pnpm.cmd` shim
 * without a shell, and preview silently rebuilds instead of running the build under test. The
 * rebuild is what made `single-instance` fail — a second copy spawned through preview spends
 * longer compiling than the test is willing to wait, so it was timing the bundler and reporting
 * a lost lock.
 *
 * `port` is optional because a copy expected to exit on the single-instance lock never gets far
 * enough to open a debugging port, and giving it the first one's would be a second conflict.
 */
export function electronLaunch(port?: number): { executable: string; argv: string[] } {
	const bundle = process.env.LYRA_E2E_APP;
	const electron: unknown = bundle ? join(bundle, "Contents", "MacOS", "Lyra") : createRequire(import.meta.url)("electron");
	if (typeof electron !== "string") throw new Error("Electron's executable path is unavailable");
	// Keep app.getAppPath() at the package root, exactly as electron-vite's `electron .` does.
	const argv = bundle ? [] : [ROOT];
	if (port !== undefined) argv.push(`--remote-debugging-port=${port}`);
	return { executable: electron, argv };
}

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
	const { executable, argv } = electronLaunch(port);
	if (scaleFactor !== undefined) argv.push(`--force-device-scale-factor=${scaleFactor}`);

	// Validate the executable before creating a profile, so failed setup leaves no test data.
	const home = await mkdtemp(join(tmpdir(), "lyra-e2e-"));
	try {
		await seed?.(home);
		const settingsPath = join(home, "settings.json");
		const raw = await readFile(settingsPath, "utf8").catch((error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return "{}";
			throw error;
		});
		const settings: unknown = JSON.parse(raw);
		if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new Error("E2E settings must be an object");
		const appearance = "appearance" in settings ? settings.appearance : {};
		if (!appearance || typeof appearance !== "object" || Array.isArray(appearance)) throw new Error("E2E appearance must be an object");
		// Text and animation assertions share defaults across runners; explicit fixtures still win.
		await writeFile(settingsPath, JSON.stringify({ uiLocale: "zh-CN", ...settings, appearance: { reduceMotion: "off", ...appearance } }));
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
	const childEnv: NodeJS.ProcessEnv = { ...process.env, LYRA_HOME: home, ELECTRON_ENABLE_LOGGING: "1" };
	// The app may run node --test itself; inheriting this suppresses every nested test.
	delete childEnv.NODE_TEST_CONTEXT;
	const app: ChildProcess = spawn(executable, argv, {
		cwd: ROOT,
		env: childEnv,
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
	const evaluate = <T>(expression: string) => evaluateRenderer<T>(target, expression);
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

/** Desktop and mobile evaluations share the same remote-handle lifetime. */
export function evaluateRenderer<T>(target: string, expression: string): Promise<T> {
	return withConnection(target, async (send) => {
		type Answer = { exceptionDetails?: { exception?: { description?: string }; text: string }; result?: { value: T; objectId?: string; subtype?: string } };
		const objectGroup = "lyra-e2e-evaluation";
		try {
			// V8 bug 536271637: awaitPromise alone holds a weak reference in Electron 43's V8.
			// A remote handle owns the result until this same connection has awaited and released it.
			let answer = await send<Answer>("Runtime.evaluate", {
				expression, objectGroup, awaitPromise: false, returnByValue: false, userGesture: true,
			});
			if (!answer.exceptionDetails && answer.result?.objectId && answer.result.subtype !== "promise") {
				// An async identity preserves awaitPromise's thenable assimilation as well as objects.
				answer = await send<Answer>("Runtime.callFunctionOn", {
					objectId: answer.result.objectId, functionDeclaration: "async function() { return this; }",
					objectGroup, returnByValue: false, userGesture: true,
				});
			}
			if (!answer.exceptionDetails && answer.result?.objectId) {
				answer = await send<Answer>("Runtime.awaitPromise", {
					promiseObjectId: answer.result.objectId, returnByValue: true,
				});
			}
			if (answer.exceptionDetails) {
				const { text, exception } = answer.exceptionDetails;
				throw new Error(exception?.description ? `${text}\n${exception.description}` : text);
			}
			return answer.result?.value as T;
		} finally {
			await send("Runtime.releaseObjectGroup", { objectGroup });
		}
	});
}

/** A raw protocol call, also used by the mobile renderer without the desktop preload. */
export function call<T>(target: string, method: string, params: Record<string, unknown>): Promise<T> {
	return withConnection(target, (send) => send<T>(method, params));
}

/** One operation, one socket: remote handles belong to the session that created them. */
async function withConnection<T>(target: string, operation: (send: <R>(method: string, params: Record<string, unknown>) => Promise<R>) => Promise<T>): Promise<T> {
	const socket = new WebSocket(target);
	try {
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				socket.close();
				reject(new Error("CDP connection open timed out"));
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
					reject(new Error("CDP connection socket error"));
				},
				{ once: true },
			);
		});
		let nextId = 0;
		return await operation(<R>(method: string, params: Record<string, unknown>) => {
			const id = ++nextId;
			return new Promise<R>((resolve, reject) => {
				const onMessage = (event: MessageEvent) => {
					const message = JSON.parse(String(event.data));
					if (message.id !== id) return;
					clearTimeout(timer);
					socket.removeEventListener("message", onMessage);
					if (message.error) reject(new Error(`${method}: ${message.error.message}`));
					else resolve(message.result as R);
				};
				// A toast-lifetime assertion intentionally awaits ten seconds in one evaluation.
				const timer = setTimeout(() => {
					socket.removeEventListener("message", onMessage);
					reject(new Error(`${method} timed out`));
				}, 40_000);
				socket.addEventListener("message", onMessage);
				socket.send(JSON.stringify({ id, method, params }));
			});
		});
	} finally {
		socket.close();
	}
}
