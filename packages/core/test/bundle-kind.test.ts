/**
 * What a directory is, decided by what it holds.
 *
 * The rule these tests pin down is the one that separates a plugin from an MCP server, and it
 * exists because the alternative had already happened: a catalogue of nine "plugins" of which
 * seven were a single `.mcp.json` and no skills — real MCP servers, listed and installed as
 * plugins, and then absent from the MCP settings page because that page reads the settings file
 * and these had gone into a plugin directory instead.
 *
 * Nothing here asks the manifest what it thinks it is. A bundle that says nothing and a bundle
 * that says the wrong thing must both come out the same way, because the registry index this was
 * built against says the wrong thing about seven of its nine entries.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { inspectBundle, loadPlugins } from "../src/plugins/loader.ts";

/** A bundle with the given pieces, and nothing else. */
async function bundle(
	root: string,
	id: string,
	parts: { skills?: Record<string, string>; mcp?: Record<string, unknown>; manifest?: Record<string, unknown> },
): Promise<string> {
	const dir = join(root, id);
	await mkdir(join(dir, ".lyra-plugin"), { recursive: true });
	await writeFile(
		join(dir, ".lyra-plugin", "plugin.json"),
		JSON.stringify({ name: id, version: "1.0.0", ...parts.manifest }),
	);

	for (const [name, description] of Object.entries(parts.skills ?? {})) {
		await mkdir(join(dir, "skills", name), { recursive: true });
		await writeFile(
			join(dir, "skills", name, "SKILL.md"),
			`---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
		);
	}

	if (parts.mcp) await writeFile(join(dir, ".mcp.json"), JSON.stringify({ mcpServers: parts.mcp }));
	return dir;
}

async function withRoot(body: (root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "lyra-bundle-"));
	try {
		await body(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

const CONTEXT7 = { context7: { command: "npx", args: ["-y", "@upstash/context7-mcp"] } };

test("a directory holding only a server declaration is an MCP bundle, not a plugin", async () => {
	await withRoot(async (root) => {
		await bundle(root, "context7", { mcp: CONTEXT7, manifest: { mcpServers: ".mcp.json" } });

		const { plugins, mcpBundles } = await loadPlugins([{ dir: root, source: "user" }]);

		assert.equal(plugins.length, 0, "nothing here is a plugin");
		assert.equal(mcpBundles.length, 1);
		assert.equal(mcpBundles[0].id, "context7");
		assert.equal(mcpBundles[0].servers.length, 1);
	});
});

test("its servers carry where they came from, so uninstalling can find them again", async () => {
	await withRoot(async (root) => {
		await bundle(root, "filesystem", {
			mcp: { fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."] } },
			manifest: { mcpServers: ".mcp.json", version: "2.1.0" },
		});

		const { mcpBundles } = await loadPlugins([{ dir: root, source: "user" }]);

		// Keyed on the directory name rather than the manifest's `name`: the directory is what
		// `uninstallEntry` removes and what the registry entry's id becomes.
		assert.equal(mcpBundles[0].servers[0].origin?.bundle, "filesystem");
		assert.equal(mcpBundles[0].servers[0].origin?.version, "2.1.0");
	});
});

test("a directory holding skills is a plugin, and stays one", async () => {
	await withRoot(async (root) => {
		await bundle(root, "waza", { skills: { review: "审代码时用。" } });

		const { plugins, mcpBundles } = await loadPlugins([{ dir: root, source: "user" }]);

		assert.equal(mcpBundles.length, 0);
		assert.equal(plugins.length, 1);
		assert.equal(plugins[0].skills.length, 1);
		assert.equal(plugins[0].skills[0].pluginId, "waza");
	});
});

test("a bundle claiming to be both is loaded as a plugin and told off for it", async () => {
	await withRoot(async (root) => {
		await bundle(root, "mixed", {
			skills: { review: "审代码时用。" },
			mcp: CONTEXT7,
			manifest: { mcpServers: ".mcp.json" },
		});

		const { plugins, mcpBundles, diagnostics } = await loadPlugins([{ dir: root, source: "user" }]);

		assert.equal(plugins.length, 1, "the skills are what it is");
		assert.equal(mcpBundles.length, 0);
		// Silence here would be the ambiguity the split exists to remove: the servers are not
		// loaded, and the only way anyone finds that out is being told. Warnings ride in the same
		// list (the fixture's one-line skill description earns one) and are not that telling.
		const problems = diagnostics.filter((diagnostic) => diagnostic.severity !== "warning");
		assert.equal(problems.length, 1, JSON.stringify(diagnostics));
		assert.match(problems[0].message, /MCP/);
	});
});

test("the location a bundle sits in does not decide what it is", async () => {
	await withRoot(async (root) => {
		// Exactly the case every existing install is in: an MCP server under `plugins/`, put there
		// before the two were told apart. It has to come back as MCP without anything moving first.
		const plugins = join(root, "plugins");
		const mcp = join(root, "mcp");
		await mkdir(plugins, { recursive: true });
		await mkdir(mcp, { recursive: true });
		await bundle(plugins, "context7", { mcp: CONTEXT7, manifest: { mcpServers: ".mcp.json" } });
		await bundle(mcp, "waza", { skills: { review: "审代码时用。" } });

		const loaded = await loadPlugins([
			{ dir: plugins, source: "user" },
			{ dir: mcp, source: "user" },
		]);

		assert.deepEqual(
			loaded.mcpBundles.map((b) => b.id),
			["context7"],
		);
		assert.deepEqual(
			loaded.plugins.map((p) => p.id),
			["waza"],
		);
	});
});

test("inspectBundle answers the same question about one directory", async () => {
	await withRoot(async (root) => {
		const server = await bundle(root, "memory", { mcp: CONTEXT7, manifest: { mcpServers: ".mcp.json" } });
		const plugin = await bundle(root, "waza", { skills: { review: "审代码时用。" } });
		await mkdir(join(root, "empty"), { recursive: true });

		assert.equal((await inspectBundle(server)).kind, "mcp");
		assert.equal((await inspectBundle(plugin)).kind, "plugin");
		// Neither: install has to refuse rather than leave an empty directory lying around.
		assert.equal((await inspectBundle(join(root, "empty"))).kind, "none");
	});
});

test("a disabled plugin is still listed; disabling is not hiding", async () => {
	await withRoot(async (root) => {
		await bundle(root, "waza", { skills: { review: "审代码时用。" } });

		const { plugins } = await loadPlugins([{ dir: root, source: "user" }], ["waza"]);

		assert.equal(plugins.length, 1);
		assert.equal(plugins[0].enabled, false);
	});
});

test("a marketplace file names the plugin, not the marketplace", async () => {
	await withRoot(async (root) => {
		/*
		 * The shape real repositories ship.
		 *
		 * The top level of `marketplace.json` describes the marketplace — for a repository that
		 * publishes one plugin that is usually the owner's handle (`agenticnotetaking`) or
		 * `<x>-marketplace`. Reading it put the publishing account's name in the installed list where
		 * the plugin's name belongs, which is unrecognisable to whoever installed it.
		 */
		const dir = join(root, "arscontexta");
		await mkdir(join(dir, ".claude-plugin"), { recursive: true });
		await mkdir(join(dir, "skills", "capture"), { recursive: true });
		await writeFile(
			join(dir, "skills", "capture", "SKILL.md"),
			"---\nname: capture\ndescription: 记录时用。\n---\n\n# capture\n",
		);
		await writeFile(
			join(dir, ".claude-plugin", "marketplace.json"),
			JSON.stringify({
				name: "agenticnotetaking",
				description: "A marketplace",
				owner: { name: "Heinrich" },
				plugins: [{ name: "arscontexta", description: "A second brain", version: "2.1.0" }],
			}),
		);

		const found = await inspectBundle(dir);
		assert.equal(found.kind, "plugin");
		assert.equal(found.kind !== "none" && found.manifest.name, "arscontexta");
		assert.equal(found.kind !== "none" && found.manifest.description, "A second brain");
		// The owner is still the author — that part of the top level really is about the publisher.
		assert.equal(found.kind !== "none" && found.manifest.author?.name, "Heinrich");
	});
});

test("without an entry inside, the marketplace's own name is still better than the directory", async () => {
	await withRoot(async (root) => {
		const dir = join(root, "cloned-at-a-weird-path");
		await mkdir(join(dir, ".claude-plugin"), { recursive: true });
		await mkdir(join(dir, "skills", "review"), { recursive: true });
		await writeFile(
			join(dir, "skills", "review", "SKILL.md"),
			"---\nname: review\ndescription: 审代码时用。\n---\n\n# review\n",
		);
		await writeFile(join(dir, ".claude-plugin", "marketplace.json"), JSON.stringify({ name: "ponytail" }));

		const found = await inspectBundle(dir);
		assert.equal(found.kind !== "none" && found.manifest.name, "ponytail");
	});
});
