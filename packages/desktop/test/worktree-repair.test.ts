/**
 * Filing worktree conversations made before `SessionMeta.worktree` (ADR-0038): which folders are
 * recognised, which project they are filed under, and that filing them neither moves them in the list
 * nor touches what is not theirs to touch.
 *
 * Real repositories in a temporary directory: what is being decided is what git says about a folder,
 * and a stand-in for git would only restate the assumptions under test.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { after, before, test } from "node:test";
import { SessionStore, type SessionMeta, type SessionStorage } from "@lyra/core";
import type { SessionChange } from "../electron/ipc-shapes.ts";
import { pathKey } from "../electron/path-key.ts";
import { observeSessionStorage } from "../electron/session-storage.ts";
import { pickHome, readLegacyWorktree, registeredFolders, repairCandidates, repairLegacyWorktrees } from "../electron/worktree-repair.ts";

const exec = promisify(execFile);

/** A canonical temporary root, so git's spelling and ours agree unless a test makes them differ. */
let root: string;
/** `<root>/app`: the main checkout, on `main`, with a package inside it. */
let repo: string;

async function git(cwd: string, ...args: string[]): Promise<string> {
	return (await exec("git", args, { cwd })).stdout;
}

async function initRepo(dir: string): Promise<void> {
	await exec("git", ["init", "--initial-branch=main", dir]);
	await git(dir, "config", "user.email", "t@example.com");
	await git(dir, "config", "user.name", "T");
	await writeFile(join(dir, "README.md"), "# fixture\n");
	await git(dir, "add", ".");
	await git(dir, "commit", "-m", "init");
}

before(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "lyra-wt-repair-")));
	repo = join(root, "app");
	await mkdir(join(repo, "packages", "web"), { recursive: true });
	await writeFile(join(repo, "packages", "web", "index.ts"), "export {};\n");
	await initRepo(repo);
});

after(async () => {
	await rm(root, { recursive: true, force: true }).catch(() => {});
});

/** A worktree the old way: beside the repository, on `lyra/session-<tag>`. */
async function oldWorktree(tag: string, from = repo): Promise<string> {
	const path = join(root, `app-${tag}`);
	await git(from, "worktree", "add", "-B", `lyra/session-${tag}`, path);
	return path;
}

const same = (a: string | undefined, b: string) => a !== undefined && pathKey(a) === pathKey(b);

// ---------------------------------------------------------------------------
// Recognising the folder
// ---------------------------------------------------------------------------

test("仓库旁边、在 lyra/session- 分支上的链接工作树：认出主仓库和分支", async () => {
	const tree = await oldWorktree("a1b2c3d4");
	const found = await readLegacyWorktree(tree);
	assert.ok(found, "recognised");
	assert.ok(same(found.repoRoot, repo), `repo root ${found.repoRoot}`);
	assert.ok(same(found.commonDir, join(repo, ".git")));
	assert.equal(found.branch, "lyra/session-a1b2c3d4");
});

test("普通目录、主仓库本身、主仓库里的子目录：都认不出", async () => {
	const plain = join(root, "notes-12345678");
	await mkdir(plain, { recursive: true });
	assert.equal(await readLegacyWorktree(plain), null, "a folder with no .git");
	assert.equal(await readLegacyWorktree(repo), null, "the main checkout: .git is a directory");
	assert.equal(await readLegacyWorktree(join(repo, "packages", "web")), null, "inside the main checkout");
});

test("submodule 的 .git 也是文件，但指向 modules/：就算分支叫 lyra/session- 也认不出", async () => {
	const lib = join(root, "lib");
	const host = join(root, "host");
	await initRepo(lib);
	await initRepo(host);
	await git(host, "-c", "protocol.file.allow=always", "submodule", "add", lib, "vendor/lib");
	const sub = join(host, "vendor", "lib");
	await git(sub, "checkout", "-b", "lyra/session-5ub00001");
	assert.equal(await readLegacyWorktree(sub), null);
});

