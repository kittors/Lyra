/**
 * Fast client-side cache for CI/CD workflow runs and inspect details.
 *
 * Prevents skeleton flashing when switching back and forth between Git tabs.
 */

import type { WorkflowRunStatus, WorkflowRunSummary } from "../../../electron/ipc-types.ts";

const RUNS_PREFIX = "lyra.pipelines.runs.v1:";
const DETAIL_PREFIX = "lyra.pipelines.detail.v1:";

export function readCachedRuns(cwd: string): WorkflowRunSummary[] {
	try {
		const raw = localStorage.getItem(`${RUNS_PREFIX}${cwd}`);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

export function writeCachedRuns(cwd: string, runs: WorkflowRunSummary[]): void {
	try {
		localStorage.setItem(`${RUNS_PREFIX}${cwd}`, JSON.stringify(runs));
	} catch {}
}

export function readCachedDetail(cwd: string, runId: number): WorkflowRunStatus | null {
	try {
		const raw = localStorage.getItem(`${DETAIL_PREFIX}${cwd}:${runId}`);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === "object" ? parsed : null;
	} catch {
		return null;
	}
}

export function writeCachedDetail(cwd: string, runId: number, detail: WorkflowRunStatus): void {
	try {
		localStorage.setItem(`${DETAIL_PREFIX}${cwd}:${runId}`, JSON.stringify(detail));
	} catch {}
}
