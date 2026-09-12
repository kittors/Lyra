/**
 * 发版流水线里那几条「只有发版才会执行到」的约定。
 *
 * 这些约定没有一条能被普通的检查覆盖：它们要么写在 YAML 里（lint 和 tsc 都不读），要么是「同一个
 * 名字写在三个地方」，要么是「一个看起来没用的依赖其实不能删」。而它们错掉的代价都一样——tag 已
 * 经推上去了，才发现。
 *
 * 手机端打包接进发版的那次，踩到的就是这一类：`expo export` 一直是绿的，而 Xcode 的打包阶段用的
 * 是 `export:embed`，后者按名字解析 Babel 插件，于是 iOS 归档在 JS 那一步就死了。整条链路上没有
 * 任何东西会提前说一句。
 *
 * 所以这里守的不是代码的行为，是流水线的形状。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const release = read(".github/workflows/release.yml");
const dryrun = read(".github/workflows/release-dryrun.yml");
const mobileBuild = read(".github/workflows/_mobile-build.yml");
const ci = read(".github/workflows/ci.yml");

test("排练和发版调用同一个手机端构建工作流", () => {
	for (const [name, workflow] of [["release.yml", release], ["release-dryrun.yml", dryrun]] as const) {
		assert.match(
			workflow,
			/uses: \.\/\.github\/workflows\/_mobile-build\.yml/,
			`${name} 没有调用 _mobile-build.yml——排练与发版必须跑同一份文件，否则排练不再排练它要排练的东西`,
		);
	}
});

test("签名要求：发版致命，排练只警告", () => {
	// 取的是各自文件里 `require-signing:` 的所有取值，不区分桌面还是手机——两边都该是同一个态度。
	const values = (workflow: string) => [...workflow.matchAll(/require-signing: (true|false)/g)].map((m) => m[1]);

	assert.deepEqual(values(release), ["true", "true"], "release.yml 里桌面与手机都必须 require-signing: true");
	assert.deepEqual(values(dryrun), ["false", "false"], "排练里两端都该是 false，否则没有密钥的排练会红");
});

test("发布那一步等桌面也等手机", () => {
	assert.match(
		release,
		/needs: \[build, mobile\]/,
		"publish 不等 mobile 的话，手机端红了也会发出一个只有桌面产物的 release——资产列表的含义会悄悄变",
	);
});

test("Android 那四个 secret 的名字，三处写的是同一套", () => {
	const names = ["ANDROID_KEYSTORE_BASE64", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD"];
	const places = {
		"_mobile-build.yml": mobileBuild,
		"prepare-android-signing.sh": read(".github/scripts/prepare-android-signing.sh"),
		"release.mjs": read("scripts/release.mjs"),
	};

	for (const [where, text] of Object.entries(places)) {
		for (const name of names) {
			assert.ok(text.includes(name), `${where} 里没有 ${name}；改名漏一处，发版会在签名那一步才发现`);
		}
	}
});

test("日常 CI 用的是原生构建那条打包命令", () => {
	assert.match(
		ci,
		/expo export:embed/,
		"mobile-bundle 换回 `expo export` 就抓不到 export:embed 才有的解析失败——那是 iOS 归档真正用的命令",
	);
});

test("手机端那个看起来没用的 Babel 插件依赖还在", () => {
	const manifest = JSON.parse(read("packages/mobile/package.json")) as { devDependencies: Record<string, string> };
	assert.ok(
		manifest.devDependencies["@babel/plugin-transform-react-jsx"],
		"这个依赖仓库里没有一行 import，删掉它 lint、typecheck、单元测试、`expo export` 全绿，" +
			"而 iOS 归档会在 JS 打包那一步失败：Xcode 走的 `export:embed` 按名字从工程根解析这个插件。knip 那边也压着一行。",
	);
});

test("生成出来的原生工程不进仓库", () => {
	const ignored = read("packages/mobile/.gitignore");
	for (const dir of ["/android", "/ios"]) {
		assert.ok(
			ignored.includes(dir),
			`packages/mobile/.gitignore 要忽略 ${dir}：它由 expo prebuild 从 app.json 生成，提交它等于维护两份互相会打架的描述`,
		);
	}
});
