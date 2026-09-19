import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { startApp, type AppWindow } from "./app.ts";

test("screenshot downloads use the chosen directory and survive an unavailable clipboard", async (t) => {
	const app = await startApp({ port: 9831, inspectPort: 9832, seed: async home => {
		await writeFile(join(home, "settings.json"), JSON.stringify({ providers: [], mcpServers: [], hooks: [], sync: { enabled: false }, screenshot: { shortcut: "", downloadLocation: join(home, "下载 甲"), copyToClipboard: false } }));
	} });
	try {
		// The fixture is a real app-window screenshot; no desktop or other applications are captured.
		const { data } = await app.send<{data: string}>("Page.captureScreenshot", { format: "png" });
		const png = `data:image/png;base64,${data}`;
		const download = () => app.evaluate<{ok:boolean;filePath?:string;error?:string}>(`window.lyra.screenshot.download(${JSON.stringify(png)}).catch(e=>({ok:false,error:e.message}))`);
		const first = await download();
		assert.equal(first.ok, true, JSON.stringify(first));
		assert.ok(first.filePath?.startsWith(join(app.home, "下载 甲")));
		assert.deepEqual(await readFile(first.filePath), Buffer.from(data,"base64"));
		t.diagnostic("PASS: chosen Unicode directory contains the exact PNG bytes");

		const secondDir = join(app.home, "下载 乙");
		await app.evaluate(`window.lyra.settings.get().then(s=>window.lyra.settings.save({...s,screenshot:{...s.screenshot,downloadLocation:${JSON.stringify(secondDir)},copyToClipboard:true}}))`);
		// Inject a native clipboard failure, as when another Windows process owns the clipboard.
		await app.main("(()=>{const c=process._linkedBinding('electron_common_clipboard');globalThis.__downloadClipboard=c.writeImage;c.writeImage=()=>{throw new Error('clipboard is busy')};return true})()");
		const second = await download();
		await app.main("(()=>{const c=process._linkedBinding('electron_common_clipboard');c.writeImage=globalThis.__downloadClipboard;delete globalThis.__downloadClipboard;return true})()");
		assert.equal(second.ok, true, JSON.stringify(second));
		assert.ok(second.filePath?.startsWith(secondDir));
		assert.deepEqual(await readFile(second.filePath), Buffer.from(data,"base64"));
		t.diagnostic("PASS: changing the directory takes effect without restart, even when clipboard copying fails");

		const blocked = join(app.home, "not-a-directory");
		await writeFile(blocked, "occupied");
		await app.evaluate(`window.lyra.settings.get().then(s=>window.lyra.settings.save({...s,screenshot:{...s.screenshot,downloadLocation:${JSON.stringify(blocked)},copyToClipboard:false}}))`);
		const failure = await download();
		assert.equal(failure.ok, false);
		assert.equal(failure.filePath, undefined);
		assert.match(failure.error ?? "", /ENOTDIR|EEXIST|EPERM|EACCES/);
		t.diagnostic("PASS: an unwritable destination reports failure without claiming a file was saved");

		if (process.env.LYRA_E2E_ARTIFACTS) {
			await mkdir(process.env.LYRA_E2E_ARTIFACTS, {recursive:true});
			await writeFile(join(process.env.LYRA_E2E_ARTIFACTS, "screenshot-download.json"), JSON.stringify({platform:process.platform,first: {ok:first.ok,bytes:(await readFile(first.filePath)).length},second:{ok:second.ok,bytes:(await readFile(second.filePath)).length},failure},null,2));
		}
	} finally {
		await app.stop();
	}
});

