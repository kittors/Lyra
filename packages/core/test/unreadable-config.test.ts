/**
 * Configuration files that do not parse the first time — and what must not happen next.
 *
 * `settings.json` that failed to parse was read as a fresh install: no providers, no MCP servers,
 * no hooks, no always-allow list. The desktop saves on any change at all, and the first save wrote
 * those defaults over the file. The commonest way in was not damage but a byte-order mark, which
 * Notepad's "UTF-8 with BOM" and PowerShell 5.1's `Set-Content -Encoding UTF8` both write — and
 * the same mark made a skill's frontmatter read as body text and a bundle's `.mcp.json` "not JSON".
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";

import type { AgentEvent } from "../src/agent/events.ts";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, settingsPath, settingsProblem, type Settings } from "../src/config/settings.ts";
import { resetVault } from "../src/config/vault.ts";
import { loadPlugins } from "../src/plugins/loader.ts";
import { AgentSession } from "../src/runtime/session.ts";
import type { SessionMeta } from "../src/session/store.ts";
import type { SessionStorage } from "../src/session/storage.ts";
import { loadSkills } from "../src/skills/loader.ts";

const BOM = "\uFEFF";

let home: string;
const made: string[] = [];
const previous = { home: process.env.LYRA_HOME, userProfile: process.env.USERPROFILE };

beforeEach(async () => {
	home = await mkdtemp(join(tmpdir(), "lyra-unreadable-"));
	made.push(home);
	// Both, because `os.homedir()` reads `USERPROFILE` on Windows; `LYRA_HOME` outranks either.
	process.env.LYRA_HOME = home;
	process.env.USERPROFILE = home;
	resetVault();
});

after(async () => {
	if (previous.home === undefined) delete process.env.LYRA_HOME;
	else process.env.LYRA_HOME = previous.home;
	if (previous.userProfile === undefined) delete process.env.USERPROFILE;
	else process.env.USERPROFILE = previous.userProfile;
	await Promise.all(made.map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 })));
});

const MINE = {
	mcpServers: [{ id: "c7", name: "context7", transport: "stdio", command: "npx", args: ["-y", "@upstash/context7-mcp"], enabled: true }],
	alwaysAllow: ["bash:git status"],
};

test("a settings file saved with a byte-order mark is read, not replaced by the defaults", async () => {
	await writeFile(settingsPath(), `${BOM}${JSON.stringify(MINE, null, 2)}`, "utf8");
	const settings = await loadSettings();
	assert.deepEqual(settings.alwaysAllow, MINE.alwaysAllow);
	assert.equal(settings.mcpServers.length, 1);
	assert.equal(settingsProblem(), null);
});

test("an unreadable settings file is kept aside before the first save writes over it", async () => {
	const broken = `{ "alwaysAllow": ["bash:git status"], `;
	await writeFile(settingsPath(), broken, "utf8");

	const settings = await loadSettings();
	assert.deepEqual(settings.alwaysAllow, [], "the premise: what is in use is the defaults");
	assert.ok(settingsProblem()?.reason, "nothing says the file could not be read");

	await saveSettings({ ...settings, alwaysAllow: ["bash:ls"] });

	const kept = (await readdir(home)).filter((name) => name.startsWith("settings.json.corrupt-"));
	assert.equal(kept.length, 1, "the unreadable file was overwritten instead of kept");
	assert.equal(await readFile(join(home, kept[0]), "utf8"), broken, "what was kept is not what was there");
	assert.equal(settingsProblem()?.keptAt, join(home, kept[0]));
	assert.deepEqual((JSON.parse(await readFile(settingsPath(), "utf8")) as Settings).alwaysAllow, ["bash:ls"]);

	// Kept once: the next save has nothing unreadable left to protect.
	await saveSettings({ ...settings, alwaysAllow: ["bash:pwd"] });
	assert.equal((await readdir(home)).filter((name) => name.startsWith("settings.json.corrupt-")).length, 1);
});

test("valid JSON that is not a settings object is unreadable too", async () => {
	await writeFile(settingsPath(), "[]", "utf8");
	await loadSettings();
	assert.ok(settingsProblem(), "an array was taken for settings");
});

test("a session started on unreadable settings says so in the conversation", async () => {
	await writeFile(settingsPath(), "{ not json", "utf8");
	const settings = await loadSettings();

	const events: AgentEvent[] = [];
	const cwd = await mkdtemp(join(tmpdir(), "lyra-unreadable-cwd-"));
	made.push(cwd);
	const meta = { id: "s1", projectId: "p", cwd, modelId: "m", title: "", createdAt: 0, updatedAt: 0 } as unknown as SessionMeta;
	const store = { append: async (m: SessionMeta) => m, create: async () => meta } as unknown as SessionStorage;
	const session = new AgentSession({ cwd, settings, store, meta, emit: async (event) => void events.push(event) });
	try {
		await session.initialize();
		const notices = events.filter((event): event is Extract<AgentEvent, { type: "notice" }> => event.type === "notice");
		const told = notices.find((notice) => notice.message.includes("settings.json"));
		assert.ok(told, `no notice about settings.json among ${JSON.stringify(notices)}`);
		assert.equal(told.level, "error");
	} finally {
		await session.dispose();
	}
});

test("a skill whose SKILL.md starts with a byte-order mark keeps its frontmatter", async () => {
	const dir = join(home, "skills", "review");
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "SKILL.md"), `${BOM}---\nname: code-review\ndescription: Review a diff.\n---\n\nBody.\n`, "utf8");

	const { skills } = await loadSkills([{ dir: join(home, "skills"), source: "user" }]);
	assert.equal(skills[0]?.name, "code-review", "the name came from the directory: the frontmatter was read as body");
	assert.equal(skills[0]?.description, "Review a diff.");
});

test("a bundle whose manifest and .mcp.json start with a byte-order mark still has its server", async () => {
	const dir = join(home, "bundles", "context7");
	await mkdir(join(dir, ".lyra-plugin"), { recursive: true });
	await writeFile(join(dir, ".lyra-plugin", "plugin.json"), `${BOM}${JSON.stringify({ name: "context7", mcpServers: ".mcp.json" })}`, "utf8");
	await writeFile(join(dir, ".mcp.json"), `${BOM}${JSON.stringify({ mcpServers: { context7: { command: "npx", args: ["-y", "@upstash/context7-mcp"] } } })}`, "utf8");

	const { mcpBundles, diagnostics } = await loadPlugins([{ dir: join(home, "bundles"), source: "user" }]);
	assert.deepEqual(diagnostics, []);
	assert.equal(mcpBundles[0]?.servers.length, 1);
});

test("a settings file that is merely missing is a fresh install, not a problem", async () => {
	const settings = await loadSettings();
	assert.deepEqual(settings.alwaysAllow, DEFAULT_SETTINGS.alwaysAllow);
	assert.equal(settingsProblem(), null);
});
