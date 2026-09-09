/* oxlint-disable no-console -- 探针的输出就是它的全部产物 */
/**
 * Whether an imported font is the one actually drawing the interface.
 *
 * `node --experimental-strip-types e2e/imported-font-probe.ts [font file]`
 *
 * The unit tests prove the store keeps the bytes and the loader registers a face. Neither can say
 * what this asks: after all of that, which physical font did Chromium reach for when it drew the
 * window. So each sample is drawn three times into a canvas — under the cascade `body` actually
 * resolves to, under the imported family alone, and under the stack that would be left if nothing
 * had been imported — and the pixels are hashed. Widths cannot answer this on their own: CJK
 * glyphs are full-width in every face, so two completely different fonts measure the same and only
 * the drawing tells them apart.
 *
 * Both halves of `base.css` are checked, because they fail in opposite directions. The imported
 * family has to be reached at all, which is what the whole feature is for; and `Lyra CJK` has to
 * still be reachable behind it, because putting the imported font first is exactly the kind of
 * change that silently drops the CJK adjustment for everyone who has not imported anything.
 *
 * The second half puts the default stack back through `settings.save`, so the removal travels the
 * same path it does for a user pressing 只恢复默认字体 — main process, settings event,
 * `loadSelectedFonts`, `syncImportedUiFont` — rather than being poked into the document here.
 */

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { CustomFontStore } from "../electron/custom-fonts.ts";

/**
 * Wide coverage, so its glyphs reach into the range `Lyra CJK` would otherwise claim.
 *
 * Apple's own CJK faces cannot be used here even though they are the obvious choice: Chromium's
 * sanitizer refuses AppleGothic and AppleMyungjo outright — `Invalid font data in ArrayBuffer` —
 * because of the Apple-specific tables they carry. That refusal is worth knowing about (it is what
 * the browser will say to a user who imports one) but it makes them useless for measuring anything
 * past the load. At 22 MiB this one also shows the `data:` URL carrying a real font, not a token.
 */
const SOURCE = process.argv[2] ?? "/System/Library/Fonts/Supplemental/Arial Unicode.ttf";
const PORT = 9733;
const DEFAULT_UI_FONT_STACK =
	'"Inter Variable", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
/** What the CJK samples fall to when no imported family is in front of them. */
const WITHOUT_IMPORT = '"Lyra CJK", "PingFang SC", "Microsoft YaHei", sans-serif';

const SAMPLES = [
	{ label: "latin ", text: "Lyra Imported AaBb 123" },
	{ label: "han   ", text: "中文测试" },
	{ label: "标点  ", text: "，、。" },
];

interface Drawn {
	hash: string;
	width: number;
}
type Variant = "cascade" | "imported" | "without" | "cjk" | "missing";
interface Reading {
	stack: string;
	registered: boolean;
	importedVar: string;
	samples: Record<string, Record<Variant, Drawn>>;
}

let family = "";

async function seed(home: string): Promise<void> {
	// `main.ts` points userData at `$LYRA_HOME/chromium`, which is where the store will look.
	const userData = join(home, "chromium");
	await mkdir(userData, { recursive: true });
	const font = await new CustomFontStore(userData).importFile(SOURCE);
	family = font.family;
	console.log(`导入 ${SOURCE}\n  family=${family}\n  format=${font.format}  size=${font.size} 字节`);

	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1200, height: 860, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: [],
			appearance: { uiFont: `"${family}", "PingFang SC", "Microsoft YaHei", sans-serif` },
		}),
	);
}

function reader(): string {
	return `(() => {
		const samples = ${JSON.stringify(SAMPLES)};
		const canvas = document.createElement("canvas");
		canvas.width = 1000;
		canvas.height = 96;
		const ctx = canvas.getContext("2d");
		const draw = (stack, text) => {
			ctx.clearRect(0, 0, canvas.width, canvas.height);
			ctx.font = "56px " + stack;
			ctx.textBaseline = "top";
			ctx.fillStyle = "#000";
			ctx.fillText(text, 0, 8);
			const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
			// The alpha channel alone: the ink is black, so coverage is the whole of the drawing.
			let hash = 2166136261;
			for (let at = 3; at < pixels.length; at += 4) {
				hash ^= pixels[at];
				hash = Math.imul(hash, 16777619);
			}
			return { hash: (hash >>> 0).toString(16), width: Math.round(ctx.measureText(text).width * 100) / 100 };
		};
		const stack = getComputedStyle(document.body).fontFamily;
		const out = {};
		for (const sample of samples) {
			out[sample.label] = {
				cascade: draw(stack, sample.text),
				imported: draw('"${family}"', sample.text),
				without: draw(${JSON.stringify(WITHOUT_IMPORT)}, sample.text),
				// Is Lyra CJK a face on this host at all? Its src is three local() names, and
				// where none of them is installed the family resolves to nothing and every
				// conclusion about ordering past it is about a stack entry that was never there.
				cjk: draw('"Lyra CJK"', sample.text),
				missing: draw('"Ly Absent Family 4711"', sample.text),
			};
		}
		const root = document.documentElement.style;
		return {
			stack,
			registered: document.fonts.check('13px "${family}"'),
			importedVar: root.getPropertyValue("--ly-imported-ui-font"),
			samples: out,
		};
	})()`;
}

