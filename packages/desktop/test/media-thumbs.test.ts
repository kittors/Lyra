/**
 * 缩略图算过就不再算——这个文件守的是「算过没有」那半边。
 *
 * 缩放本身要 Electron 的 `nativeImage`，测不了也不该在这里测；注进去的 `shrink` 数自己被调了
 * 几次，而那个次数就是全部的问题所在：量过一次缩放要 28ms 且同步占住主进程，十张一起就是
 * 「整个应用哑了 91ms」。所以下面每一条断言的都是它**没有**被多调一次。
 */

import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { cachedThumb, parkedThumb, thumbPath } from "../electron/media-thumbs.ts";

const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

async function home(): Promise<string> {
	return mkdtemp(join(tmpdir(), "lyra-thumbs-"));
}

function deps(calls: { shrink: number; source: number }, out: Uint8Array | null = PNG) {
	return {
		source: async () => {
			calls.source++;
			return new Uint8Array([9, 9, 9]);
		},
		shrink: () => {
			calls.shrink++;
			return out;
		},
	};
}

test("盘上有就读盘上的，既不读原图也不再缩一次", async () => {
	const dir = await home();
	try {
		const path = thumbPath(dir, "a".repeat(40) + ".png", 128);
		await mkdir(join(dir, "thumbs"), { recursive: true });
		await writeFile(path, PNG);
		const calls = { shrink: 0, source: 0 };
		const got = await parkedThumb(dir, "a".repeat(40) + ".png", 128, deps(calls));
		assert.deepEqual(got && [...got], [...PNG]);
		assert.equal(calls.shrink, 0, "盘上已经有了还去缩一次");
		assert.equal(calls.source, 0, "缩略图命中时不该再把原图读进来");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("第一次算完写下来，第二次直接命中", async () => {
	const dir = await home();
	try {
		const name = "b".repeat(40) + ".png";
		const calls = { shrink: 0, source: 0 };
		const first = await parkedThumb(dir, name, 128, deps(calls));
		assert.deepEqual(first && [...first], [...PNG]);
		assert.equal(calls.shrink, 1);
		assert.deepEqual([...(await readFile(thumbPath(dir, name, 128)))], [...PNG], "算完没落盘，下次还得重算");
		const second = await parkedThumb(dir, name, 128, deps(calls));
		assert.deepEqual(second && [...second], [...PNG]);
		assert.equal(calls.shrink, 1, "第二次又缩了一遍");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("十个 img 同时挂上去，只缩一次", async () => {
	const dir = await home();
	try {
		const name = "c".repeat(40) + ".png";
		const calls = { shrink: 0, source: 0 };
		const all = await Promise.all(Array.from({ length: 10 }, () => parkedThumb(dir, name, 128, deps(calls))));
		assert.equal(calls.shrink, 1, "并发没有合流，一张图缩了多次");
		for (const one of all) assert.deepEqual(one && [...one], [...PNG]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("同一张图的两个尺寸各存各的，不互相覆盖", async () => {
	const dir = await home();
	try {
		const name = "d".repeat(40) + ".png";
		assert.notEqual(thumbPath(dir, name, 128), thumbPath(dir, name, 512));
		const calls = { shrink: 0, source: 0 };
		await parkedThumb(dir, name, 128, deps(calls));
		await parkedThumb(dir, name, 512, deps(calls));
		assert.equal(calls.shrink, 2, "两个尺寸被当成同一个");
		assert.ok(await cachedThumb(dir, name, 128));
		assert.ok(await cachedThumb(dir, name, 512));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("写不进盘也照样交货，只是下次还得再算", async () => {
	const dir = await home();
	try {
		const name = "e".repeat(40) + ".png";
		// 把 thumbs 占成一个文件，`mkdir` 和 `writeFile` 都会失败。
		await writeFile(join(dir, "thumbs"), "不是目录");
		const calls = { shrink: 0, source: 0 };
		const got = await parkedThumb(dir, name, 128, deps(calls));
		assert.deepEqual(got && [...got], [...PNG], "写盘失败把这张图也弄丢了");
		assert.equal(await cachedThumb(dir, name, 128), null);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("本来就比要的还小，就说没有缩略图，让调用方发原图", async () => {
	const dir = await home();
	try {
		const name = "f".repeat(40) + ".png";
		const calls = { shrink: 0, source: 0 };
		assert.equal(await parkedThumb(dir, name, 128, deps(calls, null)), null);
		assert.equal(await cachedThumb(dir, name, 128), null, "不该为一张没缩的图留下空缓存");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("原图读不出来时不留下空文件", async () => {
	const dir = await home();
	try {
		const name = "0".repeat(40) + ".png";
		let shrank = 0;
		const got = await parkedThumb(dir, name, 128, {
			source: async () => null,
			shrink: () => {
				shrank++;
				return PNG;
			},
		});
		assert.equal(got, null);
		assert.equal(shrank, 0, "原图都没有还去缩");
		assert.equal(await cachedThumb(dir, name, 128), null);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
