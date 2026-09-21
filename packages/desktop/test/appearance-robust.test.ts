/**
 * Applying a theme that arrived with pieces missing.
 *
 * Settings used to reach the renderer one way — read off disk, where they are merged with the
 * defaults on the way in. Now a phone receives them over a socket instead, and that path has no
 * such merge: whatever the desktop broadcasts is applied as it stands.
 *
 * So one absent field became a blank screen. `parseHex(undefined)` throws, the throw happens inside
 * a render, and the error boundary replaces the entire interface with a message about the renderer
 * — found on a real phone, which showed 「这个界面崩了」 and `hex.trim` where a light theme should
 * have been. Losing the app over a colour is the wrong trade at any time; over a colour that
 * arrived across a network, it is one a version mismatch could cause on its own.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_APPEARANCE, type AppearanceSettings } from "@lyra/core";
import { parseHex, readableInk } from "../src/features/settings/theme.ts";

test("a colour that is not there reads as no colour, rather than throwing", () => {
	// Every caller already handles null — they all carry a fallback — and none of them are wrapped
	// in anything that would catch an exception.
	assert.equal(parseHex(undefined), null);
	assert.equal(parseHex(null), null);
	assert.equal(parseHex(""), null);
	assert.equal(parseHex("not a colour"), null);
	assert.equal(parseHex(12 as unknown as string), null);
});

test("a colour that is there still parses, in every form", () => {
	assert.deepEqual(parseHex("#171717"), { r: 23, g: 23, b: 23 });
	assert.deepEqual(parseHex("171717"), { r: 23, g: 23, b: 23 });
	assert.deepEqual(parseHex("#fff"), { r: 255, g: 255, b: 255 });
	assert.deepEqual(parseHex("  #FFF  "), { r: 255, g: 255, b: 255 });
});

test("the defaults cover every field the renderer reads", () => {
	/*
	 * `applyAppearance` fills in from `DEFAULT_APPEARANCE` before touching anything, so this is what
	 * makes that merge sufficient rather than merely helpful: if a field it reads has no default,
	 * the merge produces `undefined` again and the guard above is the only thing left.
	 */
	for (const field of [
		"theme",
		"darkBackground",
		"lightBackground",
		"darkForeground",
		"lightForeground",
		"accent",
		"contrast",
	] as (keyof AppearanceSettings)[]) {
		assert.notEqual(DEFAULT_APPEARANCE[field], undefined, `DEFAULT_APPEARANCE 缺少 ${field}`);
	}
});

test("the defaults are themselves parseable colours", () => {
	// A default that does not parse would send every one of them through the hardcoded fallback
	// inside `applyAppearance`, quietly, and the theme would be near-black whatever it said.
	for (const field of ["darkBackground", "lightBackground", "darkForeground", "lightForeground"] as const) {
		assert.notEqual(parseHex(DEFAULT_APPEARANCE[field]), null, `${field} 应当是能解析的颜色`);
	}
});

test("a theme sent with nothing but a mode still resolves to a full one", () => {
	/*
	 * This is the shape that actually broke it: a settings object carrying `{ theme: "light" }` and
	 * nothing else, which is what a hand-edited settings.json or an older desktop sends.
	 */
	const partial = { theme: "light" } as AppearanceSettings;
	const merged = { ...DEFAULT_APPEARANCE, ...partial };
	assert.equal(merged.theme, "light", "指定的那一项要保留");
	assert.notEqual(parseHex(merged.lightBackground), null, "其余的从默认值补齐");
	assert.equal(typeof merged.contrast, "number", "对比度不能是 NaN 的来源");
});

/* ------------------------------------------------------------------------
 * 改底色，字色跟着走
 *
 * 自定义行内代码配色时，字色由底色派生。不派生的话，把底色往深里调一点点就能配出黑底黑字——
 * 设置页上两行各自都合理，屏幕上那一小块直接消失。所以这里量的是「任何底色都配得出读得清的字」，
 * 而不是「函数返回了一个颜色」。
 * --------------------------------------------------------------------- */

