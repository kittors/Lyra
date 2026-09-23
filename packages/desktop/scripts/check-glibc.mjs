/**
 * Whether anything in a Linux build needs a newer glibc than the .deb says it does.
 *
 * `pty.node` is compiled on the release runner, and on Ubuntu 24.04 it came out needing glibc
 * 2.34: `forkpty` and `openpty` moved from libutil into libc in that version, and linking against
 * it pins their new symbol versions. The .deb declared no libc6 at all, so apt installed it on
 * Ubuntu 20.04 and Debian 11 (glibc 2.31), where the app then died before opening a window.
 *
 * The floor is `libc6 (>= X)` in `deb.depends` — the one statement the package makes about it —
 * and this reads every ELF file in each `release/linux*-unpacked` build with `objdump -T` and fails
 * when any symbol needs more than X. The Electron binary is checked like everything else, so if its
 * own requirement ever rises past the declared floor, this is where that is found out rather than
 * on a user's machine. Linux only: that is the only place `objdump` reads these files.
 *
 *   node packages/desktop/scripts/check-glibc.mjs
 */

import { spawnSync } from "node:child_process";
import { closeSync, openSync, readdirSync, readFileSync, readSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "yaml";

/**
 * The versions of a library family a binary needs, each with the symbols that need it.
 *
 * `objdump -T` prints one dynamic symbol per line, with the version either bare (`GLIBC_2.2.5`,
 * the default version) or in parentheses (`(GLIBC_2.34)`). `GLIBC_PRIVATE` names no version, and
 * with the default prefix `GLIBCXX_…` (libstdc++) is a different library and does not match.
 */
export function glibcNeeds(objdumpOutput, prefix = "GLIBC_") {
	const pattern = new RegExp(`\\(?${prefix}(\\d+(?:\\.\\d+)+)\\)?\\s+(\\S+)\\s*$`);
	const needs = new Map();
	for (const line of objdumpOutput.split("\n")) {
		const match = pattern.exec(line);
		if (!match) continue;
		const [, version, symbol] = match;
		const symbols = needs.get(version) ?? [];
		if (!symbols.includes(symbol)) symbols.push(symbol);
		needs.set(version, symbols);
	}
	return needs;
}

export function compareVersions(a, b) {
	const left = a.split(".").map(Number);
	const right = b.split(".").map(Number);
	for (let index = 0; index < Math.max(left.length, right.length); index++) {
		const difference = (left[index] ?? 0) - (right[index] ?? 0);
		if (difference !== 0) return difference;
	}
	return 0;
}

/** The versions above `floor`, newest first, with the symbols that asked for them. */
export function overFloor(needs, floor) {
	return [...needs.entries()]
		.filter(([version]) => compareVersions(version, floor) > 0)
		.sort(([a], [b]) => compareVersions(b, a))
		.map(([version, symbols]) => ({ version, symbols }));
}

/** `X` from `libc6 (>= X)` in `deb.depends`, or null when the package states no floor. */
export function declaredGlibcFloor(config) {
	for (const dependency of config?.deb?.depends ?? []) {
		const match = /^libc6\s*\(\s*>=\s*(\d+(?:\.\d+)+)\s*\)$/.exec(String(dependency).trim());
		if (match) return match[1];
	}
	return null;
}

/** Every ELF file under `dir`, by its magic number rather than its name — `.so.1` and `Lyra` alike. */
function elfFiles(dir, found = []) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) elfFiles(path, found);
		// A symlink is not `isFile()` here, so `libvulkan.so` → `.so.1` is read once, not twice.
		else if (entry.isFile() && isElf(path)) found.push(path);
	}
	return found;
}

function isElf(path) {
	const head = Buffer.alloc(4);
	const fd = openSync(path, "r");
	try {
		return readSync(fd, head, 0, 4, 0) === 4 && head.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
	} finally {
		closeSync(fd);
	}
}

function main() {
	const release = fileURLToPath(new URL("../release/", import.meta.url));
	const config = parse(readFileSync(fileURLToPath(new URL("../electron-builder.yml", import.meta.url)), "utf8"));
	const floor = declaredGlibcFloor(config);
	if (!floor) {
		console.error("::error::electron-builder.yml 的 deb.depends 里没有 libc6 (>= …)，无从判断");
		process.exit(1);
	}

	const builds = readdirSync(release).filter((name) => /^linux(?:-[a-z0-9]+)?-unpacked$/.test(name));
	if (builds.length === 0) {
		console.error("::error::release/ 里没有 Linux 的解包产物，GLIBC 检查无从进行");
		process.exit(1);
	}

	let problems = 0;
	for (const build of builds) {
		for (const file of elfFiles(join(release, build))) {
			const name = relative(release, file);
			const dump = spawnSync("objdump", ["-T", file], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
			if (dump.status !== 0) {
				console.error(`::error::objdump 读不了 ${name}: ${dump.stderr || dump.error?.message || ""}`);
				problems++;
				continue;
			}
			const needs = glibcNeeds(dump.stdout);
			const newest = [...needs.keys()].sort(compareVersions).at(-1) ?? "—";
			// libstdc++ is reported, not gated: the package declares no libstdc++6 floor yet.
			const cxx = [...glibcNeeds(dump.stdout, "GLIBCXX_").keys()].sort(compareVersions).at(-1);
			console.log(`[glibc] ${name}: GLIBC ${newest}${cxx ? `, GLIBCXX ${cxx}` : ""}`);
			for (const { version, symbols } of overFloor(needs, floor)) {
				const shown = symbols.slice(0, 6).join(", ") + (symbols.length > 6 ? ", …" : "");
				console.error(`::error::${name} 需要 GLIBC_${version}（${shown}），高于 .deb 声明的 libc6 (>= ${floor})`);
				problems++;
			}
		}
	}
	if (problems > 0) {
		console.error(`[glibc] ${problems} 处超出 libc6 (>= ${floor})：要么在更老的 glibc 上编译这些原生模块，要么把 deb.depends 里的下限如实调高`);
		process.exit(1);
	}
	console.log(`[glibc] 全部不高于 libc6 (>= ${floor})`);
}

// Run only when invoked, never when a test imports the functions above.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
