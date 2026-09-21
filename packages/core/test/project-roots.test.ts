/**
 * A project may be several folders, and everything downstream has to agree on which ones.
 *
 * The rules worth stating: an entry written before the field existed still means its one folder;
 * the innermost project wins when two of them nest; and a folder that merely shares a name prefix
 * with a project folder is not inside it — the same `p-old` ⊄ `p` trap the sidebar's grouping and
 * the read boundary both have to avoid, tested here because this is where the answer is decided.
 */

import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { DEFAULT_SETTINGS } from "../src/config/settings.ts";
import { projectFolders } from "../src/config/project-folders.ts";
import { projectRootsFor } from "../src/config/project-roots.ts";
import { buildSystemPrompt } from "../src/prompt/system.ts";
import { buildTurnConfig } from "../src/runtime/turn-config.ts";
import { assessRead } from "../src/tools/read-access.ts";

const HOME = homedir();
const APP = join(HOME, ".lyra-test-app");
const API = join(HOME, ".lyra-test-api");
const ELSEWHERE = join(HOME, ".lyra-test-elsewhere");

function entry(path: string, folders?: string[]) {
	return { path, folders };
}

// ---------------------------------------------------------------- reading the entry

test("an entry from before multi-folder projects means its one folder", () => {
	assert.deepEqual(projectFolders({ path: APP }), [APP]);
	assert.deepEqual(projectFolders({ path: APP, folders: [] }), [APP]);
});

test("the main folder comes first however the list was written", () => {
	assert.deepEqual(projectFolders({ path: APP, folders: [API, APP] }), [APP, API]);
	assert.deepEqual(projectFolders({ path: APP, folders: [APP, API] }), [APP, API]);
});

test("a folder named twice is one folder", () => {
	assert.deepEqual(projectFolders({ path: APP, folders: [API, API, APP] }), [APP, API]);
});

/*
 * An entry that lost its own path is not a state to propagate.
 *
 * It cannot be produced through the dialog, but settings are a file on disk that people edit. The
 * answer that keeps every caller sane is "the working directory is part of the project", because
 * the alternative is a file tree rooted outside the session and a read boundary that asks about
 * the directory the session is running in.
 */
test("the main folder is included even if the list forgot it", () => {
	assert.deepEqual(projectFolders({ path: APP, folders: [API] }), [APP, API]);
});

// ---------------------------------------------------------------- finding the project

test("a session in a project gets that project's folders", () => {
	const projects = [entry(APP, [APP, API])];
	assert.deepEqual(projectRootsFor(projects, APP), [APP, API]);
	assert.deepEqual(projectRootsFor(projects, join(APP, "packages/core")), [APP, API]);
});

test("a session inside an extra folder gets the same set", () => {
	const projects = [entry(APP, [APP, API])];
	assert.deepEqual(projectRootsFor(projects, join(API, "src")), [APP, API]);
});

test("a session in no project gets nothing", () => {
	assert.deepEqual(projectRootsFor([entry(APP, [APP, API])], ELSEWHERE), []);
	assert.deepEqual(projectRootsFor([], APP), []);
	assert.deepEqual(projectRootsFor(undefined, APP), []);
});

/*
 * Nesting is a statement, not an accident.
 *
 * Someone with `~/work` on the list and `~/work/api` on it as well has said those are two pieces
 * of work. A session in `api` that inherited `~/work`'s folders would read across everything the
 * outer project reaches — the opposite of what listing the inner one separately asked for.
 */
test("the innermost project wins when projects nest", () => {
	const outer = entry(APP, [APP, ELSEWHERE]);
	const inner = entry(join(APP, "api"), [join(APP, "api"), API]);
	assert.deepEqual(projectRootsFor([outer, inner], join(APP, "api", "src")), [join(APP, "api"), API]);
	assert.deepEqual(projectRootsFor([inner, outer], join(APP, "api", "src")), [join(APP, "api"), API]);
	// And a path in the outer project that is not in the inner one still gets the outer one.
	assert.deepEqual(projectRootsFor([outer, inner], join(APP, "web")), [APP, ELSEWHERE]);
});

test("a shared name prefix is not containment", () => {
	assert.deepEqual(projectRootsFor([entry(APP, [APP, API])], `${APP}-old`), []);
	assert.deepEqual(projectRootsFor([entry(APP, [APP, API])], `${API}-old`), []);
});

// ---------------------------------------------------------------- what it changes

test("the project's other folders are readable without asking", () => {
	const roots = projectRootsFor([entry(APP, [APP, API])], APP);
	assert.equal(assessRead(join(API, "src/server.ts"), APP, { projectRoots: roots }).decision, "allow");
	assert.equal(assessRead(API, APP, { projectRoots: roots }).decision, "allow");
});