test("别人建的工作树（分支不是 lyra/session-）和游离 HEAD 的工作树：认不出", async () => {
	const theirs = join(root, "app-feature1");
	await git(repo, "worktree", "add", "-b", "feature1", theirs);
	assert.equal(await readLegacyWorktree(theirs), null, "a branch of their own, even with an eight-character tail");
	const detached = join(root, "app-detached");
	await git(repo, "worktree", "add", "--detach", detached);
	assert.equal(await readLegacyWorktree(detached), null, "no branch at all");
});

test("目录已经删了：仓库旁边、分支还在，就推出来（会话 id 的 hex 和定时任务的 base36 都算）", async () => {
	const tree = await oldWorktree("dead0001");
	await rm(tree, { recursive: true, force: true });
	const found = await readLegacyWorktree(tree);
	assert.ok(found, "inferred from the branch left behind");
	assert.ok(same(found.repoRoot, repo));
	assert.equal(found.branch, "lyra/session-dead0001");

	// A scheduled run named its worktree from a throwaway base-36 id; the folder never has to have existed for the inference.
	await git(repo, "branch", "lyra/session-k3x9q2zz");
	const scheduled = await readLegacyWorktree(join(root, "app-k3x9q2zz"));
	assert.equal(scheduled?.branch, "lyra/session-k3x9q2zz");
});

test("目录已经删了但推不出来：分支没了、旁边没有那个仓库、名字不对、旁边那个不是仓库的顶层", async () => {
	assert.equal(await readLegacyWorktree(join(root, "app-nobranch")), null, "no lyra/session-nobranch");
	assert.equal(await readLegacyWorktree(join(root, "ghost-a1b2c3d4")), null, "no repository called ghost");
	assert.equal(await readLegacyWorktree(join(root, "app-short")), null, "not <repo>-<eight>");
	await oldWorktree("0dd1ab1e");
	assert.equal(await readLegacyWorktree(join(repo, "packages-0dd1ab1e")), null, "packages/ is inside a checkout, not the top of one");
});

// ---------------------------------------------------------------------------
// Which conversations are asked about
// ---------------------------------------------------------------------------

const meta = (id: string, cwd: string, extra: Partial<SessionMeta> = {}): SessionMeta =>
	({ id, cwd, title: id, projectId: id, projectName: id, createdAt: 1, updatedAt: 1, modelId: "m", messageCount: 2, usage: {} as SessionMeta["usage"], seq: 3, ...extra }) as SessionMeta;

test("候选只有：没有 worktree 字段、cwd 不在任何已登记文件夹和草稿目录里", () => {
	const sessions = [
		meta("in-project", "/p"),
		meta("in-a-package", "/p/packages/web"),
		meta("in-second-folder", "/second/x"),
		meta("scratch", "/home/.lyra/workspaces/general"),
		meta("filed-already", "/r-abcd1235", { worktree: { project: "/r", branch: "lyra/session-abcd1235" } }),
		meta("relative", "r-abcd1236"),
		meta("beside", "/r-abcd1234"),
		meta("look-alike", "/p-abcd1237"),
	];
	const roots = [...registeredFolders({ projects: [{ id: "p", name: "P", path: "/p", folders: ["/p", "/second"], pinned: false, lastOpenedAt: 0 }] }).map((folder) => folder.path), "/home/.lyra/workspaces"];
	assert.deepEqual(repairCandidates(sessions, roots).map((one) => one.id), ["beside", "look-alike"]);
});

test("候选判断认得同一个目录的两种写法", () => {
	const unlink = (path: string) => path.replace(/^\/private/, "");
	const sessions = [meta("canonical", "/private/var/p/sub"), meta("outside", "/private/var/p-abcd1234")];
	assert.deepEqual(repairCandidates(sessions, ["/var/p"], unlink).map((one) => one.id), ["outside"]);
});

