/** Run on macOS with screen recording permission; CDP screenshots omit the native traffic lights. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { startApp } from "./app.ts";

assert.equal(process.platform, "darwin", "this probe measures real macOS window chrome");
const exec = promisify(execFile);
const app = await startApp({ port: 9596, seed: async (home) => {
	await writeFile(join(home, "settings.json"), JSON.stringify({
		providers: [], mcpServers: [], hooks: [], sync: { enabled: false }, appearance: { theme: "dark" },
	}));
} });
try {
	// A unique native title identifies this isolated window without touching another running Lyra.
	const title = `Lyra header QA ${Date.now()}`;
	await app.evaluate(`document.title = ${JSON.stringify(title)}`);
	const { stdout } = await exec("osascript", ["-l", "JavaScript", "-e", `
		ObjC.import('CoreGraphics'); ObjC.import('Foundation');
		const windows = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(
			$.kCGWindowListOptionOnScreenOnly, $.kCGNullWindowID)));
		JSON.stringify(windows.filter(w => w.kCGWindowName === ${JSON.stringify(title)} && w.kCGWindowLayer === 0)
			.map(w => w.kCGWindowNumber));
	`], { timeout: 5_000 });
	const ids: unknown = JSON.parse(stdout);
	assert.ok(Array.isArray(ids) && ids.length === 1 && typeof ids[0] === "number", `window lookup: ${stdout}`);
	const path = join(app.home, "native-header.png");
	await exec("screencapture", ["-x", "-o", "-l", String(ids[0]), path], { timeout: 5_000 });
	const png = await readFile(path);
	const dir = process.env.LYRA_E2E_ARTIFACTS;
	if (dir) {
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "native-header.png"), png);
	}
	const geometry = await app.evaluate<{ nativeCenter: number; nativeHeight: number; icons: number[] }>(`(async () => {
		const picture = new Image(); picture.src = 'data:image/png;base64,${png.toString("base64")}';
		await picture.decode();
		const canvas = document.createElement('canvas');
		canvas.width = picture.width; canvas.height = picture.height;
		const ctx = canvas.getContext('2d'); ctx.drawImage(picture, 0, 0);
		const scale = picture.width / innerWidth;
		const { data } = ctx.getImageData(0, 0, picture.width, picture.height);
		const pixel = (x, y) => (y * picture.width + x) * 4;
		const background = pixel(Math.round(20 * scale), Math.round(8 * scale));
		let top = Infinity, bottom = -Infinity;
		// Exclude the window border and sidebar button. Both active colours and inactive grey
		// differ from the seeded dark toolbar; the native lights are absent in a CDP capture.
		for (let y = Math.ceil(8 * scale); y < 40 * scale; y++) {
			for (let x = Math.ceil(16 * scale); x < 76 * scale; x++) {
				const i = pixel(x, y);
				if ([0, 1, 2].some(c => Math.abs(data[i + c] - data[background + c]) > 24)) {
					top = Math.min(top, y); bottom = Math.max(bottom, y);
				}
			}
		}
		const icons = [...document.querySelectorAll('button svg')].map(s => s.getBoundingClientRect())
			.filter(r => r.height > 0 && r.top >= 0 && r.bottom <= 44).map(r => r.y + r.height / 2);
		return { nativeCenter: (top + bottom + 1) / (2 * scale), nativeHeight: (bottom - top + 1) / scale, icons };
	})()`);
	process.stdout.write(`${JSON.stringify(geometry)}\n`);
	assert.ok(geometry.nativeHeight >= 12 && geometry.nativeHeight <= 16, "native light pixels were found");
	assert.ok(geometry.icons.length >= 2, "the sidebar and panel controls were rendered");
	for (const center of geometry.icons) {
		assert.ok(Math.abs(center - geometry.nativeCenter) <= 0.5, `icon y=${center}, native y=${geometry.nativeCenter}`);
	}
} finally {
	await app.stop();
}
