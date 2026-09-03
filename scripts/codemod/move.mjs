#!/usr/bin/env node
/**
 * Move files and fix every import that pointed at them.
 *
 * A directory reorganisation is dozens of `git mv` and hundreds of edited import paths. Done by
 * hand it is an afternoon of tedium with a broken build at the end; the tedium is not the problem,
 * the *silence* is — a missed path is a type error, but a path that resolves to the wrong file
 * compiles fine.
 *
 * So: `git mv` for the history (`--follow` keeps working), then rewrite every relative specifier in
 * the package that pointed at a moved file. Run `tsc --noEmit` afterwards; it is the proof.
 *
 *   node scripts/codemod/move.mjs <map.json>
 *
 * The map is `{ "old/path.ts": "new/path.ts" }`, relative to the package root.
 */

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const [mapPath, packageRootArg] = process.argv.slice(2);
if (!mapPath) {
	console.error("用法: node scripts/codemod/move.mjs <map.json> [包根目录]");
	process.exit(2);
}
const PACKAGE_ROOT = resolve(packageRootArg ?? "packages/desktop");

/** @type {Record<string, string>} */
const moves = JSON.parse(await readFile(mapPath, "utf8"));

// 1. Read everything first, while the old paths are still the real ones.
const { stdout } = await run("git", ["ls-files", "*.ts", "*.tsx"], { cwd: PACKAGE_ROOT });
const sources = stdout.split("\n").filter(Boolean);

/** Absolute old path → absolute new path, for every file being moved. */
const movedAbsolute = new Map(
	Object.entries(moves).map(([from, to]) => [resolve(PACKAGE_ROOT, from), resolve(PACKAGE_ROOT, to)]),
);

/** The text of every source file, keyed by its *old* absolute path. */
const before = new Map();
for (const file of sources) {
	const at = resolve(PACKAGE_ROOT, file);
	before.set(at, await readFile(at, "utf8"));
}

// 2. Move, keeping history. `--follow` and `git log` keep working across this.
for (const [from, to] of Object.entries(moves)) {
	await mkdir(dirname(join(PACKAGE_ROOT, to)), { recursive: true });
	await run("git", ["mv", from, to], { cwd: PACKAGE_ROOT });
}
console.log(`移动 ${Object.keys(moves).length} 个文件`);

/*
 * 3. Rewrite specifiers, using the text captured in step 1.
 *
 * Reading after the move would mean resolving `./sibling.ts` against a directory the sibling is no
 * longer in — which is how a rename inside a move silently produces a dangling import.
 */
let rewritten = 0;
let edits = 0;

for (const [wasAt, text] of before) {
	// Where it is now, which is the frame every rewritten specifier is relative to.
	const livesAt = movedAbsolute.get(wasAt) ?? wasAt;

	let changed = false;
	const next = text.replace(/(from\s+"|import\("|require\(")(\.[^"]+)"/g, (whole, prefix, specifier) => {
		/*
		 * Resolved against where the file *was*, not where it is going.
		 *
		 * The text has not moved yet, so a sibling import like `./code-themes.ts` still means the
		 * old directory — which is exactly where the map has an entry for it. Resolving against the
		 * new location would look in a directory that does not contain it yet, and the import would
		 * be left pointing at a name that no longer exists.
		 */
		const pointsAt = resolve(dirname(wasAt), specifier);

		/*
		 * Two cases, and missing the second is what makes a move look like it worked.
		 *
		 * The target moved: point at where it went.
		 *
		 * The target did *not* move, but this file did: the specifier still names the right file and
		 * is now written from the wrong place. `../store.ts` from `src/App.tsx` and from
		 * `src/app/App.tsx` are two different files, and only one of them exists.
		 */
		const now = movedAbsolute.get(pointsAt) ?? (livesAt === wasAt ? undefined : pointsAt);
		if (!now) return whole;

		let rebuilt = relative(dirname(livesAt), now).replaceAll("\\", "/");
		if (!rebuilt.startsWith(".")) rebuilt = `./${rebuilt}`;
		if (rebuilt === specifier) return whole;
		changed = true;
		edits++;
		return `${prefix}${rebuilt}"`;
	});

	if (changed) {
		await writeFile(livesAt, next);
		rewritten++;
	}
}

console.log(`改写 ${rewritten} 个文件里的 ${edits} 处导入`);
console.log("\n现在跑 `pnpm typecheck`——它是这次搬家有没有断链的唯一凭据。");
