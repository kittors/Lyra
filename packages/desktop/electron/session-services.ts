import { execFile } from "node:child_process";
import { request } from "node:http";
import { promisify } from "node:util";
import { backgroundJobs } from "@lyra/core";
import type { ServiceEndpoint, SessionServices } from "../shared/session-services.ts";
import { advertisedEndpoints, descendants, localHost, parseLsof, parseProcesses, parseSs, parseWindowsListeners, serviceUrl, type ProcessEntry } from "./service-listeners.ts";
import { sessions } from "./session-hub.ts";

const exec = promisify(execFile);
async function command(file: string, args: string[], timeout = 4000): Promise<string> {
	return (await exec(file, args, { timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true })).stdout;
}
async function listeners(): Promise<{ processes: ProcessEntry[]; listeners: ServiceEndpoint[] }> {
	if (process.platform === "win32") {
		// Continue, not Stop: an empty Listen set and a single bad OwningProcess used to abort
		// the whole snapshot, so a live job showed no port. CIM of every process on a loaded
		// runner also overran 4s; 15s is the query, advertised stdout URLs still cover a miss.
		const script = "$p=@(); $l=@(); try { $p=@(Get-CimInstance Win32_Process -ErrorAction Stop | ForEach-Object { @{pid=[int]$_.ProcessId; parent=[int]$_.ParentProcessId} }) } catch {}; try { $l=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $null -ne $_.OwningProcess } | ForEach-Object { @{pid=[int]$_.OwningProcess; address=[string]$_.LocalAddress; port=[int]$_.LocalPort} }) } catch {}; @{processes=$p; listeners=$l} | ConvertTo-Json -Depth 4 -Compress";
		const value: unknown = JSON.parse(await command("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], 15_000));
		return parseWindowsListeners(value);
	}
	const [processes, sockets] = await Promise.all([
		command("ps", ["-axo", "pid=,ppid="]),
		process.platform === "darwin" ? command("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn"]) : command("ss", ["-H", "-ltnp"]),
	]);
	return { processes: parseProcesses(processes), listeners: process.platform === "darwin" ? parseLsof(sockets) : parseSs(sockets) };
}
async function httpUrl(endpoint: ServiceEndpoint): Promise<string | undefined> {
	const host = localHost(endpoint.address);
	const url = `http://${host.includes(":") ? `[${host}]` : host}:${endpoint.port}/`;
	return new Promise((resolve) => {
		const req = request(url, { method: "HEAD" }, (response) => { response.resume(); resolve(url); });
		const timer = setTimeout(() => req.destroy(), 700);
		req.once("close", () => { clearTimeout(timer); resolve(undefined); });
		req.once("error", () => resolve(undefined)); req.end();
	});
}
// One OS query at a time, shared across panels in a refresh cycle.
let pending: Promise<SessionServices> | undefined;
let pendingSession: string | undefined;
export async function listSessionServices(sessionId: string): Promise<SessionServices> {
	if (pending && pendingSession === sessionId) return pending;
	const task = collect(sessionId); pending = task; pendingSession = sessionId;
	try { return await task; } finally { if (pending === task) { pending = undefined; pendingSession = undefined; } }
}
async function collect(sessionId: string): Promise<SessionServices> {
	const session = sessions.get(sessionId);
	if (!session) return { jobs: [] };
	const jobs = backgroundJobs(session.can.state).list().slice(-30);
	const response: SessionServices = { jobs: jobs.map(({ output: _output, ...job }) => ({ ...job, endpoints: [] })) };
	if (!jobs.some((job) => job.pid && job.finishedAt === undefined)) return response;
	let snapshot: { processes: ProcessEntry[]; listeners: ServiceEndpoint[] } = { processes: [], listeners: [] };
	try { snapshot = await listeners(); }
	catch (error) { response.discoveryError = error instanceof Error ? error.message : String(error); }
	for (const job of response.jobs) {
		if (!job.pid || job.finishedAt !== undefined) continue;
		const output = jobs.find((entry) => entry.id === job.id)?.output ?? "";
		const owned = descendants(job.pid, snapshot.processes);
		const fromOs = await Promise.all(snapshot.listeners.filter((entry) => owned.has(entry.pid)).slice(0, 16).map(async (entry) => ({ ...entry, url: serviceUrl(entry, output) ?? await httpUrl(entry) })));
		job.endpoints = mergeEndpoints(fromOs, advertisedEndpoints(job.pid, output));
	}
	return response;
}
function mergeEndpoints(fromOs: ServiceEndpoint[], fromLog: ServiceEndpoint[]): ServiceEndpoint[] {
	const seen = new Set(fromOs.map((entry) => `${localHost(entry.address)}:${entry.port}`));
	const extra = fromLog.filter((entry) => !seen.has(`${localHost(entry.address)}:${entry.port}`));
	return [...fromOs, ...extra].slice(0, 16);
}
export function stopSessionService(sessionId: string, id: string, force: boolean): boolean {
	const session = sessions.get(sessionId);
	if (!session) return false;
	return backgroundJobs(session.can.state).stop(id, force);
}
