#!/usr/bin/env node
/**
 * Every relative link in the committed Markdown points at something that exists.
 *
 * README linked to three files that were never written — `docs/README.md`, `docs/extending.md`,
 * `docs/capabilities.md` — and they sat on the front page of a public repository for as long as
 * `docs/` had been in `.gitignore`. Nothing was going to notice: a broken link renders as a link.
 *
 * Only tracked files are checked, and only relative targets. An http link that rots is a different
 * problem and checking it would make this need the network.
 */

import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const { stdout } = await run("git", ["ls-files", "*.md"], { cwd: ROOT });
const files = stdout.split("\n").filter(Boolean);

/** `[text](target)`, skipping images and anything absolute. */
const LINK = /\[[^\]]*\]\(([^)]+)\)/g;

let broken = 0;

for (const file of files) {
	const text = await readFile(join(ROOT, file), "utf8");
	for (const [, raw] of text.matchAll(LINK)) {
		const target = raw.trim();
		// External, in-page anchors, and mailto are somebody else's problem.
		if (/^(https?:|mailto:|#)/.test(target)) continue;

		// `path#anchor` — the anchor is not checked, only that the file is there.
		const path = target.split("#")[0];
		if (!path) continue;

		const absolute = resolve(join(ROOT, dirname(file)), path);
		const exists = await stat(absolute).then(
			() => true,
			() => false,
		);
		if (!exists) {
			console.error(`${file} → ${target}`);
			broken++;
		}
	}
}

if (broken > 0) {
	console.error(`\n${broken} 个链接指向不存在的文件`);
	process.exit(1);
}
console.log(`${files.length} 个 Markdown 文件，链接全部有效`);
