/**
 * Installing and uninstalling, all the way through: files on disk *and* rows in settings.
 *
 * The two halves are separately correct and jointly wrong more often than either alone. An MCP
 * bundle is a directory and a set of settings rows, and the only thing tying them together is
 * `origin.bundle` — stamped on the rows at install, matched against at uninstall. Every failure
 * mode here is quiet: a server still in the list after its directory is gone, two copies of a
 * server after installing twice, or a server switched on by an install rather than by a person.
 *
 * Nothing is mocked. `installEntry` really clones — `git` treats a local path as a remote, so these
 * build real repositories in a temporary directory — and the settings really go through the same
 * functions the IPC handlers call. What is not covered here is the wiring itself: `plugins.ts`
 * imports `electron`, which a test runner cannot load, so it is kept to ordering and handler
 * registration with the decisions in `plugin-actions.ts` where they can be reached.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import type { McpBundle, McpServerConfig, RegistryEntry, Settings } from "@lyra/core";
import { bundleRoot, installEntry, uninstallEntry } from "@lyra/core";

import {
	releaseBundle,
	settingsAfterInstall,
	settingsAfterReconcile,
	settingsAfterUninstall,
} from "../electron/ipc/plugin-actions.ts";

const run = promisify(execFile);

/** A home of our own; these tests write to `~/.lyra` and must never find the real one. */
async function withHome(body: () => Promise<void>): Promise<void> {
	const home = await mkdtemp(join(tmpdir(), "lyra-ipc-"));
	const previous = process.env.LYRA_HOME;
	process.env.LYRA_HOME = home;
	try {
		await body();
	} finally {
		if (previous === undefined) delete process.env.LYRA_HOME;
		else process.env.LYRA_HOME = previous;
		await rm(home, { recursive: true, force: true });
	}
}

/** A git repository holding the given files, which is what `entry.repository` points at. */
async function repoWith(files: Record<string, string>): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "lyra-repo-"));
	for (const [path, content] of Object.entries(files)) {
		const full = join(dir, path);
		await mkdir(join(full, ".."), { recursive: true });
		await writeFile(full, content);
	}
	await run("git", ["init", "-q", "."], { cwd: dir });
	await run("git", ["add", "-A"], { cwd: dir });
	await run("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "init"], { cwd: dir });
	return dir;
}

/** A repository declaring one MCP server, which is all most of the real ones are. */
function mcpRepo(server: string): Record<string, string> {
	return {
		".mcp.json": JSON.stringify({ mcpServers: { [server]: { command: "npx", args: ["-y", `@x/${server}`] } } }),
	};
}

/** Only what these tests read; the rest of `Settings` is irrelevant to the question being asked. */
function settingsWith(extra: Partial<Settings> = {}): Settings {
	return { mcpServers: [], disabledPlugins: [], ...extra } as Settings;
}

function handMade(id: string): McpServerConfig {
	return { id, name: id, transport: "stdio", command: "npx", args: [], enabled: true } as McpServerConfig;
}

test("installing an MCP bundle writes its servers into settings, switched off", async () => {
	await withHome(async () => {
		const repo = await repoWith(mcpRepo("context7"));
		const entry: RegistryEntry = { id: "context7", name: "Context7", repository: repo, kind: "mcp" };

		const installed = await installEntry(entry, "Lyra Registry");
		const next = settingsAfterInstall(settingsWith(), entry.id, installed);

		assert.ok(next, "an MCP install has something to say about settings");
		assert.equal(next.mcpServers.length, 1);
		/*
		 * Off, and this is the assertion worth keeping. Installing is not the same as trusting: an
		 * MCP server is a command that runs on this machine with this user's permissions, and the
		 * moment it starts doing that should be one somebody chose.
		 */
		assert.equal(next.mcpServers[0].enabled, false);
		assert.equal(next.mcpServers[0].origin?.bundle, "context7");
		assert.equal(next.mcpServers[0].origin?.registry, "Lyra Registry");
	});
});

