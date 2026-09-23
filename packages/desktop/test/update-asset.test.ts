/**
 * Which file a release hands to which machine.
 *
 * The names below are the real v0.6.1 release, in the order GitHub returns them — alphabetical,
 * which is what made this go wrong: `Lyra-0.6.1-arm64.exe` sorts before `Lyra-0.6.1-x64.exe`, and
 * picking the first `.exe` therefore handed every Intel Windows machine an ARM installer. Same for
 * Linux and the AppImage. It downloaded a hundred megabytes and failed at the last step.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { pickAsset, type ReleaseAsset } from "../electron/update-asset.ts";

/** As returned by the GitHub API for https://github.com/kittors/Lyra/releases/tag/v0.6.1 */
const RELEASE: ReleaseAsset[] = [
	"Lyra-0.6.1-amd64.deb",
	"Lyra-0.6.1-arm64.AppImage",
	"Lyra-0.6.1-arm64.deb",
	"Lyra-0.6.1-arm64.dmg",
	"Lyra-0.6.1-arm64.exe",
	"Lyra-0.6.1-arm64.zip",
	"Lyra-0.6.1-x64.dmg",
	"Lyra-0.6.1-x64.exe",
	"Lyra-0.6.1-x64.zip",
	"Lyra-0.6.1-x86_64.AppImage",
	"Lyra-0.6.1.exe",
].map((name) => ({ name, browser_download_url: `https://example.com/${name}`, size: 1 }));

const chosen = (platform: string, arch: string) => pickAsset(RELEASE, platform, arch)?.name ?? null;

test("each machine is offered the build made for it", () => {
	assert.equal(chosen("darwin", "arm64"), "Lyra-0.6.1-arm64.zip");
	assert.equal(chosen("darwin", "x64"), "Lyra-0.6.1-x64.zip");
	assert.equal(chosen("win32", "arm64"), "Lyra-0.6.1-arm64.exe");
	assert.equal(chosen("win32", "x64"), "Lyra-0.6.1-x64.exe", "an Intel PC was being sent the ARM installer");
	assert.equal(chosen("linux", "arm64"), "Lyra-0.6.1-arm64.AppImage");
	assert.equal(chosen("linux", "x64"), "Lyra-0.6.1-x86_64.AppImage", "AppImage spells it x86_64, not x64");
});

test("macOS takes the zip, which can be swapped in place, not the dmg you have to drag", () => {
	for (const arch of ["arm64", "x64"]) assert.match(chosen("darwin", arch)!, /\.zip$/);
});

test("a release with only the other architecture offers nothing rather than the wrong thing", () => {
	const armOnly = RELEASE.filter((asset) => asset.name!.includes("arm64"));
	assert.equal(pickAsset(armOnly, "win32", "x64"), null);
	assert.equal(pickAsset(armOnly, "darwin", "x64"), null);
	assert.equal(pickAsset(armOnly, "linux", "x64"), null);
});

test("a file naming no architecture is treated as universal, which is what it is", () => {
	// The combined NSIS installer carries both, and older releases predate architecture suffixes.
	const universal: ReleaseAsset[] = [
		{ name: "Lyra-0.6.1.exe", browser_download_url: "https://example.com/u.exe", size: 1 },
		{ name: "Lyra-0.6.1.zip", browser_download_url: "https://example.com/u.zip", size: 1 },
		{ name: "Lyra-0.6.1.AppImage", browser_download_url: "https://example.com/u.AppImage", size: 1 },
	];
	assert.equal(pickAsset(universal, "win32", "x64")?.name, "Lyra-0.6.1.exe");
	assert.equal(pickAsset(universal, "win32", "arm64")?.name, "Lyra-0.6.1.exe");
	assert.equal(pickAsset(universal, "darwin", "arm64")?.name, "Lyra-0.6.1.zip");
	assert.equal(pickAsset(universal, "linux", "x64")?.name, "Lyra-0.6.1.AppImage");
});

test("x86_64 is not read as 'not arm64' — it names an architecture of its own", () => {
	const intelOnly: ReleaseAsset[] = [
		{ name: "Lyra-0.6.1-x86_64.AppImage", browser_download_url: "https://example.com/a", size: 1 },
	];
	assert.equal(pickAsset(intelOnly, "linux", "arm64"), null);
});

/*
 * This used to be "Linux falls back to the .deb when no AppImage matches" — and to prefer the
 * AppImage for everyone, so a .deb install was offered an AppImage nothing would put in place.
 * Now the format follows the install, in both directions.
 */
test("a .deb install is offered the .deb, and never the AppImage", () => {
	assert.equal(pickAsset(RELEASE, "linux", "x64", "deb")?.name, "Lyra-0.6.1-amd64.deb");
	assert.equal(pickAsset(RELEASE, "linux", "arm64", "deb")?.name, "Lyra-0.6.1-arm64.deb");
});

test("an AppImage is offered an AppImage, and never a .deb it cannot install", () => {
	const debs = RELEASE.filter((asset) => asset.name!.endsWith(".deb"));
	assert.equal(pickAsset(debs, "linux", "x64", "appimage"), null);
	assert.equal(pickAsset(RELEASE, "linux", "x64", "appimage")?.name, "Lyra-0.6.1-x86_64.AppImage");
});

test("an rpm install, or a copy no package manager owns, is sent to the release page", () => {
	assert.equal(pickAsset(RELEASE, "linux", "x64", "rpm"), null);
	assert.equal(pickAsset(RELEASE, "linux", "x64", "unmanaged"), null);
	const withRpm: ReleaseAsset[] = [{ name: "Lyra-0.6.1-x86_64.rpm", browser_download_url: "https://example.com/r", size: 1 }];
	assert.equal(pickAsset(withRpm, "linux", "x64", "rpm")?.name, "Lyra-0.6.1-x86_64.rpm");
});

test("a release with nothing installable says so, rather than offering a source tarball", () => {
	const sources: ReleaseAsset[] = [
		{ name: "Source code (zip)", browser_download_url: "https://example.com/s", size: 1 },
	];
	assert.equal(pickAsset(sources, "win32", "x64"), null);
	assert.equal(pickAsset([], "darwin", "arm64"), null);
});
