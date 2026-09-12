#!/usr/bin/env node
/**
 * Cutting a release, as one command.
 *
 * It used to be a list in AGENTS.md: bump the version in six package.json files (seven now, plus
 * the Expo manifest), write the notes, tag, push. Every step of that is easy and one of them is
 * always forgotten — the phone's `app.json` sat at 0.1.0 for thirty-five releases because it was
 * the item at the end of the list.
 *
 * The rehearsal check is the other half. AGENTS.md asks for a `Release dry run` before every tag,
 * and explains why: daily CI does not package, so `pnpm package` runs nowhere else, and the first
 * release found that out the hard way. Asking a person to remember it makes it a thing that gets
 * remembered until the one time it does not, so this asks GitHub instead.
 *
 *   pnpm release patch                 补丁位 +1
 *   pnpm release minor|major
 *   pnpm release 0.9.0                 指定版本
 *   pnpm release patch --no-push       改完提交打好 tag，不推——本地看一眼再决定
 *   pnpm release patch --skip-rehearsal 跳过排练检查，理由会写进 tag
 *   pnpm release rehearse              触发一次 Release dry run 并等它跑完
 */

import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { ALL, ROOT, SOURCE, readVersion, writeBuildNumber, writeVersion } from "./versions.mjs";

const run = promisify(execFile);

/** Run a command, or stop with its output. Nothing here is worth continuing past. */
async function must(file, args, options = {}) {
	try {
		const { stdout } = await run(file, args, { cwd: ROOT, ...options });
		return stdout.trim();
	} catch (error) {
		fail(`${file} ${args.join(" ")} 失败\n${error.stderr || error.stdout || error.message}`);
	}
}

function fail(message) {
	console.error(`\n✖ ${message}\n`);
	process.exit(1);
}

function note(message) {
	console.log(`  ${message}`);
}

/** The next version, from a bump word or an explicit number. */
function nextVersion(current, request) {
	if (/^\d+\.\d+\.\d+$/.test(request)) {
		const [a, b] = [request, current].map((v) => v.split(".").map(Number));
		const bigger = a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];
		if (!bigger) fail(`${request} 不比当前的 ${current} 大`);
		return request;
	}
	const [major, minor, patch] = current.split(".").map(Number);
	if (request === "major") return `${major + 1}.0.0`;
	if (request === "minor") return `${major}.${minor + 1}.0`;
	if (request === "patch") return `${major}.${minor}.${patch + 1}`;
	fail(`不认识的版本参数：${request}。用 patch / minor / major 或 x.y.z`);
}

/**
 * Everything that must be true before a tag is worth pushing.
 *
 * Checked up front rather than as it goes, so a failure leaves the tree exactly as it was found
 * instead of half-bumped.
 */