test("installing a plugin leaves settings alone", async () => {
	await withHome(async () => {
		const repo = await repoWith({
			"plugin.json": JSON.stringify({ name: "demo", skills: "skills" }),
			"skills/review/SKILL.md": "---\nname: review\ndescription: 测试。\n---\n",
		});

		const installed = await installEntry({ id: "demo", name: "demo", repository: repo, kind: "plugin" });

		assert.equal(installed.kind, "plugin");
		// Null, not an unchanged copy: writing the settings file to record that nothing changed is a
		// write nobody asked for, and settings are watched.
		assert.equal(settingsAfterInstall(settingsWith(), "demo", installed), null);
	});
});

test("uninstalling an MCP bundle takes its directory and its settings rows together", async () => {
	await withHome(async () => {
		/*
		 * The whole round trip, because the halves are only correct together. A directory removed with
		 * its rows left behind is a server still listed, still switched on if it was, pointing at a
		 * command that is no longer there.
		 */
		const repo = await repoWith(mcpRepo("context7"));
		const entry: RegistryEntry = { id: "context7", name: "Context7", repository: repo, kind: "mcp" };

		const installed = await installEntry(entry);
		const afterInstall = settingsAfterInstall(settingsWith({ mcpServers: [handMade("mine")] }), entry.id, installed)!;
		assert.equal(afterInstall.mcpServers.length, 2);

		await uninstallEntry(entry.id);
		const afterUninstall = settingsAfterUninstall(afterInstall, entry.id);

		assert.ok(afterUninstall);
		assert.deepEqual(
			afterUninstall.mcpServers.map((server) => server.id),
			["mine"],
			"the hand-made row is the user's and stays",
		);
		assert.deepEqual(await readdir(bundleRoot("mcp")).catch(() => []), [], "and the directory is gone");
	});
});

test("uninstalling something that brought no servers does not rewrite settings", async () => {
	await withHome(async () => {
		const settings = settingsWith({ mcpServers: [handMade("mine")] });

		assert.equal(settingsAfterUninstall(settings, "some-plugin"), null);
	});
});

test("re-installing replaces a bundle's servers rather than doubling them", async () => {
	await withHome(async () => {
		/*
		 * Reachable in the ordinary way: uninstall, reinstall. Adding instead of replacing leaves two
		 * rows for one server, and switching "it" on switches on whichever the list hits first — so
		 * the toggle appears to work and the server appears not to.
		 */
		const repo = await repoWith(mcpRepo("context7"));
		const entry: RegistryEntry = { id: "context7", name: "Context7", repository: repo, kind: "mcp" };

		const first = await installEntry(entry);
		const afterFirst = settingsAfterInstall(settingsWith(), entry.id, first)!;

		await uninstallEntry(entry.id);
		const second = await installEntry(entry);
		const afterSecond = settingsAfterInstall(afterFirst, entry.id, second)!;

		assert.equal(afterSecond.mcpServers.length, 1);
	});
});

test("updating a bundle keeps its servers switched on, and a server new in this version arrives off", async () => {
	await withHome(async () => {
		const repo = await repoWith(mcpRepo("context7"));
		const entry: RegistryEntry = { id: "context7", name: "Context7", repository: repo, kind: "mcp" };
		const installed = await installEntry(entry);
		const [server] = installed.servers;
		assert.ok(server);

		// The user switched it on; an update then brings the same server and one more.
		const on = settingsWith({ mcpServers: [{ ...server, enabled: true }] });
		const update = { ...installed, servers: [server, { ...server, id: `${server.id}-extra`, name: "extra" }] };
		const next = settingsAfterInstall(on, entry.id, update)!;

		assert.equal(next.mcpServers.find((row) => row.id === server.id)?.enabled, true, "the update switched off a server the user had on");
		assert.equal(next.mcpServers.find((row) => row.id === `${server.id}-extra`)?.enabled, false, "a server nobody chose is not on");
		assert.equal(next.mcpServers.length, 2);
	});
});

test("a server the user switched on survives a re-install of a different bundle", async () => {
	await withHome(async () => {
		const repo = await repoWith(mcpRepo("filesystem"));
		const entry: RegistryEntry = { id: "filesystem", name: "Filesystem", repository: repo, kind: "mcp" };
		const installed = await installEntry(entry);

		const current = settingsWith({
			mcpServers: [{ ...handMade("c7"), origin: { bundle: "context7" }, enabled: true } as McpServerConfig],
		});
		const next = settingsAfterInstall(current, entry.id, installed)!;

		const context7 = next.mcpServers.find((server) => server.origin?.bundle === "context7");
		assert.equal(context7?.enabled, true, "another bundle's row is not touched, and not switched off");
	});
});