/** WCAG 对比度，1 到 21。测试自己算一遍，不从被测的那个文件里借。 */
function contrast(a: string, b: string): number {
	const lum = (hex: string) => {
		const rgb = parseHex(hex);
		if (!rgb) throw new Error(`不是颜色：${hex}`);
		const channel = (value: number) => {
			const v = value / 255;
			return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
		};
		return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
	};
	const [bright, dim] = [lum(a), lum(b)].sort((x, y) => y - x);
	return (bright + 0.05) / (dim + 0.05);
}

test("派生出来的字色，在它自己的底色上永远读得清", () => {
	/*
	 * 全色域扫一遍，步长 9（约 2.8 万个底色）。
	 *
	 * 抽几个手挑的样例不够，这个函数栽过的地方正是没人会去手挑的那一带：中间调的饱和色。第一版
	 * 按 HSL 的 `l` 判明暗，橄榄绿 `#828C0A` 的 `l` 只有 0.29、看上去却很亮，于是配了浅字——
	 * 3.68:1。扫描是唯一发现得了这种事的办法。
	 */
	let worst = { bg: "", ink: "", ratio: 21 };
	for (let r = 0; r < 256; r += 9) {
		for (let g = 0; g < 256; g += 9) {
			for (let b = 0; b < 256; b += 9) {
				const bg = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
				const ink = readableInk(bg);
				const ratio = contrast(bg, ink);
				if (ratio < worst.ratio) worst = { bg, ink, ratio };
			}
		}
	}
	// AA 的正文线。行内代码的字号比正文还小一档，所以这是下限不是目标。
	assert.ok(
		worst.ratio >= 4.5,
		`${worst.bg} 配出来的 ${worst.ink} 只有 ${worst.ratio.toFixed(2)}:1，低于 AA 的 4.5`,
	);
});

test("字色跟着底色的色相走，不是一律黑白", () => {
	/*
	 * 一块浅橙底配上纯黑，读是读得清，但那是两个不相干的颜色凑在一起——而行内代码是嵌在句子里的，
	 * 一眼看过去先看到的是协不协调。所以要的不只是对比度。
	 */
	const warm = parseHex(readableInk("#FFE8CC"));
	assert.ok(warm, "浅橙底得配得出颜色");
	assert.ok(warm.r > warm.b, `浅橙底该配暖色字，却得到 ${JSON.stringify(warm)}`);

	const cool = parseHex(readableInk("#DCE8FF"));
	assert.ok(cool, "浅蓝底得配得出颜色");
	assert.ok(cool.b > cool.r, `浅蓝底该配冷色字，却得到 ${JSON.stringify(cool)}`);
});

test("深浅两头都算过再挑，不按 HSL 的亮度选边", () => {
	/*
	 * 这一条是上面那次走样的具体形状，单独钉住：橄榄绿在 HSL 里 `l` 只有 0.29，照着判会当成深底
	 * 配浅字，而它看上去比白纸还扎眼。挑边要按两头各自能走到哪儿，不按起点。
	 */
	const olive = "#828C0A";
	const ink = parseHex(readableInk(olive));
	assert.ok(ink, "橄榄绿得配得出颜色");
	assert.ok(ink.r + ink.g + ink.b < 200, `橄榄绿该配深字，却得到 ${readableInk(olive)}`);
	assert.ok(contrast(olive, readableInk(olive)) >= 4.5);
});

test("默认的那两套颜色，字色正是底色派生出来的那个", () => {
	/*
	 * 这条对齐的是界面行为而不是数值：外观页靠「当前字色等于底色派生值」来判断字色还是不是自动的。
	 * 默认值要是对不上，一装上就是「手动」状态——改底色字色不跟，而用户从没动过它。
	 */
	assert.equal(
		DEFAULT_APPEARANCE.inlineCodeLightFg?.toUpperCase(),
		readableInk(DEFAULT_APPEARANCE.inlineCodeLightBg ?? "").toUpperCase(),
	);
	assert.equal(
		DEFAULT_APPEARANCE.inlineCodeDarkFg?.toUpperCase(),
		readableInk(DEFAULT_APPEARANCE.inlineCodeDarkBg ?? "").toUpperCase(),
	);
});

test("不是颜色的东西进来，给一个颜色而不是抛异常", () => {
	// 和 `parseHex` 同一条规矩：这个函数的结果直接进 `setProperty`，抛出去就是一屏空白。
	assert.equal(readableInk("not a colour"), "#1a1c1f");
	assert.equal(readableInk(""), "#1a1c1f");
});