async function preflight({ skipRehearsal }) {
	const branch = await must("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
	if (branch !== "main") fail(`发版要在 main 上，当前是 ${branch}`);

	const dirty = await must("git", ["status", "--porcelain"]);
	if (dirty) fail(`工作区不干净，先提交或收起这些改动：\n${dirty}`);

	await must("git", ["fetch", "--quiet", "origin", "main"]);
	const ahead = await must("git", ["rev-list", "--count", "origin/main..HEAD"]);
	const behind = await must("git", ["rev-list", "--count", "HEAD..origin/main"]);
	if (ahead !== "0" || behind !== "0") {
		fail(`本地与 origin/main 不一致（领先 ${ahead}，落后 ${behind}）。先推或先拉。`);
	}

	const head = await must("git", ["rev-parse", "HEAD"]);

	// Asked before the rehearsal branch: `--skip-rehearsal` says "I accept an unrehearsed package",
	// not "I accept a release that will stop at the signing step".
	await androidKeyOrStop();

	if (skipRehearsal) {
		note("⚠︎ 跳过排练检查——这次发布没有在五个 runner 上打包验证过");
		return { head, rehearsed: false };
	}

	/*
	 * The dry run has to be *this* commit's.
	 *
	 * A green run on the previous commit says nothing about this one, and packaging is exactly the
	 * kind of thing a one-line change can break: `executableName`, an icon path, a native module
	 * that only resolves on one architecture.
	 */
	const runs = await must("gh", [
		"run", "list", "--workflow", "release-dryrun.yml",
		"--json", "headSha,conclusion,url", "--limit", "20",
	]).catch(() => "[]");

	let ok = null;
	try {
		ok = JSON.parse(runs).find((r) => r.headSha === head && r.conclusion === "success");
	} catch {
		note("读不到 dry run 记录（gh 未登录？）。用 --skip-rehearsal 可以绕过，但请知道绕过的是什么。");
	}
	if (!ok) {
		fail(
			`这个提交没有绿色的 Release dry run。\n\n` +
			`  先跑：  pnpm release rehearse\n` +
			`  绕过：  pnpm release <版本> --skip-rehearsal\n\n` +
			`为什么必须：日常 CI 不打包，pnpm package 只在 release 与 dry run 里跑过。` +
			`打包错误在其它任何检查里都是绿的——直到 tag 推上去。`,
		);
	}
	note(`排练通过：${ok.url}`);
	return { head, rehearsed: true };
}

/**
 * The Android release key, which the rehearsal is unable to check for us.
 *
 * `release.yml` treats a missing keystore as fatal — an APK signed with React Native's public
 * template key can never be updated by a properly signed one — while the dry run treats it as a
 * warning, because a rehearsal without secrets should still rehearse the packaging. Which leaves
 * exactly one gap: a green rehearsal, then a tag, then a release job that dies on the signing
 * step. A pushed tag with no release behind it is the failure this whole script exists to prevent.
 *
 * So it is asked here, where it is still a question and not yet a tag.
 *
 * Unreadable is not the same as absent: `gh secret list` needs a token with admin scope, and not
 * having one says nothing about the repository. That case notes and continues — the release job
 * will still refuse, which is the outcome we are trying to warn about rather than to enforce.
 *
 * Plain output rather than `--json`: this only needs the first column, and asking for JSON adds a
 * dependency on a `gh` new enough to serve it.
 */
async function androidKeyOrStop() {
	const needed = [
		"ANDROID_KEYSTORE_BASE64",
		"ANDROID_KEYSTORE_PASSWORD",
		"ANDROID_KEY_ALIAS",
		"ANDROID_KEY_PASSWORD",
	];

	let listed;
	try {
		const { stdout } = await run("gh", ["secret", "list"], { cwd: ROOT });
		listed = new Set(stdout.split("\n").map((line) => line.split(/\s+/)[0]).filter(Boolean));
	} catch {
		note("读不到仓库 secret（gh 没有 admin 权限？）。Android 签名这一条没检查。");
		return;
	}

	const missing = needed.filter((name) => !listed.has(name));
	if (missing.length === 0) {
		note("Android 签名钥匙就位");
		return;
	}

	fail(
		`Android 的签名钥匙没配，发版会在签名那一步停下：\n\n` +
		`  缺：    ${missing.join("、")}\n` +
		`  生成：  bash packages/mobile/scripts/make-release-keystore.sh\n` +
		`          （它会打印四条 gh secret set，粘贴执行即可）\n\n` +
		`为什么不能凑合：用 React Native 模板里那把公开的 debug key 签出来的 APK，` +
		`以后任何一个正经签名的版本都更新不了它——用户必须先卸载，配对跟着一起丢。` +
		`而那把钥匙是公开的，拿到它的人能造出手机会接受的「更新」。`,
	);
}

async function rehearse() {
	note("触发 Release dry run…");
	await must("gh", ["workflow", "run", "release-dryrun.yml", "--ref", "main"]);
	await new Promise((r) => setTimeout(r, 6000));
	const id = await must("gh", ["run", "list", "--workflow", "release-dryrun.yml", "--limit", "1", "--json", "databaseId", "-q", ".[0].databaseId"]);
	note(`跑起来了：${id}。等它结束（三平台打包，约十五分钟）…`);
	await run("gh", ["run", "watch", id], { cwd: ROOT, stdio: "inherit" }).catch(() => {});
	console.log("\n绿了就可以 pnpm release <版本>\n");
}

async function main() {
	const args = process.argv.slice(2);
	if (args[0] === "rehearse") return rehearse();

	const request = args[0];
	if (!request) fail("用法：pnpm release <patch|minor|major|x.y.z> [--no-push] [--skip-rehearsal]");
	const noPush = args.includes("--no-push");
	const skipRehearsal = args.includes("--skip-rehearsal");

	const current = await readVersion(SOURCE);
	const version = nextVersion(current, request);
	const tag = `v${version}`;
	console.log(`\n${current} → ${version}\n`);

	const { rehearsed } = await preflight({ skipRehearsal });

	const existing = await must("git", ["tag", "-l", tag]);
	if (existing) fail(`${tag} 已经存在`);

	note(`写版本号（${ALL.length} 处）`);
	for (const relative of ALL) await writeVersion(relative, version);

	// The two numbers the phone installs by. They are in app.json and not in the build command
	// because `android/` and `ios/` do not exist until a runner generates them from app.json.
	note(`写手机端构建号（${await writeBuildNumber(version)}）`);

	note("生成 CHANGELOG");
	const previous = await must("git", ["describe", "--tags", "--abbrev=0"]);
	const section = await must("npx", ["git-cliff", `${previous}..HEAD`, "--tag", tag, "--unreleased"]);
	const changelogPath = join(ROOT, "CHANGELOG.md");
	const existingLog = await readFile(changelogPath, "utf8");
	/*
	 * Prepended under the preamble rather than at the top of the file, so the explanation of what
	 * this file is stays above the versions instead of being pushed below the newest one.
	 */
	const firstVersion = existingLog.indexOf("\n## [");
	const head = firstVersion === -1 ? existingLog.trimEnd() : existingLog.slice(0, firstVersion);
	const rest = firstVersion === -1 ? "" : existingLog.slice(firstVersion + 1);
	const added = section.slice(section.indexOf("## ["));
	await writeFile(changelogPath, `${head}\n\n${added.trim()}\n\n${rest}`.replace(/\n{3,}/g, "\n\n"));

	note("提交");
	await must("git", ["add", "--", ...ALL, "CHANGELOG.md"]);
	await must("git", ["commit", "-m", `chore(release): ${tag}`]);

	note("打 tag");
	const message = await must("node", ["scripts/changelog-section.mjs", tag]);
	const body = rehearsed ? message : `${message}\n\n注意：这次发布跳过了 Release dry run 的排练检查。`;
	await must("git", ["tag", "-a", tag, "-m", body]);

	if (noPush) {
		console.log(`\n没有推送。看一眼之后：\n  git push origin main && git push origin ${tag}\n撤销：\n  git reset --hard origin/main && git tag -d ${tag}\n`);
		return;
	}

	note("推送");
	await must("git", ["push", "origin", "main"]);
	await must("git", ["push", "origin", tag]);
	console.log(`\n✓ ${tag} 已推送。构建：https://github.com/kittors/Lyra/actions/workflows/release.yml\n`);
}

await main();