// ---------------------------------------------------------------------------
// Which project
// ---------------------------------------------------------------------------

test("项目选择：正好是仓库根的那个；项目的第二个文件夹正好是仓库根时用它，名字是项目的", () => {
	const folders = registeredFolders({
		projects: [
			{ id: "web", name: "Web", path: "/r/packages/web", pinned: false, lastOpenedAt: 0 },
			{ id: "both", name: "Both", path: "/other", folders: ["/other", "/r"], pinned: false, lastOpenedAt: 0 },
		],
	});
	assert.deepEqual(pickHome("/r", folders), { path: "/r", name: "Both" });
	assert.deepEqual(pickHome("/r", [{ path: "/r", name: "R" }, { path: "/r/packages/web", name: "Web" }]), { path: "/r", name: "R" });
});

test("项目选择：仓库里只有一个已登记的子目录就用它；两个就退回仓库根；都没有也是仓库根", () => {
	assert.deepEqual(pickHome("/r", [{ path: "/r/packages/web", name: "Web" }, { path: "/elsewhere", name: "E" }]), { path: "/r/packages/web", name: "Web" });
	assert.deepEqual(pickHome("/r", [{ path: "/r/packages/web", name: "Web" }, { path: "/r/packages/api", name: "Api" }]), { path: "/r", name: "r" });
	assert.deepEqual(pickHome("/r", [{ path: "/elsewhere", name: "E" }, { path: "/r-other", name: "Look-alike" }]), { path: "/r", name: "r" });
	assert.deepEqual(pickHome("/r", []), { path: "/r", name: "r" });
});

test("项目选择：按规范写法比，写回去的是登记时的写法（侧栏按这个字符串找分组）", () => {
	const unlink = (path: string) => path.replace(/^\/private/, "");
	assert.deepEqual(pickHome("/private/var/r", [{ path: "/var/r", name: "R" }], unlink), { path: "/var/r", name: "R" });
});

// ---------------------------------------------------------------------------
// Filing, end to end through the store the app uses
// ---------------------------------------------------------------------------

interface Fixture {
	store: SessionStorage;
	changes: SessionChange[];
	home: string;
}

async function withStore(run: (fixture: Fixture) => Promise<void>): Promise<void> {
	const home = await mkdtemp(join(tmpdir(), "lyra-wt-repair-store-"));
	const changes: SessionChange[] = [];
	const store = observeSessionStorage(new SessionStore(join(home, "sessions")), (change) => changes.push(change));
	try {
		await run({ store, changes, home });
	} finally {
		await rm(home, { recursive: true, force: true });
	}
}

/** A conversation started in `project` and moved into its worktree the way the old `startStoredSession` did it: `cwd` rewritten, nothing else. */
async function startedThere(store: SessionStorage, project: string, tree: string, title: string): Promise<SessionMeta> {
	let one = await store.create(project, "model", title);
	one = (await store.append(one, { type: "message", message: { role: "user", content: [{ type: "text", text: title }], timestamp: 1 } }))!;
	return (await store.append(one, { type: "meta", meta: { ...one, cwd: tree } }))!;
}

/** A conversation a scheduled run made: created in the worktree itself, so its id and name are the worktree's. */
async function createdIn(store: SessionStorage, tree: string, title: string): Promise<SessionMeta> {
	const one = await store.create(tree, "model", title);
	return (await store.append(one, { type: "message", message: { role: "user", content: [{ type: "text", text: title }], timestamp: 1 } }))!;
}

const listed = async (store: SessionStorage, id: string) => (await store.listSessions()).find((one) => one.id === id);

