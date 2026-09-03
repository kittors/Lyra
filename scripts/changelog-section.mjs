#!/usr/bin/env node
/**
 * One version's section out of CHANGELOG.md.
 *
 * The release workflow needs it twice — as the tag's message and as the release body — and both
 * used to be `git log` piped through `sed`, which is why the notes read like a log. Reading them
 * back out of the changelog means the file people edit is the file people see.
 *
 * Usage: `node scripts/changelog-section.mjs v0.8.36`
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const tag = process.argv[2];
if (!tag) {
	console.error("用法: node scripts/changelog-section.mjs <tag>");
	process.exit(2);
}

const version = tag.replace(/^v/, "");
const changelog = await readFile(join(ROOT, "CHANGELOG.md"), "utf8");

/*
 * Anchored on the heading rather than on a version number anywhere in the text.
 *
 * A commit body can mention "0.8.36" — the release commit for it certainly does — and a looser
 * match would start the section in the middle of somebody's sentence.
 */
const lines = changelog.split("\n");
const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
if (start === -1) {
	console.error(`CHANGELOG.md 里没有 ${version} 这一节。先跑 git-cliff 生成它。`);
	process.exit(1);
}

const rest = lines.slice(start + 1);
const end = rest.findIndex((line) => line.startsWith("## ["));
const body = (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();

process.stdout.write(`${body}\n`);
