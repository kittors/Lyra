/**
 * Whether each packaged build carries native binaries for the machine it is meant to run on.
 *
 * This exists because 0.8.35 shipped an arm64 Windows installer whose `koffi.node` was x64, and
 * nothing anywhere said so. The build succeeded, the app launched, and the mismatch could only be
 * met by running the Windows sandbox path on an arm64 machine — which is to say, by a user.
 *
 * **How it happened.** Prebuilt native modules ship one package per platform, and pnpm installs
 * only the one the installing machine needs. Every release job packages architectures that machine
 * is not: the Windows runner is x64 and builds x64 *and* arm64. `node-pty` escapes this by being
 * compiled rather than downloaded — electron-builder rebuilds it for the architecture being
 * packaged, and the arm64 installer's `pty.node` was correctly arm64. `koffi` is downloaded, so it
 * was whatever the runner needed. `pnpm-workspace.yaml` now installs every platform's copy; this
 * checks that the right one actually arrived in the build.
 *
 * Run after packaging, on whatever `release/` holds — see `package.mjs`. A failure here is a
 * release that must not go out.
 */

import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where `directories.output` puts builds, relative to the desktop package.
 *
 * `fileURLToPath`, not `.pathname`: the latter gives `/C:/…` on Windows, and every path below is
 * built from this one — a check that cannot find the builds would fail a release that is fine.
 */
const RELEASE_DIR = fileURLToPath(new URL("../release/", import.meta.url));

/**
 * electron-builder's name for each unpacked build, and what it means.
 *
 * The default architecture carries no suffix — `win-unpacked` is x64, `mac` is x64 — which is why
 * this is a table rather than a parse: an arch inferred by splitting on "-" reads `mac` as having
 * no architecture at all.
 */
const BUILDS = {
	mac: { platform: "darwin", arch: "x64", resources: "Lyra.app/Contents/Resources" },
	"mac-arm64": { platform: "darwin", arch: "arm64", resources: "Lyra.app/Contents/Resources" },
	"win-unpacked": { platform: "win32", arch: "x64", resources: "resources" },
	"win-arm64-unpacked": { platform: "win32", arch: "arm64", resources: "resources" },
	"linux-unpacked": { platform: "linux", arch: "x64", resources: "resources" },
};

/**
 * The architecture a compiled binary is actually for, read from its own header.
 *
 * Read rather than inferred from the path, because the path is exactly what was trusted before: a
 * file sitting in an arm64 build is not an arm64 file, and that was the bug.
 */
function binaryArch(file) {
	// The header alone, rather than the file: these run to megabytes, and everything read below
	// lives in the first few dozen bytes.
	const buffer = Buffer.alloc(0x400);
	let read = 0;
	try {
		const fd = openSync(file, "r");
		try {
			read = readSync(fd, buffer, 0, buffer.length, 0);
		} finally {
			closeSync(fd);
		}
	} catch {
		return null;
	}
	if (read < 64) return null;
	const head = buffer.subarray(0, read);

	// PE — Windows. 'MZ', then a pointer at 0x3c to 'PE\0\0' and the machine word.
	if (head[0] === 0x4d && head[1] === 0x5a) {
		const pe = head.readUInt32LE(0x3c);
		// A header claiming an offset past what was read is one this cannot speak for.
		if (pe + 6 > read || head.toString("ascii", pe, pe + 4) !== "PE\0\0") return null;
		return { 0x8664: "x64", 0xaa64: "arm64", 0x14c: "ia32" }[head.readUInt16LE(pe + 4)] ?? null;
	}

	// Mach-O — macOS.
	const magic = head.readUInt32LE(0);
	// A universal binary holds several architectures and is correct for all of them. Read as
	// little-endian, `0xCAFEBABE` and its 64-bit form come out reversed.
	if (magic === 0xbebafeca || magic === 0xbfbafeca) return "universal";
	// 64-bit Mach-O; the cputype's high bit is the 64-bit flag.
	if (magic === 0xfeedfacf) {
		return { 0x01000007: "x64", 0x0100000c: "arm64" }[head.readUInt32LE(4)] ?? null;
	}

	// ELF — Linux.
	if (head.toString("ascii", 0, 4) === "\x7fELF") {
		return { 0x3e: "x64", 0xb7: "arm64" }[head.readUInt16LE(18)] ?? null;
	}

	return null;
}

/** Every `.node` under a directory, with the package that owns it. */
function nativeModules(dir, found = []) {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return found;
	}
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) nativeModules(path, found);
		else if (entry.name.endsWith(".node")) found.push(path);
	}
	return found;
}

