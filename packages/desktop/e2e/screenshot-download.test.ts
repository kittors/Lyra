import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { startApp } from "./app.ts";

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
