/**
 * How a Linux copy of Lyra was installed, and how an update is put in place for each kind.
 *
 * The updater used to pick the AppImage for every Linux machine, hand it to `xdg-open` — which
 * does not run AppImages; GNOME answers 「无法打开」 — and leave it in the update cache. Even run,
 * the new copy lost the single-instance lock to the old one and exited at once, and nothing ever
 * replaced `$APPIMAGE` or `/opt/Lyra`.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { debInstallCommand, detectLinuxInstall, stageAppImage, stagedAppImagePath, swapAppImage } from "../electron/linux-install.ts";

const nobody = async () => false;

test("an AppImage knows it is one: the runtime sets APPIMAGE to the file itself", async () => {
	const install = await detectLinuxInstall({ env: { APPIMAGE: "/home/me/Apps/Lyra.AppImage" }, execPath: "/tmp/.mount_LyraX/lyra", packaged: true, owns: nobody });
	assert.deepEqual(install, { kind: "appimage", path: "/home/me/Apps/Lyra.AppImage" });
});

test("a .deb install is one dpkg owns the binary of", async () => {
	const asked: string[] = [];
	const install = await detectLinuxInstall({
		env: {},
		execPath: "/opt/Lyra/Lyra",
		packaged: true,
		owns: async (manager, path) => (asked.push(`${manager} ${path}`), manager === "dpkg"),
	});
	assert.deepEqual(install, { kind: "deb" });
	assert.deepEqual(asked, ["dpkg /opt/Lyra/Lyra"]);
});

test("rpm is asked only when dpkg does not own it, and anything else is unmanaged", async () => {
	assert.deepEqual(await detectLinuxInstall({ env: {}, execPath: "/usr/lib/lyra/Lyra", packaged: true, owns: async (manager) => manager === "rpm" }), { kind: "rpm" });
	assert.deepEqual(await detectLinuxInstall({ env: {}, execPath: "/home/me/lyra/Lyra", packaged: true, owns: nobody }), { kind: "unmanaged" });
	// A development run is never an installation, whatever owns what.
	assert.deepEqual(await detectLinuxInstall({ env: {}, execPath: "/usr/bin/electron", packaged: false, owns: async () => true }), { kind: "unmanaged" });
});

test("the update is staged beside the AppImage, executable, so the swap is a rename on one filesystem", async () => {
	const dir = mkdtempSync(join(tmpdir(), "lyra-appimage-"));
	const cache = mkdtempSync(join(tmpdir(), "lyra-cache-"));
	try {
		const target = join(dir, "Lyra 0.9.19.AppImage");
		writeFileSync(target, "old");
		const downloaded = join(cache, "Lyra-0.9.20-x86_64.AppImage");
		writeFileSync(downloaded, "new");

		const staged = await stageAppImage(downloaded, target);
		assert.equal(staged, stagedAppImagePath(target));
		assert.equal(join(staged, ".."), dir, "staged somewhere else, the rename would not be atomic");
		assert.equal(readFileSync(target, "utf8"), "old", "staging must not touch the running copy");
		if (process.platform !== "win32") assert.equal(statSync(staged).mode & 0o777, 0o755);

		await swapAppImage(staged, target);
		assert.equal(readFileSync(target, "utf8"), "new");
		assert.throws(() => statSync(staged), "nothing is left behind beside it");
	} finally {
		rmSync(dir, { recursive: true, force: true });
		rmSync(cache, { recursive: true, force: true });
	}
});

test("staging twice replaces the earlier stage rather than failing on it", async () => {
	const dir = mkdtempSync(join(tmpdir(), "lyra-appimage-"));
	try {
		const target = join(dir, "Lyra.AppImage");
		writeFileSync(target, "old");
		writeFileSync(join(dir, "a"), "first");
		writeFileSync(join(dir, "b"), "second");
		await stageAppImage(join(dir, "a"), target);
		const staged = await stageAppImage(join(dir, "b"), target);
		assert.equal(readFileSync(staged, "utf8"), "second");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a .deb is installed through pkexec with apt-get, which also brings in new dependencies", () => {
	const present: Record<string, string> = { pkexec: "/usr/bin/pkexec", "apt-get": "/usr/bin/apt-get", dpkg: "/usr/bin/dpkg" };
	const find = (command: string) => present[command] ?? null;
	assert.deepEqual(debInstallCommand("/home/me/.config/Lyra/updates/Lyra-0.9.20-amd64.deb", find), {
		file: "/usr/bin/pkexec",
		args: ["/usr/bin/apt-get", "install", "-y", "/home/me/.config/Lyra/updates/Lyra-0.9.20-amd64.deb"],
	});
	delete present["apt-get"];
	assert.deepEqual(debInstallCommand("/x/Lyra.deb", find), { file: "/usr/bin/pkexec", args: ["/usr/bin/dpkg", "-i", "/x/Lyra.deb"] });
	// No way to ask for the password: nothing this process can run will install it.
	delete present.pkexec;
	assert.equal(debInstallCommand("/x/Lyra.deb", find), null);
});