/*
 * Reconciliation: what happens on the way out of a scan, for bundles that predate the split.
 *
 * These need no repository — the question is entirely about what is on disk versus what is in
 * settings, and `loadPlugins` has its own tests for producing the first half.
 */

/**
 * A bundle as `loadPlugins` produces one, stamp included.
 *
 * The stamp matters to the shape of these tests: a real scan tags every server with the bundle it
 * came from, and reconciliation is only idempotent because the rows it writes can be found again by
 * that tag. A fixture without it would be testing a bundle that cannot exist.
 */
function bundle(id: string, servers: McpServerConfig[]): McpBundle {
	return {
		id,
		dir: `/home/me/.lyra/mcp/${id}`,
		manifest: { name: id },
		source: "user",
		servers: servers.map((server) => ({ ...server, origin: { bundle: id } })),
	};
}

test("a bundle on disk with no settings row gets one, switched on", async () => {
	/*
	 * On, which looks like the opposite of the install rule and is the same rule. This is not a new
	 * server arriving; it is one that was already installed and already working, loaded through a
	 * path that no longer exists. A migration that turns working servers off is as wrong as one
	 * that turns unknown servers on.
	 */
	const next = settingsAfterReconcile(settingsWith(), [bundle("context7", [handMade("c7")])]);

	assert.ok(next);
	assert.equal(next.mcpServers.length, 1);
	assert.equal(next.mcpServers[0].enabled, true);
});

test("a bundle the user had switched off comes back switched off", () => {
	const next = settingsAfterReconcile(settingsWith({ disabledPlugins: ["context7"] }), [
		bundle("context7", [handMade("c7")]),
	]);

	assert.equal(next?.mcpServers[0].enabled, false);
});

test("everything off means everything off, including bundles named by nothing", () => {
	// `*` is the "disable all plugins" switch, and it has to be honoured by the migration too.
	const next = settingsAfterReconcile(settingsWith({ disabledPlugins: ["*"] }), [
		bundle("context7", [handMade("c7")]),
	]);

	assert.equal(next?.mcpServers[0].enabled, false);
});

test("reconciling twice writes nothing the second time", () => {
	const bundles = [bundle("context7", [handMade("c7")])];
	const once = settingsAfterReconcile(settingsWith(), bundles)!;

	assert.equal(settingsAfterReconcile(once, bundles), null, "idempotent, so it can run on every scan");
});

test("reconciliation does not resurrect a bundle that still has its row", () => {
	const current = settingsWith({
		mcpServers: [{ ...handMade("c7"), origin: { bundle: "context7" }, enabled: false } as McpServerConfig],
	});

	assert.equal(
		settingsAfterReconcile(current, [bundle("context7", [handMade("c7")])]),
		null,
		"a row that exists is the answer, whatever state it is in",
	);
});

test("releasing a bundle disconnects its servers in every live session, and nothing else", async () => {
	/*
	 * What updating or uninstalling does before touching the bundle's files: on Windows its running
	 * servers hold them open. Each fake session reports the servers the predicate picked out of what
	 * it has connected.
	 */
	const connected: McpServerConfig[] = [
		{ ...handMade("c7"), origin: { bundle: "context7" } } as McpServerConfig,
		{ ...handMade("fs"), origin: { bundle: "filesystem" } } as McpServerConfig,
		handMade("typed-in"),
	];
	const released: string[][] = [];
	const session = () => ({
		can: {
			disconnectMcp: async (match: (server: McpServerConfig) => boolean) => {
				const picked = connected.filter(match).map((server) => server.id);
				released.push(picked);
				return picked.length;
			},
		},
	});
	const refusing = { can: { disconnectMcp: () => Promise.reject(new Error("already disposed")) } };

	await releaseBundle([session(), refusing, session()], "context7");

	assert.deepEqual(released, [["c7"], ["c7"]], "one session failing must not keep the others connected");
});
