/**
 * Where a bundle's README comes from, and what is never read.
 *
 * Three sources in order — the platform's detail page, the installed directory, GitHub — and three
 * refusals that matter more than any of them: a directory outside the Lyra home, a path climbing out
 * of the repository, an id that is not an id. The network is a fake that records what was asked.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, mock, test } from "node:test";

import { githubRepo, readmeFor } from "../electron/plugin-readme.ts";

const PLATFORM = "https://market.test/v1/index";
let home = "";
let asked: string[] = [];
let answers: Record<string, { status: number; body: string; type?: string }> = {};

before(async () => {
	home = await mkdtemp(join(tmpdir(), "lyra-readme-"));
	mock.method(globalThis, "fetch", async (input: string | URL) => {
		const url = String(input);
		asked.push(url);
		const answer = answers[url];
		if (!answer) return new Response("not found", { status: 404 });
		return new Response(answer.body, { status: answer.status, headers: { "content-type": answer.type ?? "application/json" } });
	});
});

beforeEach(() => {
	asked = [];
	answers = {};
});

after(async () => {
	mock.restoreAll();
	await rm(home, { recursive: true, force: true });
});

test("the platform's detail page answers first, with the directory its links are written against", async () => {
	answers["https://market.test/v1/entries/data"] = {
		status: 200,
		body: JSON.stringify({ readme: "# Data\n\nSQL and charts.", repository: "https://github.com/anthropics/knowledge-work-plugins", readmeBase: "data" }),
	};
	const answer = await readmeFor({ id: "data", repository: "https://github.com/anthropics/knowledge-work-plugins", path: "data" }, [PLATFORM], home);
	assert.deepEqual(answer, { markdown: "# Data\n\nSQL and charts.", repo: "anthropics/knowledge-work-plugins", dir: "data" });
});

test("the same id on the platform but another repository is another entry, and GitHub is asked instead", async () => {
	answers["https://market.test/v1/entries/tools"] = {
		status: 200,
		body: JSON.stringify({ readme: "someone else's", repository: "https://github.com/other/tools" }),
	};
	answers["https://raw.githubusercontent.com/me/tools/HEAD/README.md"] = { status: 200, body: "# Mine", type: "text/plain" };
	const answer = await readmeFor({ id: "tools", repository: "https://github.com/me/tools" }, [PLATFORM], home);
	assert.equal(answer?.markdown, "# Mine");
	assert.equal(answer?.repo, "me/tools");
});

test("an installed bundle's own README is read from its directory, but only inside the Lyra home", async () => {
	const inside = join(home, "plugins", "notes");
	await mkdir(inside, { recursive: true });
	await writeFile(join(inside, "readme.md"), "# Notes\n");
	const answer = await readmeFor({ id: "notes", dir: inside }, [], home);
	assert.equal(answer?.markdown, "# Notes\n");

	const outside = await mkdtemp(join(tmpdir(), "lyra-readme-outside-"));
	try {
		await writeFile(join(outside, "README.md"), "private");
		assert.equal(await readmeFor({ id: "elsewhere", dir: outside }, [], home), null);
	} finally {
		await rm(outside, { recursive: true, force: true });
	}
});

test("a path that climbs out of the repository is never turned into a URL", async () => {
	assert.equal(await readmeFor({ id: "climb", repository: "https://github.com/me/repo", path: "../../other/secrets" }, [], home), null);
	assert.deepEqual(asked, [], "nothing was fetched");
});

test("an id that is not an id is refused before anything is asked", async () => {
	assert.equal(await readmeFor({ id: "../v1/admin", repository: "https://github.com/me/repo" }, [PLATFORM], home), null);
	assert.deepEqual(asked, []);
});

test("a JSON file index has no detail page beside it, so it is not asked for one", async () => {
	answers["https://raw.githubusercontent.com/me/skills/HEAD/skills/README.md"] = { status: 200, body: "# Skills", type: "text/plain" };
	const answer = await readmeFor(
		{ id: "skills", repository: "https://github.com/me/skills.git", path: "skills" },
		["https://raw.githubusercontent.com/me/index/main/registry.json"],
		home,
	);
	assert.equal(answer?.markdown, "# Skills");
	assert.equal(answer?.dir, "skills");
	assert.ok(!asked.some((url) => url.includes("/v1/entries/")));
});

test("repository URLs are read the way people write them", () => {
	assert.equal(githubRepo("https://github.com/upstash/context7"), "upstash/context7");
	assert.equal(githubRepo("https://github.com/upstash/context7.git"), "upstash/context7");
	assert.equal(githubRepo("git@github.com:upstash/context7.git"), "upstash/context7");
	assert.equal(githubRepo("https://gitlab.com/a/b"), undefined);
});
