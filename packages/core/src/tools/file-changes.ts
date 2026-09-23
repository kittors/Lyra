import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { mkdir, readFile, writeFile, lstat, realpath, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { lyraHome } from "../session/store.ts";
import type { ToolContext } from "../types.ts";
import { renameWithRetry } from "../utils/atomic-write.ts";

export interface RecordedChange { id: string; path: string; before: string | null; after: string | null; source?: "tool" | "command"; timestamp: number }
function directory(sessionId: string): string { return join(lyraHome(), "changes", createHash("sha256").update(sessionId).digest("hex")); }
export async function recordFileChange(ctx: ToolContext, path: string, before: string | null, after: string | null, source: "tool" | "command" = "tool"): Promise<string | undefined> {
	// Bare tool hosts have no persistent session artifacts.
	if (!ctx.scratchDir) return undefined;
	const id = randomUUID();
	await mkdir(directory(ctx.sessionId), { recursive: true });
	await writeFile(join(directory(ctx.sessionId), `${id}.json`), JSON.stringify({ id, path, before, after, source, timestamp: Date.now() } satisfies RecordedChange), { flag: "wx", mode: 0o600 });
	return id;
}
export async function readFileChange(sessionId: string, id: string): Promise<RecordedChange> {
	if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("无效的变更记录");
	const value: unknown = JSON.parse(await readFile(join(directory(sessionId), `${id}.json`), "utf8"));
	if (!value || typeof value !== "object" || !("id" in value) || value.id !== id || !("path" in value) || typeof value.path !== "string" || !("before" in value) || (value.before !== null && typeof value.before !== "string") || !("after" in value) || (value.after !== null && typeof value.after !== "string") || !("timestamp" in value) || typeof value.timestamp !== "number") throw new Error("变更记录已损坏");
	return { id, path: value.path, before: value.before, after: value.after, source: "source" in value && value.source === "command" ? "command" : "tool", timestamp: value.timestamp };
}
export async function undoFileChanges(cwd: string, changes: RecordedChange[]): Promise<void> {
	await undoFileChangeBatches(cwd, [changes]);
}

async function prepareUndo(cwd: string, changes: RecordedChange[]) {
	if (!changes.length) throw new Error("没有可撤销的变更");
	const first = changes[0], last = changes[changes.length - 1];
	if (changes.some((change) => change.source === "command")) throw new Error("命令执行期间观测到的变更需要手动审阅，不能归因后自动撤销");
	if (!changes.every((change, index) => change.path === first.path && (!index || change.before === changes[index - 1].after))) throw new Error("文件在本轮操作之间存在其他修改，不能自动撤销");
	const root = await realpath(cwd), path = await realpath(first.path);
	const rel = relative(root, path);
	if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`) || (await lstat(first.path)).isSymbolicLink()) throw new Error("只能撤销当前项目内的普通文件");
	if (await readFile(path, "utf8") !== last.after) throw new Error("文件已有后续修改，已保留；请在差异视图中手动处理");
	return { path, before: first.before, after: last.after, mode: (await lstat(path)).mode };
}

let undoing = false;

/** Stage complete contents before replacing a file; failed writes leave its original intact. */
async function replaceRecorded(path: string, expected: string | null, content: string | null, mode: number): Promise<void> {
	const parent = dirname(path);
	if (await realpath(parent) !== parent) throw new Error("文件目录已变化，不能撤销");
	const initial = await lstat(path).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT" && expected === null) return null; throw error; });
	if (initial && (!initial.isFile() || initial.isSymbolicLink())) throw new Error("只能撤销普通文件");
	const temporary = join(parent, `.lyra-undo-${randomUUID()}`);
	try {
		if (content !== null) {
			await fs.writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
			// Creation respects umask; explicit chmod preserves executable/group bits on replacement and rollback.
			await fs.chmod(temporary, mode & 0o777);
		}
		if (await realpath(parent) !== parent) throw new Error("文件目录已变化，不能撤销");
		const current = await lstat(path).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT" && expected === null) return null; throw error; });
		if (current && (!current.isFile() || current.isSymbolicLink())) throw new Error("只能撤销普通文件");
		if (current?.ino !== initial?.ino || current?.dev !== initial?.dev || current?.mtimeMs !== initial?.mtimeMs || current?.ctimeMs !== initial?.ctimeMs) throw new Error("文件已有后续修改，已保留");
		if ((current ? await readFile(path, "utf8") : null) !== expected) throw new Error("文件已有后续修改，已保留");
		if (content === null) await unlink(path);
		else if (expected === null) {
			// Exclusive creation cannot overwrite a file recreated by the user during rollback.
			await fs.link(temporary, path);
			// The file was just written, by the agent or by the rollback, and on Windows whatever scans
			// new files holds it for a moment: waited out rather than reported as a failed undo.
		} else await renameWithRetry(temporary, path);
	} finally { await fs.rm(temporary, { force: true }); }
}

/** The lock includes preflight and rollback, so one undo cannot roll another one's success back. */
export async function undoFileChangeBatches(cwd: string, batches: RecordedChange[][]): Promise<void> {
	// Open projects can be nested and still own the same files, so cwd cannot identify the lock.
	if (undoing) throw new Error("正在撤销改动，请稍后重试");
	undoing = true;
	try {
		const root = await realpath(cwd);
		if (!batches.length) throw new Error("没有可撤销的变更");
		const plans = await Promise.all(batches.map((changes) => prepareUndo(root, changes)));
		if (new Set(plans.map((plan) => plan.path)).size !== plans.length) throw new Error("重复的撤销路径");
		const applied: typeof plans = [];
		try {
			for (const plan of plans) {
				await replaceRecorded(plan.path, plan.after, plan.before, plan.mode);
				applied.push(plan);
			}
		} catch (error) {
			const failures: unknown[] = [error];
			for (const plan of applied.reverse()) {
				try { await replaceRecorded(plan.path, plan.before, plan.after, plan.mode); }
				catch (cause) { failures.push(cause); }
			}
			if (failures.length > 1) throw new AggregateError(failures, "撤销未完成，请检查文件改动", { cause: error });
			throw error;
		}
	} finally { undoing = false; }
}
