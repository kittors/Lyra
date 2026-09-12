/**
 * Git release preparation, dry-run monitoring, and publishing.
 *
 * Provides inspect info (latest tag, package versions, commits since last tag),
 * bump & commit versioning across Monorepo package.json files,
 * workflow trigger & monitoring for dry runs, and final release tagging.
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { git } from "./git-exec.ts";
import { isGitRepo } from "./git.ts";
import { listAccounts, tokenFor } from "./forge/vault.ts";
import { json as forgeJson } from "./forge/http.ts";
import type { ForgeConnection } from "./forge/types.ts";

export interface ReleaseInfo {
	currentVersion: string;
	latestTag: string | null;
	commitsSinceTag: { sha: string; shortSha: string; subject: string; author: string; date: string }[];
	suggestedVersion: {
		patch: string;
		minor: string;
		major: string;
	};
}

interface WorkflowJobStep {
	name: string;
	status: string;
	conclusion: string | null;
	number: number;
	startedAt?: string;
	completedAt?: string;
}

interface WorkflowJob {
	id: number;
	name: string;
	status: string;
	conclusion: string | null;
	url?: string;
	startedAt?: string;
	completedAt?: string;
	steps?: WorkflowJobStep[];
}

export interface WorkflowRunSummary {
	id: number;
	name: string;
	displayTitle: string;
	event: string;
	status: "queued" | "in_progress" | "completed" | "waiting" | "unknown";
	conclusion: "success" | "failure" | "cancelled" | "timed_out" | "skipped" | null;
	headBranch: string;
	headSha: string;
	createdAt: string;
	url: string;
	jobs?: WorkflowJob[];
}

export interface WorkflowRunStatus {
	id: number;
	name?: string;
	displayTitle?: string;
	event?: string;
	status: "queued" | "in_progress" | "completed" | "waiting" | "unknown";
	conclusion: "success" | "failure" | "cancelled" | "timed_out" | "skipped" | null;
	url: string;
	createdAt?: string;
	headBranch?: string;
	headSha?: string;
	jobs: WorkflowJob[];
}

/**
 * Increment semver version strings safely.
 */
export function bumpSemver(version: string, type: "patch" | "minor" | "major"): string {
	const clean = version.replace(/^v/, "").trim();
	const parts = clean.split(".").map((n) => Number.parseInt(n, 10) || 0);
	while (parts.length < 3) parts.push(0);

	if (type === "major") {
		return `${parts[0] + 1}.0.0`;
	}
	if (type === "minor") {
		return `${parts[0]}.${parts[1] + 1}.0`;
	}
	return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}

/**
 * Find all package.json files across the workspace root and packages/*
 */
async function getPackageJsonPaths(cwd: string): Promise<string[]> {
	const results = [join(cwd, "package.json")];
	const packagesDir = join(cwd, "packages");
	try {
		const entries = await fs.readdir(packagesDir, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.isDirectory()) {
				const pkgPath = join(packagesDir, entry.name, "package.json");
				try {
					await fs.access(pkgPath);
					results.push(pkgPath);
				} catch {
					// Ignore subdirectories without package.json
				}
			}
		}
	} catch {
		// No packages folder
	}
	return results;
}

/**
 * Read current release readiness information from repository.
 */
export async function getReleaseInfo(cwd: string): Promise<ReleaseInfo> {
	if (!(await isGitRepo(cwd))) {
		throw new Error("当前目录不是 Git 仓库");
	}

	let currentVersion = "0.0.0";
	try {
		const rootPkg = JSON.parse(await fs.readFile(join(cwd, "package.json"), "utf8"));
		if (rootPkg.version) currentVersion = rootPkg.version;
	} catch {
		// fallback to 0.0.0
	}

	// Find the latest tag
	const latestTag = await git(cwd, ["describe", "--tags", "--abbrev=0"])
		.then((out) => out.trim())
		.catch(() => null);

	// Get commits since tag or all commits if no tag
	const range = latestTag ? [`${latestTag}..HEAD`] : ["-n", "50"];
	const logOut = await git(cwd, ["log", "--no-merges", "--format=%H%x1f%h%x1f%s%x1f%an%x1f%ad", ...range])
		.then((out) => out.trim())
		.catch(() => "");

	const commitsSinceTag = logOut
		? logOut
				.split("\n")
				.filter(Boolean)
				.map((line) => {
					const [sha, shortSha, subject, author, date] = line.split("\x1f");
					return { sha, shortSha, subject, author, date };
				})
		: [];

	return {
		currentVersion,
		latestTag,
		commitsSinceTag,
		suggestedVersion: {
			patch: bumpSemver(currentVersion, "patch"),
			minor: bumpSemver(currentVersion, "minor"),
			major: bumpSemver(currentVersion, "major"),
		},
	};
}

/**
 * Bump version across all package.json files in repository.
 */