test("the visible download arrow saves to Desktop or the selected directory and shows the colour-copy toast", async (t) => {
	const app = await startApp({ port: 9831, inspectPort: 9832, seed: async home => {
		await writeFile(join(home, "settings.json"), JSON.stringify({ uiLocale: "zh-CN", providers: [], mcpServers: [], hooks: [], sync: { enabled: false }, screenshot: { enabled: true, shortcut: "", downloadLocation: "", saveLocation: "", copyToClipboard: false, openEditor: true } }));
	} });
	const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
	const frames: { at: number; data: Buffer }[] = [];
	const checks: { name: string; measured: unknown }[] = [];
	let overlay: AppWindow | undefined;
	let passed = false;
	async function until(page: AppWindow, expression: string) {
		const end = Date.now() + 10_000;
		while (Date.now() < end) {
			if (await page.evaluate<boolean>(expression)) return;
			await pause(50);
		}
		throw new Error(`Not ready: ${expression}`);
	}
	async function click(page: AppWindow, selector: string) {
		await until(page, `Boolean(document.querySelector(${JSON.stringify(selector)}))`);
		await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`);
		const point = await page.evaluate<{ x: number; y: number }>(`(() => {
			const el=document.querySelector(${JSON.stringify(selector)}),r=el.getBoundingClientRect();
			if(!el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))) throw new Error('Button is covered');
			return {x:r.x+r.width/2,y:r.y+r.height/2};
		})()`);
		for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
			await page.send("Input.dispatchMouseEvent", { type, ...point, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: type === "mouseMoved" ? 0 : 1 });
		}
	}
	async function hold(ms = 1100) {
		if (!overlay || !process.env.LYRA_E2E_RECORD_DIR) return;
		const end = Date.now() + ms;
		while (Date.now() < end) {
			const shot = await overlay.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 90 });
			frames.push({ at: Date.now(), data: Buffer.from(shot.data, "base64") });
			await pause(120);
		}
	}
	function check(name: string, measured: unknown) {
		checks.push({ name, measured });
		t.diagnostic(`PASS ${name}: ${JSON.stringify(measured)}`);
	}
	try {
		await click(app, 'button:has(svg.lucide-settings)');
		await until(app, `Boolean([...document.querySelectorAll('nav button')].find(e=>e.textContent.trim()==='屏幕截图'))`);
		await app.evaluate(`[...document.querySelectorAll('nav button')].find(e=>e.textContent.trim()==='屏幕截图').setAttribute('data-shot-settings','')`);
		await click(app, '[data-shot-settings]');
		await until(app, `Boolean(document.querySelector('[data-view="screenshot"]'))`);
		const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
		const fixture = join(app.home, "own-settings-window.png");
		await writeFile(fixture, Buffer.from(data, "base64"));
		const desktop = join(app.home, "System Desktop");
		await mkdir(desktop);
		// Only the OS acquisition boundary is a fixture: a real Lyra window, never the user's desktop.
		// Production start/init, pointer handling, cropping, IPC, filesystem and toast all run normally.
		await app.main(`(() => {
			const require=process.getBuiltinModule('module').createRequire(process._linkedBinding('electron_browser_app').app.getAppPath()+'/package.json');
			const e=require('electron'),image=e.nativeImage.createFromPath(${JSON.stringify(fixture)});
			e.app.setPath('desktop',${JSON.stringify(desktop)});
			e.systemPreferences.getMediaAccessStatus=()=> 'granted';
			e.desktopCapturer.getSources=async options=>e.screen.getAllDisplays().map(d=>({id:'screen:'+d.id+':0',display_id:String(d.id),name:'Lyra settings window fixture',thumbnail:image.resize(options.thumbnailSize)}));
			return true;
		})()`);
		for (let n = 0; n < 100 && !overlay; n++) {
			for (const win of await app.windows()) if (await win.evaluate(`Boolean(document.querySelector('[data-capture]'))`)) overlay = win;
			if (!overlay) await pause(50);
		}
		assert.ok(overlay, "Screenshot overlay must warm");
		const page = overlay;
		async function select() {
			await click(app, 'button[data-ly-tip="立即截屏"]');
			await until(page, `Boolean(document.querySelector('[data-capture="active"] canvas'))`);
			await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 120, y: 140, button: "left", buttons: 1, clickCount: 1 });
			for (let n = 1; n <= 8; n++) await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 120 + 360 * n / 8, y: 140 + 200 * n / 8, button: "left", buttons: 1 });
			await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 480, y: 340, button: "left", buttons: 0, clickCount: 1 });
			await until(page, `Boolean(document.querySelector('[data-annotate-bar] button'))`);
			await hold();
		}
		async function saved(directory: string) {
			await until(page, `document.querySelector('[data-screenshot-toast]')?.textContent.startsWith('已保存') === true`);
			const toast = await page.evaluate<{ text: string; opacity: number; width: number; height: number; layoutWidth: number; layoutHeight: number }>(`(() => {
				const el=document.querySelector('[data-screenshot-toast]'),box=el.firstElementChild,r=box.getBoundingClientRect(),style=getComputedStyle(box);
				return {text:el.textContent,opacity:Number(getComputedStyle(el).opacity),width:r.width,height:r.height,layoutWidth:parseFloat(style.width),layoutHeight:parseFloat(style.height)};
			})()`);
			const names = (await readdir(directory)).filter(name => name.endsWith(".png"));
			assert.equal(names.length, 1);
			const file = join(directory, names[0]!);
			assert.equal(toast.text, "已保存");
			assert.ok(toast.opacity > 0.9 && toast.width > 100 && toast.height > 40, JSON.stringify(toast));
			assert.ok(Math.abs(toast.width - toast.height) < 0.5, "The visible toast must stay square during its animation");
			assert.equal(toast.layoutWidth, 144);
			assert.equal(toast.layoutHeight, 144);
			assert.ok(await app.main(`process._linkedBinding('electron_browser_window').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('#/screenshot-overlay')).isVisible()`));
			const bytes = await readFile(file);
			assert.equal(bytes.subarray(1, 4).toString(), "PNG");
			assert.ok(bytes.readUInt32BE(16) >= 360 && bytes.readUInt32BE(20) >= 200);
			check("file is written and the square toast only says saved", { directory, bytes: bytes.length, toast });
			await hold();
			if (process.env.LYRA_E2E_ARTIFACTS) {
				await mkdir(process.env.LYRA_E2E_ARTIFACTS, { recursive: true });
				const shot = await page.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
				await writeFile(join(process.env.LYRA_E2E_ARTIFACTS, `screenshot-saved-${checks.length}.png`), Buffer.from(shot.data, "base64"));
			}
			await until(page, `Boolean(document.querySelector('[data-capture="idle"]'))`);
		}
		await select();
		const arrows = await page.evaluate<string[]>(`[...document.querySelectorAll('[data-annotate-bar] button:has(.lucide-download)')].map(b=>b.ariaLabel)`);
		assert.deepEqual(arrows, ["下载截图"], "Every visible download arrow must write a file, including the prominent rightmost button");
		assert.ok(await page.evaluate(`Boolean(document.querySelector('button[aria-label="完成"] .lucide-check'))`));
		check("download and completion have distinct visible icons", arrows);
		await click(page, 'button:has(.lucide-download)');
		await saved(desktop);

		const chosen = join(app.home, "下载 已选择");
		await mkdir(chosen);
		await app.main(`(() => {
			const require=process.getBuiltinModule('module').createRequire(process._linkedBinding('electron_browser_app').app.getAppPath()+'/package.json');
			require('electron').dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(chosen)}]});return true;
		})()`);
		await click(app, 'button[data-ly-tip="选择下载目录"]');
		await until(app, `document.querySelector('[data-view="screenshot"]')?.textContent.includes(${JSON.stringify(chosen)}) === true`);
		assert.equal(JSON.parse(await readFile(join(app.home, "settings.json"), "utf8")).screenshot.downloadLocation, chosen);
		check("directory picked in Settings persists without restart", chosen);
		await app.evaluate(`window.lyra.settings.get().then(s=>window.lyra.settings.save({...s,screenshot:{...s.screenshot,copyToClipboard:true}}))`);
		await app.main(`(() => {process._linkedBinding('electron_common_clipboard').writeImage=()=>{throw new Error('clipboard is busy')};return true;})()`);
		await select();
		await click(page, 'button:has(.lucide-download)');
		await saved(chosen);

		const blocked = join(app.home, "not-a-directory");
		await writeFile(blocked, "occupied");
		await app.evaluate(`window.lyra.settings.get().then(s=>window.lyra.settings.save({...s,screenshot:{...s.screenshot,downloadLocation:${JSON.stringify(blocked)}}}))`);
		await select();
		const selection = await page.evaluate(`document.querySelector('[data-selection]').getBoundingClientRect().toJSON()`);
		await click(page, 'button:has(.lucide-download)');
		await until(page, `document.querySelector('[data-screenshot-toast]')?.textContent.startsWith('保存失败') === true`);
		const error = await page.evaluate<string>(`document.querySelector('[data-screenshot-toast]').textContent`);
		assert.match(error, /EEXIST|ENOTDIR|EACCES|EPERM/);
		assert.deepEqual(await page.evaluate(`document.querySelector('[data-selection]').getBoundingClientRect().toJSON()`), selection);
		check("failed saves keep the selection and display the actual error", error);
		await hold();
		const retry = join(app.home, "下载 重试");
		await app.evaluate(`window.lyra.settings.get().then(s=>window.lyra.settings.save({...s,screenshot:{...s.screenshot,downloadLocation:${JSON.stringify(retry)}}}))`);
		await click(page, 'button:has(.lucide-download)');
		await saved(retry);
		passed = true;
	} finally {
		if (process.env.LYRA_E2E_ARTIFACTS) {
			await mkdir(process.env.LYRA_E2E_ARTIFACTS, { recursive: true });
			await writeFile(join(process.env.LYRA_E2E_ARTIFACTS, "screenshot-toolbar-download.json"), JSON.stringify({ platform: process.platform, passed, checks }, null, 2));
		}
		await app.stop();
		if (frames.length && process.env.LYRA_E2E_RECORD_DIR) {
			const { encode } = await import("./record.ts");
			const directory = process.env.LYRA_E2E_RECORD_DIR;
			await mkdir(directory, { recursive: true });
			const name = `${new Date().toISOString().replaceAll(":", "-")}_截图下载_${checks.length}of6${passed ? "" : "_failed"}`;
			await writeFile(join(directory, `${name}.json`), JSON.stringify({ platform: process.platform, passed, checks }, null, 2));
			await encode(frames, join(directory, `${name}.mp4`), 30);
			t.diagnostic(`RECORDING ${join(directory, `${name}.mp4`)}`);
		}
	}
});
