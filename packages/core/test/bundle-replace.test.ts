/**
 * Updating and uninstalling a bundle whose files something still has open.
 *
 * On Windows a running `.exe`, or a `.node` module a server has loaded, cannot be deleted. `rm -r`
 * deletes everything around it and then fails: an update left the old version half gone and threw
 * the new one away with the staging directory, and an uninstall left a bundle that was neither
 * installed nor removable. Renaming the directory is refused whole instead — which is what makes
 * "move the old one aside, move the new one in, then delete" something that can be undone.
 *
 * The lock is simulated the way Windows applies it: removing files around the locked one works and
 * then fails, renaming the directory that holds it fails outright.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fsPromises, { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test, type TestContext } from "node:test";
import { promisify } from "node:util";

import type { RegistryEntry } from "@lyra/registry-shared";

import { bundleRoot, installEntry, uninstallEntry } from "../src/plugins/registry.ts";

const run = promisify(execFile);

async function withHome(body: (home: string) => Promise<void>): Promise<void> {
	const home = await mkdtemp(join(tmpdir(), "lyra-replace-"));
	const previous = process.env.LYRA_HOME;
	process.env.LYRA_HOME = home;
	try {
		await body(home);
	} finally {
		if (previous === undefined) delete process.env.LYRA_HOME;
		else process.env.LYRA_HOME = previous;
		await rm(home, { recursive: true, force: true });
	}
}

/** A git repository holding `files`, committed; a second call on the same repo commits a new version. */
async function commit(repo: string, files: Record<string, string>): Promise<void> {
	for (const name of await readdir(repo)) if (name !== ".git") await rm(join(repo, name), { recursive: true, force: true });
	for (const [path, content] of Object.entries(files)) {
		await mkdir(join(repo, path, ".."), { recursive: true });
		await writeFile(join(repo, path), content);
	}
	await run("git", ["add", "-A"], { cwd: repo });
	await run("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "v"], { cwd: repo });
}

async function repo(files: Record<string, string>): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "lyra-replace-repo-"));
	await run("git", ["init", "-q", "."], { cwd: dir });
	await commit(dir, files);
	return dir;
}

const V1 = {
	".mcp.json": JSON.stringify({ mcpServers: { local: { command: "./bin/server.exe", args: [] } } }),
	"bin/server.exe": "v1 binary",
	"lib/addon.node": "v1 addon",
	"README.md": "v1",
};
const V2 = {
	".mcp.json": JSON.stringify({ mcpServers: { local: { command: "./bin/server.exe", args: ["--v2"] } } }),
	"bin/server.exe": "v2 binary",
	"CHANGELOG.md": "v2",
};

const entry = (repository: string): RegistryEntry => ({ id: "local", name: "local", repository, kind: "mcp" });

/** Every file under `dir`, relative, with its contents — the whole state of an installed bundle. */
async function snapshot(dir: string): Promise<Record<string, string>> {
	const out: Record<string, string> = {};
	for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
		if (!entry.isFile()) continue;
		const full = join(entry.parentPath, entry.name);
		out[relative(dir, full).split("\\").join("/")] = await readFile(full, "utf8");
	}
	return out;
}

/**
 * `locked` is open in another process, as a running server's binary is on Windows: files around it
 * can be removed and it cannot, and the directory holding it cannot be renamed.
 */
function lockFile(t: TestContext, locked: string): { release(): void } {
	const denied = (op: string, path: string) =>
		Object.assign(new Error(`EPERM: operation not permitted, ${op} '${path}'`), { code: "EPERM" });
	const holds = (dir: string) => !relative(dir, locked).startsWith("..");
	const realRm = fsPromises.rm;
	const realRename = fsPromises.rename;
	const rmMock = t.mock.method(fsPromises, "rm", async (path: string, options?: Parameters<typeof realRm>[1]) => {
		if (!holds(path)) return realRm(path, options);
		// Everything that is not the locked file goes, and then the locked one refuses.
		for (const entry of await readdir(path, { recursive: true, withFileTypes: true }).catch(() => [])) {
			const full = join(entry.parentPath, entry.name);
			if (entry.isFile() && full !== locked) await realRm(full, { force: true });
		}
		throw denied("unlink", locked);
	});
	const renameMock = t.mock.method(fsPromises, "rename", async (from: string, to: string) => {
		if (holds(from)) throw denied("rename", from);
		return realRename(from, to);
	});
	syncBuiltinESMExports();
	const release = () => {
		rmMock.mock.restore();
		renameMock.mock.restore();
		syncBuiltinESMExports();
	};
	// Also for the temporary home's own cleanup, which would otherwise meet the same lock.
	t.after(release);
	return { release };
}

test("an update blocked by a file in use leaves the installed version exactly as it was", async (t) => {
	await withHome(async (home) => {
		const source = await repo(V1);
		await installEntry(entry(source));
		const installed = join(bundleRoot("mcp"), "local");
		const before = await snapshot(installed);

		await commit(source, V2);
		const lock = lockFile(t, join(installed, "bin", "server.exe"));
		const failure = await installEntry(entry(source), undefined, true).then(() => null, (error: Error) => error);
		lock.release();

		assert.deepEqual(await snapshot(installed), before, "the old version was partly removed");
		assert.deepEqual((await readdir(join(home, "plugins"))).filter((name) => name.endsWith(".staging")), []);
		assert.match(failure?.message ?? "(it succeeded)", /占用/, "the failure does not say what is in the way");
	});
});

test("an uninstall blocked by a file in use removes none of the bundle", async (t) => {
	await withHome(async () => {
		await installEntry(entry(await repo(V1)));
		const installed = join(bundleRoot("mcp"), "local");
		const before = await snapshot(installed);

		const lock = lockFile(t, join(installed, "lib", "addon.node"));
		const failure = await uninstallEntry("local").then(() => null, (error: Error) => error);
		lock.release();

		assert.deepEqual(await snapshot(installed), before, "the bundle was half deleted");
		assert.match(failure?.message ?? "(it succeeded)", /占用/, "the failure does not say what is in the way");
	});
});

test("an update replaces the old version whole, and leaves nothing of it behind", async () => {
	await withHome(async (home) => {
		const source = await repo(V1);
		await installEntry(entry(source));
		await commit(source, V2);

		const updated = await installEntry(entry(source), undefined, true);

		// `lib/addon.node` was dropped by v2, and must not survive the update.
		assert.deepEqual(await snapshot(updated.dir), V2);
		assert.deepEqual(await readdir(join(home, "plugins", ".retired")).catch(() => []), []);
	});
});

test("the caller is told just before the old files are touched, and not when the download fails", async () => {
	await withHome(async () => {
		const source = await repo(V1);
		await installEntry(entry(source));
		const installed = join(bundleRoot("mcp"), "local");
		await commit(source, V2);

		/*
		 * What the desktop does here is stop the bundle's running servers — they hold its files open.
		 * Doing that before a download that then fails would take them down for nothing.
		 */
		const broken = { ...entry(source), repository: join(source, "does-not-exist") };
		let told = 0;
		await assert.rejects(installEntry(broken, undefined, true, { beforeReplace: async () => void (told += 1) }));
		assert.equal(told, 0, "told before anything was downloaded");

		let seen: Record<string, string> | null = null;
		await installEntry(entry(source), undefined, true, {
			beforeReplace: async () => {
				told += 1;
				seen = await snapshot(installed);
			},
		});
		assert.equal(told, 1);
		assert.deepEqual(seen, V1, "the old version was already touched when the caller was told");
	});
});