test("归位：写上 worktree、项目名换成项目的、cwd 和 updatedAt 都不动；推给窗口；再跑一次什么都不写", async () => {
	await withStore(async ({ store, changes, home }) => {
		const living = await startedThere(store, repo, await oldWorktree("11110001"), "工作树里的对话");
		const goneTree = await oldWorktree("22220002");
		const gone = await createdIn(store, goneTree, "定时任务");
		await rm(goneTree, { recursive: true, force: true });
		const plain = await createdIn(store, repo, "项目里的对话");
		const theirs = join(root, "app-theirs01");
		await git(repo, "worktree", "add", "-b", "theirs01", theirs);
		const handMade = await startedThere(store, repo, theirs, "手建工作树");
		const before = new Map((await store.listSessions()).map((one) => [one.id, one]));
		const settings = { projects: [{ id: "app", name: "App", path: repo, pinned: true, lastOpenedAt: 0 }] };

		const filed = await repairLegacyWorktrees({ store, settings, scratch: [join(home, "workspaces")] });
		assert.deepEqual(filed.map((one) => one.id).sort(), [living.id, gone.id].sort());

		const livingAfter = (await listed(store, living.id))!;
		assert.deepEqual(livingAfter.worktree, { project: repo, branch: "lyra/session-11110001" });
		assert.equal(livingAfter.cwd, living.cwd, "it still runs in the worktree");
		assert.equal(livingAfter.projectName, "App");
		assert.equal(livingAfter.updatedAt, before.get(living.id)!.updatedAt, "filed, not used: it keeps its place in the list");
		const goneAfter = (await listed(store, gone.id))!;
		assert.deepEqual(goneAfter.worktree, { project: repo, branch: "lyra/session-22220002" });
		assert.equal(goneAfter.cwd, goneTree);
		assert.equal(goneAfter.projectName, "App", `was ${gone.projectName}, the worktree's folder name`);
		assert.equal(goneAfter.updatedAt, before.get(gone.id)!.updatedAt);
		assert.deepEqual(
			(await store.listSessions()).map((one) => one.id),
			[...before.keys()],
			"the order of the list is the order it was",
		);

		for (const untouched of [plain, handMade]) assert.deepEqual(await listed(store, untouched.id), before.get(untouched.id), `${untouched.title} is left as it was`);

		const pushed = changes.filter((change) => change.meta?.worktree).map((change) => change.id);
		assert.deepEqual(pushed.sort(), [living.id, gone.id].sort(), "the window hears of both, so the sidebar regroups on its own");

		const seqs = (await store.listSessions()).map((one) => one.seq);
		assert.deepEqual(await repairLegacyWorktrees({ store, settings, scratch: [] }), [], "filed once: no longer a candidate");
		assert.deepEqual((await store.listSessions()).map((one) => one.seq), seqs, "and nothing written the second time");
		const reopened = (await new SessionStore(join(home, "sessions")).listSessions()).find((one) => one.id === living.id);
		assert.deepEqual(reopened?.worktree, { project: repo, branch: "lyra/session-11110001" }, "kept across a restart");
	});
});

test("从子目录项目开的会话归回那个子目录，哪怕仓库根也登记成了项目；定时任务式的那个按仓库根", async () => {
	await withStore(async ({ store }) => {
		const web = join(repo, "packages", "web");
		const fromWeb = await startedThere(store, web, await oldWorktree("33330003"), "从 web 开的");
		const scheduled = await createdIn(store, await oldWorktree("44440004"), "定时任务");
		const settings = {
			projects: [
				{ id: "app", name: "App", path: repo, pinned: false, lastOpenedAt: 0 },
				{ id: "web", name: "Web", path: web, pinned: false, lastOpenedAt: 0 },
			],
		};
		await repairLegacyWorktrees({ store, settings, scratch: [] });
		assert.deepEqual((await listed(store, fromWeb.id))?.worktree, { project: web, branch: "lyra/session-33330003" });
		assert.equal((await listed(store, fromWeb.id))?.projectName, "Web");
		assert.deepEqual((await listed(store, scheduled.id))?.worktree, { project: repo, branch: "lyra/session-44440004" });

		const alone = await createdIn(store, await oldWorktree("55550005"), "只登记了子目录");
		await repairLegacyWorktrees({ store, settings: { projects: [settings.projects[1]] }, scratch: [] });
		assert.deepEqual((await listed(store, alone.id))?.worktree, { project: web, branch: "lyra/session-55550005" }, "the only registered folder inside the repository");
		assert.equal((await listed(store, alone.id))?.projectName, "Web");
	});
});

