import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bridgeScript } from "../../mobile/src/bridge.ts";
import { appUrlOf, type Connection } from "../../mobile/src/connection.ts";
import { call, evaluateRenderer, stopProcessGroup } from "./app.ts";

/** The actual mobile bridge and served renderer, in Chromium without the desktop preload. */
export async function startMobile(home: string, connection: Connection, port: number) {
	const preload = join(home, `phone-${port}.cjs`);
	const entry = join(home, `phone-host-${port}.cjs`);
	const profile = join(home, `phone-profile-${port}`);
	await mkdir(profile, { recursive: true });
	await writeFile(preload, bridgeScript(connection));
	/*
	 * Drawn even while covered. A phone window hidden behind whatever the person running the suite
	 * is doing stops producing frames, and every wait for the page then times out — five red tests
	 * that say nothing about the phone. The desktop app sets the same switches for its own window.
	 */
	await writeFile(entry, `const {app,BrowserWindow}=require("electron");
app.setPath('userData',${JSON.stringify(profile)});
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.whenReady().then(()=>{const win=new BrowserWindow({width:390,height:844,webPreferences:{preload:${JSON.stringify(preload)},contextIsolation:false,nodeIntegration:false,sandbox:false,backgroundThrottling:false}});win.loadURL(${JSON.stringify(appUrlOf(connection))});});
app.on('window-all-closed',()=>app.quit());`);
	const executable: unknown = createRequire(import.meta.url)("electron");
	if (typeof executable !== "string") throw new Error("Electron executable unavailable");
	const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
	const child = spawn(executable, [entry, `--remote-debugging-port=${port}`], { env, detached: true, stdio: "pipe" });
	let output = "";
	child.stderr.on("data", (data: Buffer) => { output += data.toString(); });
	try {
		let target: string | undefined;
		for (let i = 0; i < 100; i++) {
			const response = await fetch(`http://127.0.0.1:${port}/json/list`).catch(() => null);
			if (response?.ok) {
				const pages: { type: string; webSocketDebuggerUrl?: string }[] = await response.json();
				target = pages.find((page) => page.type === "page")?.webSocketDebuggerUrl;
			}
			if (target) break;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		if (!target) throw new Error(`Mobile renderer did not start: ${output}`);
		const url = target;
		return {
			evaluate: <T>(expression: string) => evaluateRenderer<T>(url, expression),
			send: <T>(method: string, params: Record<string, unknown> = {}) => call<T>(url, method, params),
			stop: () => stopProcessGroup(child),
		};
	} catch (error) { await stopProcessGroup(child); throw error; }
}
