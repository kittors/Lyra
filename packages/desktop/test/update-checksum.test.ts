/**
 * Reading a release's checksums, and deciding on a downloaded file.
 *
 * The parser is tested against the shapes `sha256sum` actually emits — the binary-mode asterisk in
 * particular, which differs by platform and would otherwise be discovered by a release that refuses
 * to install.
 *
 * The verdicts are tested apart because they mean different things to the person reading them: a
 * release with no checksums is old, a file that is not listed is probably our own naming, and a
 * mismatch is the only one that means something arrived wrong.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseChecksums, sha256, verify } from "../electron/update-checksum.ts";

const A = "a".repeat(64);
const B = "b".repeat(64);

test("解析：sha256sum 的两种写法都认", () => {
	// 文本模式两个空格，二进制模式一个空格加星号。哪种取决于 runner 上的 coreutils。
	const digests = parseChecksums(`${A}  Lyra-0.8.36-arm64.dmg\n${B} *Lyra-0.8.36-x64.exe\n`);
	assert.equal(digests.size, 2);
	assert.equal(digests.get("Lyra-0.8.36-arm64.dmg"), A);
	assert.equal(digests.get("Lyra-0.8.36-x64.exe"), B);
});

test("解析：大写摘要归一成小写，比较时才不会假不匹配", () => {
	const digests = parseChecksums(`${A.toUpperCase()}  x.dmg`);
	assert.equal(digests.get("x.dmg"), A);
});

test("解析：读不懂的行跳过，不影响其余", () => {
	const digests = parseChecksums(`# 注释\n\n${A}  good.dmg\n乱七八糟\nzz  short.dmg\n`);
	assert.equal(digests.size, 1);
	assert.equal(digests.get("good.dmg"), A);
});

test("解析：名字里有空格也能取全", () => {
	const digests = parseChecksums(`${A}  Lyra 0.8.36 arm64.dmg`);
	assert.equal(digests.get("Lyra 0.8.36 arm64.dmg"), A);
});

test("摘要：与已知向量一致", async () => {
	const dir = await mkdtemp(join(tmpdir(), "sum-"));
	const file = join(dir, "f");
	await writeFile(file, "abc");
	// SHA-256("abc")，公开的测试向量。
	assert.equal(await sha256(file), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("判定：对上了就放行", () => {
	assert.deepEqual(verify(new Map([["x.dmg", A]]), "x.dmg", A), { ok: true });
	// 大小写不该导致假不匹配。
	assert.deepEqual(verify(new Map([["x.dmg", A]]), "x.dmg", A.toUpperCase()), { ok: true });
});

test("判定：没有校验文件、没列进去、对不上，是三件不同的事", () => {
	const empty = verify(new Map(), "x.dmg", A);
	assert.equal(empty.ok, false);
	assert.equal(empty.ok === false && empty.reason, "no-checksums");

	const missing = verify(new Map([["y.dmg", A]]), "x.dmg", A);
	assert.equal(missing.ok === false && missing.reason, "not-listed");

	const wrong = verify(new Map([["x.dmg", A]]), "x.dmg", B);
	assert.equal(wrong.ok === false && wrong.reason, "mismatch");
	// 消息里带上两个摘要的开头，好让人能自己核对，而不是只知道「失败了」。
	assert.match(wrong.ok === false ? wrong.message : "", /aaaaaaaaaaaa/);
	assert.match(wrong.ok === false ? wrong.message : "", /bbbbbbbbbbbb/);
});

test("判定：改一个字节就会被抓住", async () => {
	const dir = await mkdtemp(join(tmpdir(), "sum-"));
	const file = join(dir, "pkg.zip");
	await writeFile(file, "正确的安装包内容");
	const good = await sha256(file);
	const digests = new Map([["pkg.zip", good]]);
	assert.deepEqual(verify(digests, "pkg.zip", await sha256(file)), { ok: true });

	await writeFile(file, "正确的安装包内容 "); // 多一个空格
	const tampered = verify(digests, "pkg.zip", await sha256(file));
	assert.equal(tampered.ok, false);
	assert.equal(tampered.ok === false && tampered.reason, "mismatch");
});
