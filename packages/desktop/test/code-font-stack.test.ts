/**
 * Every code font stack can draw Chinese before it reaches `monospace`.
 *
 * Monospace faces carry no Han, and on Windows the generic `monospace` answers Han with NSimSun. The
 * default stack named YaHei ahead of it; every preset in the menu named only PingFang, which Windows
 * does not have — so picking Consolas, measured on a real Windows 11 machine, drew the editor's and
 * the terminal's Chinese in NSimSun.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { CODE_DEFAULTS } from "../src/features/settings/appearance-defaults.ts";
import { CODE_FONTS } from "../src/features/settings/code-fonts.ts";
import { withHanFallback } from "../src/lib/code/font-stack.ts";

const SRC = join(import.meta.dirname, "../src");
const families = (stack: string) => stack.split(",").map((entry) => entry.trim().replace(/^"|"$/g, ""));

test("every preset reaches a Chinese face for each platform before monospace", () => {
	for (const font of CODE_FONTS) {
		const list = families(withHanFallback(font.stack));
		const generic = list.indexOf("monospace");
		for (const face of ["Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC"]) {
			const at = list.indexOf(face);
			assert.ok(at !== -1 && (generic === -1 || at < generic), `${font.label}: ${face} must come before monospace — ${list.join(", ")}`);
		}
		assert.equal(list[0], font.family, `${font.label} still leads with its own face`);
	}
});

test("the default stack already has them, and is left exactly as it is", () => {
	assert.equal(withHanFallback(CODE_DEFAULTS.codeFont), CODE_DEFAULTS.codeFont);
});

test("a Chinese face someone chose stays ahead of the ones added", () => {
	const list = families(withHanFallback('"Sarasa Mono SC", Consolas, monospace'));
	assert.equal(list[0], "Sarasa Mono SC");
	assert.ok(list.indexOf("Microsoft YaHei UI") > list.indexOf("Consolas"));
	assert.equal(list.at(-1), "monospace");
});

test("a stack with no generic family gets the Chinese faces at its end", () => {
	assert.deepEqual(families(withHanFallback("Fira Code")), ["Fira Code", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC"]);
});

test("nothing draws the stored code font without the Chinese fallback", () => {
	// The terminal and the 外观 preview both read the setting directly rather than `--ly-code-font`, and the
	// preview — the place people choose a font by looking — went on drawing NSimSun after the editor stopped.
	const offenders: string[] = [];
	const walk = (dir: string) => {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			if (statSync(path).isDirectory()) walk(path);
			else if (/\.tsx?$/.test(name)) {
				for (const line of readFileSync(path, "utf8").split("\n")) {
					const value = /fontFamily:\s*([^,}\n]*codeFont[^}\n]*)/.exec(line)?.[1];
					if (value && !value.startsWith("withHanFallback(")) offenders.push(`${relative(SRC, path)}: ${line.trim()}`);
				}
			}
		}
	};
	walk(SRC);
	assert.deepEqual(offenders, []);
});