test("a one-folder project changes nothing about what is asked", () => {
	const roots = projectRootsFor([entry(APP)], APP);
	assert.equal(assessRead(join(API, "src/server.ts"), APP, { projectRoots: roots }).decision, "ask");
	assert.equal(assessRead(join(API, "src/server.ts"), APP).decision, "ask");
});

/*
 * Adding a folder to a project says "this is mine to work on", not "read the keys I keep in it".
 *
 * The credential rule runs before every containment check, including the cwd's own, so this is
 * asserting that the new root was added to the right side of that line.
 */
test("a credential inside a project folder is still a question", () => {
	const roots = projectRootsFor([entry(APP, [APP, join(HOME, ".ssh")])], APP);
	const verdict = assessRead(join(HOME, ".ssh", "id_ed25519"), APP, { projectRoots: roots });
	assert.equal(verdict.decision, "ask");
	assert.equal(verdict.decision === "ask" && verdict.scope, "file");
});

// ---------------------------------------------------------------- the seam

/*
 * The rule and the judgement are both right above; this is the wiring between them.
 *
 * "The code is there, the feature is not" is the failure mode this repository keeps meeting, and
 * its usual shape is exactly this: a value computed correctly, judged correctly, and never handed
 * from one to the other. `buildTurnConfig` is the only place that reads the project list on behalf
 * of a turn, and `tool-run.ts` is the only place that puts it on a `ToolContext` — so a turn built
 * without it means every tool in the session asks about the second folder, with nothing failing.
 */
test("a turn built from settings carries the project's folders to its tools", () => {
	const settings = { ...DEFAULT_SETTINGS, projects: [{ id: "app", name: "app", path: APP, pinned: false, lastOpenedAt: 1, folders: [APP, API] }] };
	const config = buildTurnConfig(
		{
			sessionId: "seam",
			cwd: APP,
			provider: { id: "p", name: "p", baseUrl: "", api: "openai", apiKey: "", enabled: true, models: [] },
			model: { id: "m", name: "m", modelId: "m", providerId: "p" },
			settings,
			state: new Map(),
			tools: [],
			skills: [],
			agents: [],
			requestApproval: async () => "reject",
			emit: async () => {},
			beforeToolCall: undefined,
			afterToolCall: undefined,
			drainSteering: undefined,
		} as unknown as Parameters<typeof buildTurnConfig>[0],
		{ systemPrompt: "", messages: [], tools: [], cwd: APP },
		"",
	);
	assert.deepEqual(config.projectRoots, [APP, API]);
});

test("a turn in a one-folder project carries nothing extra", () => {
	const settings = { ...DEFAULT_SETTINGS, projects: [{ id: "app", name: "app", path: APP, pinned: false, lastOpenedAt: 1 }] };
	const config = buildTurnConfig(
		{
			sessionId: "seam",
			cwd: APP,
			provider: { id: "p", name: "p", baseUrl: "", api: "openai", apiKey: "", enabled: true, models: [] },
			model: { id: "m", name: "m", modelId: "m", providerId: "p" },
			settings,
			state: new Map(),
			tools: [],
			skills: [],
			agents: [],
			requestApproval: async () => "reject",
			emit: async () => {},
		} as unknown as Parameters<typeof buildTurnConfig>[0],
		{ systemPrompt: "", messages: [], tools: [], cwd: APP },
		"",
	);
	assert.deepEqual(config.projectRoots, [APP]);
});

/*
 * And the model has to be told, or the folder is readable and never read.
 *
 * The read rule allowing something silently is worth nothing: the model still believes the second
 * repository is off-limits, so it never opens it. The prompt also has to say what did *not* change
 * — writing there is refused outright — because an unexplained refusal is what taught it to reach
 * for `sed` in a shell in the first place.
 */
test("the system prompt names the other folders, and only when there are any", async () => {
	const base = {
		cwd: APP,
		tools: [],
		skills: [],
		projectInstructions: [],
		platform: "darwin",
		modelName: "m",
		isGitRepo: false,
	} as unknown as Parameters<typeof buildSystemPrompt>[0];

	const plain = await buildSystemPrompt(base);
	assert.ok(!plain.includes(API), "a one-folder project must not pay a single token for this");

	const multi = await buildSystemPrompt({ ...base, projectRoots: [APP, API] });
	assert.ok(multi.includes(API.replace(/\\/g, "/")), "the extra folder is not named anywhere in the prompt");
	assert.equal(multi.split(APP).length - 1, 1, "the working directory is repeated as if it were a second fact");
	assert.match(multi, /readable, not writable/, "the prompt does not say writing there is still refused");
});