test("项目经软链登记：worktree.project 写成登记的那个写法，不是 git 给的真实路径", async () => {
	await withStore(async ({ store, home }) => {
		const link = join(home, "linked");
		await symlink(root, link, "junction");
		const project = join(link, "app");
		const started = await startedThere(store, project, await oldWorktree("66660006"), "经软链开的项目");
		const scheduled = await createdIn(store, await oldWorktree("77770007"), "定时任务");
		await repairLegacyWorktrees({ store, settings: { projects: [{ id: "app", name: "App", path: project, pinned: false, lastOpenedAt: 0 }] }, scratch: [] });
		assert.equal((await listed(store, started.id))?.worktree?.project, project);
		assert.equal((await listed(store, scheduled.id))?.worktree?.project, project);
	});
});

test("没登记任何项目时归到仓库根，名字是仓库目录名", async () => {
	await withStore(async ({ store }) => {
		const scheduled = await createdIn(store, await oldWorktree("88880008"), "定时任务");
		await repairLegacyWorktrees({ store, settings: { projects: [] }, scratch: [] });
		const after = await listed(store, scheduled.id);
		assert.ok(same(after?.worktree?.project, repo));
		assert.equal(after?.projectName, "app");
	});
});

test("问 git 的那一会儿里会话被移去别的项目、或者被删了：不写回去，不把它拉回旧工作树、不让它复活", async () => {
	await withStore(async ({ store }) => {
		const moved = await createdIn(store, await oldWorktree("cccc000c"), "中途被移走");
		const deleted = await createdIn(store, await oldWorktree("dddd000d"), "中途被删");
		const get = store.get!.bind(store);
		// What the window does while git is still answering, landing just before the repair reads the conversation again.
		store.get = async (id) => {
			if (id === moved.id) await store.move(moved.projectId, moved.id, repo, "App");
			if (id === deleted.id) await store.delete(deleted.projectId, deleted.id);
			return get(id);
		};
		const filed = await repairLegacyWorktrees({ store, settings: { projects: [{ id: "app", name: "App", path: repo, pinned: false, lastOpenedAt: 0 }] }, scratch: [] });
		assert.deepEqual(filed, []);
		const after = await listed(store, moved.id);
		assert.equal(after?.cwd, repo, "stays where it was moved to");
		assert.equal(after?.worktree, undefined);
		assert.equal(await listed(store, deleted.id), undefined, "stays deleted");
	});
});

test("正开着的会话这次不动；一个会话写不进去，不影响其他的", async () => {
	await withStore(async ({ store }) => {
		const open = await createdIn(store, await oldWorktree("99990009"), "正开着");
		const broken = await createdIn(store, await oldWorktree("aaaa000a"), "写不进去");
		const fine = await createdIn(store, await oldWorktree("bbbb000b"), "正常");
		const move = store.move.bind(store);
		store.move = async (...args) => {
			if (args[1] === broken.id) throw new Error("disk unavailable");
			return move(...args);
		};
		const settings = { projects: [{ id: "app", name: "App", path: repo, pinned: false, lastOpenedAt: 0 }] };
		const filed = await repairLegacyWorktrees({ store, settings, scratch: [], busy: (id) => id === open.id });
		assert.deepEqual(filed.map((one) => one.id), [fine.id]);
		assert.equal((await listed(store, open.id))?.worktree, undefined, "left for the next start");
		assert.equal((await listed(store, broken.id))?.worktree, undefined);
		assert.ok((await listed(store, fine.id))?.worktree);
	});
});
