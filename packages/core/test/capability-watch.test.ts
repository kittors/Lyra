/**
 * 改一个技能文件，会话就能看见——以及一轮跑到一半时它不会看见。
 *
 * 那份 `watched` 名单一直被收集着：每个 provider 都老实报了自己读过哪些目录，注册表也把它们
 * 合起来了，而 `LoadedCapabilities` 从来没带上它——收集原料收集了很久，工厂一直没建。
 *
 * 这个文件测的两件事，一件是「它真的会重载」，另一件更要紧：**一轮跑到一半时它绝不替换**。
 * 模型正按当前那份技能清单做决策，中途换掉，`skill://x` 会指向一个已经不在的东西。
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { CapabilityWatcher } from "../src/runtime/capability-watch.ts";

let root: string;

before(async () => {
	root = await mkdtemp(join(tmpdir(), "ly-watch-"));
});

after(async () => {
	await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
});

/** 等到 `check()` 为真，或者超时。轮询而不是定时，因为文件事件的延迟在各平台上差别很大。 */
async function until(check: () => boolean, ms = 3000): Promise<boolean> {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		if (check()) return true;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	return check();
}

async function scratch(name: string): Promise<string> {
	const dir = join(root, name);
	await mkdir(dir, { recursive: true });
	return dir;
}

test("目录里的文件变了，会重载", async () => {
	const dir = await scratch("live");
	let reloads = 0;
	const watcher = new CapabilityWatcher({ dirs: [dir], idle: () => true, reload: async () => void (reloads += 1), debounceMs: 30 });

	try {
		assert.equal(watcher.watching, 1);
		await writeFile(join(dir, "SKILL.md"), "---\nname: x\n---\n", "utf8");
		assert.ok(await until(() => reloads > 0), "写了文件之后该重载一次");
	} finally {
		watcher.close();
	}
});

test("一轮跑到一半，改动排队而不是替换", async () => {
	/*
	 * 这是硬约束。模型正按当前那份技能清单做决策；中途换掉，`skill://x` 会指向一个已经不在的
	 * 东西——而它是模型上一句话里刚读过的。
	 */
	const dir = await scratch("busy");
	let reloads = 0;
	let busy = true;
	const watcher = new CapabilityWatcher({ dirs: [dir], idle: () => !busy, reload: async () => void (reloads += 1), debounceMs: 30 });

	try {
		await writeFile(join(dir, "a.md"), "1", "utf8");
		await new Promise((resolve) => setTimeout(resolve, 250));
		assert.equal(reloads, 0, "跑着的时候不换");
		assert.equal(watcher.waiting, true, "但记着有东西等着换");

		busy = false;
		await watcher.resume();
		assert.equal(reloads, 1, "一轮结束，现在换");
		assert.equal(watcher.waiting, false);
	} finally {
		watcher.close();
	}
});

test("什么都没排队时，resume 不会白重载一次", async () => {
	const dir = await scratch("quiet");
	let reloads = 0;
	const watcher = new CapabilityWatcher({ dirs: [dir], idle: () => true, reload: async () => void (reloads += 1), debounceMs: 30 });

	try {
		await watcher.resume();
		assert.equal(reloads, 0, "每一轮结束都重读一遍全部技能，是白花的时间");
	} finally {
		watcher.close();
	}
});

test("一串改动只重载一次", async () => {
	/*
	 * 保存一个文件在 macOS 上能产生三四个事件，`git checkout` 一个分支能产生几百个。
	 * 每个都触发一次全量重载，等于换分支时把插件目录读上几百遍。
	 */
	const dir = await scratch("burst");
	let reloads = 0;
	const watcher = new CapabilityWatcher({ dirs: [dir], idle: () => true, reload: async () => void (reloads += 1), debounceMs: 80 });

	try {
		for (let i = 0; i < 12; i += 1) await writeFile(join(dir, `f${i}.md`), "x", "utf8");
		assert.ok(await until(() => reloads > 0));
		await new Promise((resolve) => setTimeout(resolve, 200));
		assert.equal(reloads, 1, `十二个文件应该合成一次重载，实际 ${reloads} 次`);
	} finally {
		watcher.close();
	}
});

test("不存在的目录不会让会话起不来", async () => {
	/*
	 * 大多数项目没有大多数这些目录。一个建不了的监听是常态，不是错误。
	 */
	const watcher = new CapabilityWatcher({
		dirs: [join(root, "根本没有这个目录"), await scratch("real")],
		idle: () => true,
		reload: async () => {},
	});
	try {
		assert.equal(watcher.watching, 1, "在的那个听上了，不在的那个跳过");
	} finally {
		watcher.close();
	}
});

test("重载抛错不会带走监听", async () => {
	/*
	 * 一个写了一半的技能文件会让加载抛错。如果那次抛错关掉了监听，写完那一半之后就再也没有
	 * 人在听了——而人正等着看它生效。
	 */
	const dir = await scratch("throws");
	let calls = 0;
	const watcher = new CapabilityWatcher({
		dirs: [dir],
		idle: () => true,
		reload: async () => {
			calls += 1;
			if (calls === 1) throw new Error("frontmatter 写了一半");
		},
		debounceMs: 30,
	});

	try {
		await writeFile(join(dir, "a.md"), "1", "utf8");
		assert.ok(await until(() => calls >= 1));
		await writeFile(join(dir, "a.md"), "2", "utf8");
		assert.ok(await until(() => calls >= 2), "第一次抛了错，第二次还得听得见");
	} finally {
		watcher.close();
	}
});

test("关掉之后不再重载", async () => {
	const dir = await scratch("closed");
	let reloads = 0;
	const watcher = new CapabilityWatcher({ dirs: [dir], idle: () => true, reload: async () => void (reloads += 1), debounceMs: 30 });
	watcher.close();

	await writeFile(join(dir, "a.md"), "1", "utf8");
	await new Promise((resolve) => setTimeout(resolve, 200));
	assert.equal(reloads, 0);
	assert.equal(watcher.watching, 0);
});