/**
 * The `os`/`cpu` a package declares, from the nearest `package.json` above a file.
 *
 * A package that declares them is a per-platform prebuilt: six of them sit in every build, and five
 * being "wrong" is not a fault — it is how `koffi` ships. What matters is that the sixth is there.
 * A package that declares neither is compiled for this build alone, and must match.
 *
 * The other way a prebuilt says who it is for is its directory. `node-pty` ships one package with
 * a `prebuilds/darwin-arm64/`, a `prebuilds/win32-x64/` and so on, declares nothing in its
 * manifest, and loads `build/Release` — compiled here, for this build — before it looks at any of
 * them. Read the same way as a manifest declaration: the copy for this platform must be right,
 * the others are simply not for this machine. Without this, every mac build failed on the Windows
 * prebuilts inside it, and the check that exists to catch a wrong binary was crying wolf.
 */
function owningPackage(file, root) {
	const prebuilt = /[\\/]prebuilds[\\/]([a-z0-9]+)-([a-z0-9]+)[\\/]/.exec(file.slice(root.length));
	if (prebuilt) return { name: `prebuilds/${prebuilt[1]}-${prebuilt[2]}`, os: [prebuilt[1]], cpu: [prebuilt[2]] };
	for (let dir = join(file, ".."); dir.startsWith(root); dir = join(dir, "..")) {
		try {
			const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
			return {
				name: manifest.name ?? dir,
				os: manifest.os ?? null,
				cpu: manifest.cpu ?? null,
			};
		} catch {
			// Not a package root; keep walking up.
		}
	}
	return null;
}

const problems = [];
let checked = 0;

for (const [name, build] of Object.entries(BUILDS)) {
	const dir = join(RELEASE_DIR, name);
	try {
		if (!statSync(dir).isDirectory()) continue;
	} catch {
		// This platform was not built here. Each runner builds its own.
		continue;
	}

	const modules = join(dir, build.resources, "app.asar.unpacked", "node_modules");
	const binaries = nativeModules(modules);
	if (binaries.length === 0) {
		problems.push(`${name}: no native modules found under ${build.resources} — asarUnpack may have stopped matching`);
		continue;
	}

	/** Per-platform prebuilts whose declaration matches this build. At least one must exist. */
	let matchingPrebuilts = 0;

	for (const file of binaries) {
		const owner = owningPackage(file, modules);
		const actual = binaryArch(file);
		const relative = file.slice(modules.length + 1);
		checked++;

		if (actual == null) {
			problems.push(`${name}: ${relative} — unreadable header, cannot confirm its architecture`);
			continue;
		}

		const declared = owner?.os != null || owner?.cpu != null;
		if (!declared) {
			// Compiled for this build. Anything but a match means it was built for the wrong target —
			// except a universal binary, which is every target at once.
			if (actual !== "universal" && actual !== build.arch) {
				problems.push(`${name}: ${relative} is ${actual}, expected ${build.arch}`);
			}
			continue;
		}

		const forThisBuild =
			(owner.os == null || owner.os.includes(build.platform)) && (owner.cpu == null || owner.cpu.includes(build.arch));
		if (!forThisBuild) continue;

		matchingPrebuilts++;
		// The package claims to be for this target, so its binary has to be as well.
		if (actual !== "universal" && actual !== build.arch) {
			problems.push(`${name}: ${relative} claims ${build.platform}/${build.arch} but is ${actual}`);
		}
	}

	if (matchingPrebuilts === 0) {
		problems.push(
			`${name}: no per-platform prebuilt for ${build.platform}/${build.arch} — pnpm installed only the host's copy. ` +
				`See supportedArchitectures in pnpm-workspace.yaml; an existing node_modules must be removed for a change there to take effect.`,
		);
	}

	console.log(`[arch] ${name}: ${binaries.length} native ${binaries.length === 1 ? "module" : "modules"}, ${build.arch}`);
}

if (checked === 0) {
	console.log("[arch] no unpacked builds in release/ — nothing to check");
	process.exit(0);
}

if (problems.length > 0) {
	console.error("\n[arch] native binaries do not match the build they are in:\n");
	for (const problem of problems) console.error(`  ${problem}`);
	console.error("\nThis ships an app that fails only on the user's machine. See scripts/check-native-arch.mjs.");
	process.exit(1);
}

console.log(`[arch] ${checked} native binaries, all matching their build`);