export async function bumpVersionFiles(cwd: string, newVersion: string): Promise<{ ok: boolean; error?: string }> {
	const version = newVersion.replace(/^v/, "").trim();
	if (!/^\d+\.\d+\.\d+/.test(version)) {
		return { ok: false, error: "版本号格式不正确 (必须符合 x.y.z)" };
	}

	try {
		const pkgPaths = await getPackageJsonPaths(cwd);
		for (const pkgPath of pkgPaths) {
			const content = await fs.readFile(pkgPath, "utf8");
			const json = JSON.parse(content);
			json.version = version;
			await fs.writeFile(pkgPath, `${JSON.stringify(json, null, 2)}\n`, "utf8");
		}
		return { ok: true };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
}

/**
 * Parse remote origin URL into host and owner/repo.
 * Supports:
 * - git@github.com:owner/repo.git
 * - https://github.com/owner/repo.git
 * - ssh://git@github.com/owner/repo.git
 */
export async function getRepoInfo(cwd: string): Promise<{ owner: string; name: string; host: string } | null> {
	try {
		const rawUrl = await git(cwd, ["remote", "get-url", "origin"]).then((s) => s.trim());
		if (!rawUrl) return null;

		// Match SCP-like git@host:owner/repo.git
		const scpMatch = rawUrl.match(/^(?:[\w-]+@)?([\w.-]+):([^\s/]+)\/([^\s/]+?)(?:\.git)?$/);
		if (scpMatch) {
			return { host: scpMatch[1], owner: scpMatch[2], name: scpMatch[3] };
		}

		// Match standard URLs (https://, http://, ssh://)
		const url = new URL(rawUrl.includes("://") ? rawUrl : `ssh://${rawUrl}`);
		const parts = url.pathname.replace(/^\/+/, "").replace(/\.git$/, "").split("/");
		if (parts.length >= 2) {
			return { host: url.hostname, owner: parts[parts.length - 2], name: parts[parts.length - 1] };
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Get forge connection / token for the repository.
 * Searches configured Forge accounts for matching host, or falls back to GITHUB_TOKEN environment variable.
 */
async function getGithubConnection(host = "github.com"): Promise<ForgeConnection | null> {
	try {
		const accounts = await listAccounts();
		const matching = accounts.find((a) => a.kind === "github" && (a.baseUrl.includes(host) || (host === "github.com" && a.baseUrl.includes("github.com"))));
		if (matching) {
			const token = await tokenFor(matching.id);
			if (token) {
				return { account: matching, token };
			}
		}
	} catch {
		// Forge account lookup failed
	}

	const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
	if (envToken) {
		return {
			account: {
				id: "env-github",
				kind: "github",
				label: "GitHub (Environment)",
				baseUrl: host === "github.com" ? "https://github.com" : `https://${host}`,
				login: "env-user",
				avatarUrl: null,
				addedAt: Date.now(),
				enabled: true,
			},
			token: envToken,
		};
	}

	// Anonymous / public connection for open source repositories
	return {
		account: {
			id: "anonymous",
			kind: "github",
			label: "GitHub",
			baseUrl: host === "github.com" ? "https://github.com" : `https://${host}`,
			login: "anonymous",
			avatarUrl: null,
			addedAt: Date.now(),
			enabled: true,
		},
		token: "",
	};
}

/**
 * Trigger GitHub Actions Release Dry Run workflow via native GitHub REST API.
 */
export async function triggerReleaseDryRun(cwd: string): Promise<{ ok: boolean; runId?: number; error?: string }> {
	try {
		const repoInfo = await getRepoInfo(cwd);
		if (!repoInfo) {
			return { ok: false, error: "未能识别当前仓库的 Git Remote 远程地址" };
		}

		const conn = await getGithubConnection(repoInfo.host);
		if (!conn || !conn.token) {
			return {
				ok: false,
				error: "触发流水线需要 GitHub 访问令牌，请在代码托管设置中添加 GitHub 账号或设置 GITHUB_TOKEN 环境变量",
			};
		}

		const currentBranch = (await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "main")).trim();

		// Trigger workflow_dispatch REST API
		await forgeJson(
			conn,
			`/repos/${encodeURIComponent(repoInfo.owner)}/${encodeURIComponent(repoInfo.name)}/actions/workflows/release-dryrun.yml/dispatches`,
			{
				method: "POST",
				body: { ref: currentBranch || "main" },
			},
		);

		// Wait briefly and poll for the newly started run
		for (let i = 0; i < 4; i++) {
			await new Promise((resolve) => setTimeout(resolve, 1500));
			const res = await forgeJson<{ workflow_runs?: { id: number; status: string; html_url: string }[] }>(
				conn,
				`/repos/${encodeURIComponent(repoInfo.owner)}/${encodeURIComponent(repoInfo.name)}/actions/workflows/release-dryrun.yml/runs`,
				{
					query: { per_page: 1 },
				},
			).catch(() => null);

			if (res?.workflow_runs && res.workflow_runs.length > 0 && res.workflow_runs[0]?.id) {
				return { ok: true, runId: res.workflow_runs[0].id };
			}
		}

		return { ok: true };
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : "触发 GitHub Actions 失败，请检查网络连接与权限",
		};
	}
}

/**
 * List recent GitHub Actions workflow runs for the repository via native GitHub REST API.
 */
export async function listWorkflowRuns(cwd: string, limit = 20): Promise<WorkflowRunSummary[]> {
	try {
		const repoInfo = await getRepoInfo(cwd);
		if (!repoInfo) return [];

		const conn = await getGithubConnection(repoInfo.host);
		if (!conn) return [];

		const res = await forgeJson<{
			workflow_runs?: {
				id: number;
				name: string;
				display_title?: string;
				event: string;
				status: string;
				conclusion: string | null;
				head_branch: string;
				head_sha: string;
				created_at: string;
				html_url: string;
			}[];
		}>(conn, `/repos/${encodeURIComponent(repoInfo.owner)}/${encodeURIComponent(repoInfo.name)}/actions/runs`, {
			query: { per_page: limit },
		});

		if (!res || !Array.isArray(res.workflow_runs)) return [];

		return res.workflow_runs.map((r) => ({
			id: r.id,
			name: r.name,
			displayTitle: r.display_title || r.name,
			event: r.event,
			status: (r.status as WorkflowRunSummary["status"]) || "unknown",
			conclusion: (r.conclusion as WorkflowRunSummary["conclusion"]) || null,
			headBranch: r.head_branch || "",
			headSha: r.head_sha || "",
			createdAt: r.created_at,
			url: r.html_url,
		}));
	} catch {
		return [];
	}
}

/**
 * Get GitHub Actions Run status with detailed jobs and steps via native GitHub REST API.
 */
export async function getWorkflowRunStatus(cwd: string, runId: number): Promise<WorkflowRunStatus | null> {
	try {
		const repoInfo = await getRepoInfo(cwd);
		if (!repoInfo) return null;

		const conn = await getGithubConnection(repoInfo.host);
		if (!conn) return null;

		const [runData, jobsData] = await Promise.all([
			forgeJson<{
				id: number;
				name: string;
				display_title?: string;
				event: string;
				status: string;
				conclusion: string | null;
				html_url: string;
				created_at: string;
				head_branch: string;
				head_sha: string;
			}>(conn, `/repos/${encodeURIComponent(repoInfo.owner)}/${encodeURIComponent(repoInfo.name)}/actions/runs/${runId}`),
			forgeJson<{
				jobs?: {
					id: number;
					name: string;
					status: string;
					conclusion: string | null;
					html_url?: string;
					started_at?: string;
					completed_at?: string;
					steps?: {
						name: string;
						status: string;
						conclusion: string | null;
						number: number;
						started_at?: string;
						completed_at?: string;
					}[];
				}[];
			}>(conn, `/repos/${encodeURIComponent(repoInfo.owner)}/${encodeURIComponent(repoInfo.name)}/actions/runs/${runId}/jobs`),
		]);

		if (!runData) return null;

		const jobs: WorkflowJob[] = Array.isArray(jobsData?.jobs)
			? jobsData.jobs.map((j) => ({
					id: j.id,
					name: j.name,
					status: j.status,
					conclusion: j.conclusion,
					url: j.html_url,
					startedAt: j.started_at,
					completedAt: j.completed_at,
					steps: Array.isArray(j.steps)
						? j.steps.map((s) => ({
								name: s.name,
								status: s.status,
								conclusion: s.conclusion,
								number: s.number,
								startedAt: s.started_at,
								completedAt: s.completed_at,
							}))
						: [],
				}))
			: [];

		// If all jobs are completed, derive overall conclusion and status accurately
		let status = (runData.status as WorkflowRunStatus["status"]) || "unknown";
		let conclusion = (runData.conclusion as WorkflowRunStatus["conclusion"]) || null;
		if (jobs.length > 0 && jobs.every((j) => j.status === "completed")) {
			status = "completed";
			if (!conclusion) {
				const hasFailure = jobs.some((j) => j.conclusion === "failure" || j.conclusion === "timed_out");
				const hasCancelled = jobs.some((j) => j.conclusion === "cancelled");
				conclusion = hasFailure ? "failure" : hasCancelled ? "cancelled" : "success";
			}
		}

		return {
			id: runData.id,
			name: runData.name,
			displayTitle: runData.display_title || runData.name,
			event: runData.event,
			status,
			conclusion,
			url: runData.html_url,
			createdAt: runData.created_at,
			headBranch: runData.head_branch,
			headSha: runData.head_sha,
			jobs,
		};
	} catch {
		return null;
	}
}

/**
 * Create a release Git tag and push it to trigger the final release workflow.
 */
export async function publishReleaseTag(
	cwd: string,
	version: string,
): Promise<{ ok: boolean; tag?: string; error?: string }> {
	const tag = version.startsWith("v") ? version.trim() : `v${version.trim()}`;
	try {
		// Stage and commit version bumps if not yet committed
		const statusOut = await git(cwd, ["status", "--porcelain"]).catch(() => "");
		if (statusOut.includes("package.json")) {
			await git(cwd, ["add", "package.json", "packages/*/package.json"]);
			await git(cwd, ["commit", "-m", `chore(release): bump version to ${version.replace(/^v/, "")}`]);
			await git(cwd, ["push"]);
		}

		// Create and push tag
		await git(cwd, ["tag", tag]);
		await git(cwd, ["push", "origin", tag]);
		return { ok: true, tag };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
}
