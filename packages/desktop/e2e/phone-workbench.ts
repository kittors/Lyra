/* oxlint-disable no-console -- probe CLI plumbing that prints what it found */
/**
 * A phone interface that stays up while it is being worked on.
 *
 * `start` boots a desktop with sync on and the real mobile bridge against it (`mobile-app.ts`), with
 * the safe-area numbers the native shell would inject written into the phone's preload — so a reload
 * after `pnpm build` shows the new renderer with the same chrome, no restart. The other commands talk
 * to that phone over its DevTools port, each sizing it as a phone first.
 *
 *   node --experimental-strip-types e2e/phone-workbench.ts start [android|iphone] [dark|light]
 *   node --experimental-strip-types e2e/phone-workbench.ts shot <name>
 *   node --experimental-strip-types e2e/phone-workbench.ts eval '<expression>'
 *   node --experimental-strip-types e2e/phone-workbench.ts tap '<selector>' [index]
 *   node --experimental-strip-types e2e/phone-workbench.ts hold '<selector>' [index]
 *   node --experimental-strip-types e2e/phone-workbench.ts swipe x1 y1 x2 y2
 *   node --experimental-strip-types e2e/phone-workbench.ts reload
 */

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { insetScript } from "../../mobile/src/shell-insets.ts";
import { bootPhone, DEVICES, type Device } from "./phone-fixture.ts";
import { frameGrabber } from "./record.ts";

const PHONE_PORT = 9849;
const SYNC_PORT = 4713;
const TOKEN = "phone-workbench-isolated-token";
const OUT = process.env.LYRA_SHOTS ?? join(homedir(), "Desktop", "Lyra手机界面测试");
const STATE = join(homedir(), ".cache", "lyra-phone-workbench.json");


const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function start(device: Device, theme: "dark" | "light") {
	const { desktop, phone, stop: shut } = await bootPhone({ desktopPort: 9845, phonePort: PHONE_PORT, syncPort: SYNC_PORT, token: TOKEN, theme });
	// The shell's numbers, from before the first script on every load — as `desk.tsx` injects them.
	await appendFile(join(desktop.home, `phone-${PHONE_PORT}.cjs`), `\n${insetScript(DEVICES[device].insets)}\n`);
	await mkdir(join(homedir(), ".cache"), { recursive: true });
	await writeFile(STATE, JSON.stringify({ device, home: desktop.home }));
	await phone.evaluate("location.reload()").catch(() => {});
	console.log("READY", desktop.home);
	const stop = async () => {
		await shut();
		process.exit(0);
	};
	process.on("SIGINT", () => void stop());
	process.on("SIGTERM", () => void stop());
	await new Promise(() => {});
}

async function connect() {
	const state = JSON.parse(await readFile(STATE, "utf8")) as { device: Device };
	const screen = DEVICES[(process.env.LYRA_DEVICE as Device | undefined) ?? state.device];
	const g = await frameGrabber(PHONE_PORT);
	await g.send("Emulation.setDeviceMetricsOverride", { width: screen.width, height: screen.height, deviceScaleFactor: 3, mobile: true });
	await g.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
	if (process.env.LYRA_DEVICE) await g.evaluate(insetScript(screen.insets));
	return g;
}

async function point(g: Awaited<ReturnType<typeof frameGrabber>>, selector: string, index: number) {
	// On screen only: the drawer keeps its buttons laid out off the left edge while it is shut.
	const p = await g.evaluate<{ x: number; y: number } | null>(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((e) => { if (!e.checkVisibility({ visibilityProperty: true }) || e.closest("[inert]")) return false; const r = e.getBoundingClientRect(); const x = r.x + r.width / 2, y = r.y + r.height / 2; return x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight; })[${index}]; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
	if (!p) throw new Error(`nothing at ${selector} [${index}]`);
	return p;
}

async function main() {
	const [command, ...args] = process.argv.slice(2);
	if (command === "start") return start((args[0] as Device | undefined) ?? "android", args[1] === "light" ? "light" : "dark");
	const g = await connect();
	try {
		if (command === "shot") {
			await sleep(Number(process.env.LYRA_SETTLE ?? 700));
			const { data } = await g.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
			await mkdir(OUT, { recursive: true });
			const file = join(OUT, `${args[0]}.png`);
			await writeFile(file, Buffer.from(data, "base64"));
			console.log(file);
		} else if (command === "eval") {
			console.log(JSON.stringify(await g.evaluate(args[0]), null, 1));
		} else if (command === "tap" || command === "hold") {
			const p = await point(g, args[0], Number(args[1] ?? 0));
			await g.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p] });
			await sleep(command === "hold" ? 700 : 60);
			await g.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
			console.log(command, JSON.stringify(p));
		} else if (command === "swipe") {
			const [x1, y1, x2, y2] = args.map(Number);
			const steps = Number(args[4] ?? 12);
			const pause = Number(args[5] ?? 16);
			await g.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x1, y: y1 }] });
			for (let i = 1; i <= steps; i++) {
				await sleep(pause);
				await g.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x1 + ((x2 - x1) * i) / steps, y: y1 + ((y2 - y1) * i) / steps }] });
			}
			await sleep(pause);
			await g.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
		} else if (command === "key") {
			const key = args[0];
			const code = key === "Escape" ? 27 : key === "Enter" ? 13 : 0;
			await g.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code: key, windowsVirtualKeyCode: code });
			await g.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: code });
		} else if (command === "type") {
			await g.send("Input.insertText", { text: args[0] });
		} else if (command === "reload") {
			await g.evaluate("location.reload()").catch(() => {});
			g.close();
			for (let i = 0; i < 200; i++) {
				await sleep(150);
				const h = await frameGrabber(PHONE_PORT).catch(() => null);
				const ok = await h?.evaluate<boolean>("!!document.querySelector('.ly-shell') && !!document.querySelector('main textarea')").catch(() => false);
				h?.close();
				if (ok) break;
			}
			console.log("reloaded");
			return;
		} else throw new Error(`unknown command ${command}`);
	} finally {
		g.close();
	}
}

main().then(() => {
	if (process.argv[2] !== "start") process.exit(0);
}, (error: unknown) => {
	console.error(error);
	process.exit(1);
});
