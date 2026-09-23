import { execFile } from "node:child_process";
import { readFile, lstat } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import type { ToolContext } from "../types.ts";
import { recordFileChange } from "./file-changes.ts";

const exec = promisify(execFile);
interface Snapshot { root: string; head: string | null; files: Map<string, string | null> }
async function git(cwd: string, args: string[]): Promise<string> { return (await exec("git", ["-C", cwd, ...args], { maxBuffer: 20 * 1024 * 1024, timeout: 5000, windowsHide: true })).stdout; }
async function names(root: string, head: string | null): Promise<string[]> {
	const [tracked, untracked] = await Promise.all([git(root, head ? ["diff", "--name-only", "-z", head, "--"] : ["ls-files", "--cached", "-z"]), git(root, ["ls-files", "--others", "--exclude-standard", "-z"])]);
	return [...new Set((tracked + untracked).split("\0").filter(Boolean))];
}
async function content(path: string): Promise<string | null> {
	try {
		const stat = await lstat(path);
		if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error(`无法记录大型文件或非普通文件：${path}`);
		const value = await readFile(path, "utf8");
		if (value.includes("\0")) throw new Error(`无法记录二进制文件：${path}`);
		return value;
	} catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return null; throw error; }
}
export async function beforeCommand(ctx: ToolContext): Promise<Snapshot | null> {
	if (!ctx.scratchDir) return null;
	let root: string;
	try { root = (await git(ctx.cwd, ["rev-parse", "--show-toplevel"])).trim(); }
	catch { return null; }
	let head: string | null;
	try { head = (await git(root, ["rev-parse", "HEAD"])).trim(); } catch { head = null; }
	const paths = await names(root, head);
	if (paths.length > 200) throw new Error("工作区已有超过 200 个改动文件，本次命令不自动记录文件差异");
	const files = new Map<string, string | null>();
	let bytes = 0;
	for (const path of paths) {
		const value = await content(join(root, path)); bytes += value?.length ?? 0;
		if (bytes > 16 * 1024 * 1024) throw new Error("已有改动超过 16 MiB，本次命令不自动记录文件差异");
		files.set(path, value);
	}
	return { root, head, files };
}
export async function afterCommand(ctx: ToolContext, before: Snapshot | null): Promise<string[]> {
	if (!before) return [];
	const paths = [...new Set([...await names(before.root, before.head), ...before.files.keys()])];
	if (paths.length > 200) throw new Error("命令影响超过 200 个文件，请在 Git 面板查看完整差异");
	const ids: string[] = [];
	for (const path of paths) {
		const absolute = join(before.root, path);
		const after = await content(absolute);
		let original = before.files.get(path);
		if (original === undefined) {
			/*
			 * `cat-file --filters`, not `show`: a blob is stored normalized and `show` returns it as stored
			 * — LF — while the file on disk went through the checkout's conversion (CRLF under
			 * `core.autocrlf` or `eol=crlf`). Every line differed, and a one-line change was recorded as
			 * the whole file rewritten. `--filters` (Git 2.11+) converts the way a checkout does.
			 */
			try { original = before.head ? await git(before.root, ["cat-file", "--filters", `${before.head}:${relative(before.root, absolute).split("\\").join("/")}`]) : null; }
			catch { original = null; }
		}
		if (original === after) continue;
		const id = await recordFileChange(ctx, absolute, original, after, "command"); if (id) ids.push(id);
	}
	return ids;
}