/**
 * Wait for the renderer to settle on an answer before reading it.
 *
 * Reading a 15 MB face out of the store, across IPC and through `FontFace.load`, takes longer than
 * the first paint the harness waits for. Measuring straight away reports the stack as it was on the
 * way there, which is a real state of the app and not the one being asked about.
 */
async function settled(app: RunningApp, expected: boolean): Promise<void> {
	for (let attempt = 0; attempt < 60; attempt++) {
		const set = await app.evaluate<boolean>(
			`!!document.documentElement.style.getPropertyValue("--ly-imported-ui-font")`,
		);
		if (set === expected) return;
		await app.evaluate<null>("new Promise((done) => setTimeout(() => done(null), 100))");
	}
	throw new Error(`等了 6 秒，--ly-imported-ui-font 仍然不是「${expected ? "已设置" : "未设置"}」`);
}

async function measure(app: RunningApp, when: string): Promise<Reading> {
	const reading = await app.evaluate<Reading>(reader());
	console.log(`\n${when}`);
	console.log(`  body 解析出的字体栈：${reading.stack}`);
	console.log(`  --ly-imported-ui-font=${reading.importedVar || "(未设置)"}`);
	console.log(`  导入的 FontFace 已注册：${reading.registered}`);
	for (const sample of SAMPLES) {
		const drawn = reading.samples[sample.label];
		const show = (name: Variant) => `${name}=${drawn[name].hash}/${drawn[name].width}px`;
		console.log(`  ${sample.label} 「${sample.text}」  ${(["cascade", "imported", "without", "cjk", "missing"] as Variant[]).map(show).join("  ")}`);
	}
	return reading;
}

const app = await startApp({ port: PORT, seed });
try {
	await settled(app, true);
	const chosen = await measure(app, "① 选中导入字体");
	assert.ok(chosen.registered, "启动时读回的导入字体没有注册成 FontFace");

	const importedAt = chosen.stack.indexOf(family);
	const cjkAt = chosen.stack.indexOf("Lyra CJK");
	assert.ok(importedAt >= 0, "导入字体没有出现在 body 的字体栈里");
	assert.ok(cjkAt >= 0, "Lyra CJK 从 body 的字体栈里消失了");
	assert.ok(importedAt < cjkAt, "导入字体排在 Lyra CJK 后面，CJK 字形永远轮不到它");

	for (const sample of SAMPLES) {
		const drawn = chosen.samples[sample.label];
		assert.equal(drawn.cascade.hash, drawn.imported.hash, `${sample.label.trim()} 画出来的不是导入的那个字体`);
		assert.notEqual(drawn.cascade.hash, drawn.without.hash, `${sample.label.trim()} 有没有导入字体画出来一模一样，这个样本证明不了任何事`);
	}

	await app.evaluate<null>(`(async () => {
		const settings = await window.lyra.settings.get();
		await window.lyra.settings.save({ ...settings, appearance: { ...settings.appearance, uiFont: ${JSON.stringify(DEFAULT_UI_FONT_STACK)} } });
		return null;
	})()`);
	// The renderer reacts to the settings event, not to the call returning.
	await settled(app, false);

	const plain = await measure(app, "② 通过 settings.save 恢复默认字体");
	assert.equal(plain.stack.indexOf(family), -1, "恢复默认后导入字体还留在字体栈里");
	for (const sample of SAMPLES) {
		const drawn = plain.samples[sample.label];
		assert.notEqual(drawn.cascade.hash, chosen.samples[sample.label].imported.hash, `${sample.label.trim()} 恢复默认后还在用导入的字体`);
	}
	console.log("\n结论：三段文字都由导入字体绘制，CJK 也是；恢复默认后不再由它绘制。");
} finally {
	await app.stop();
}
