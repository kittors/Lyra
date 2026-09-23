import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { BackgroundJobs, backgroundJobs, type BackgroundJob } from "../src/tools/background-jobs.ts";
import type { SandboxProcess } from "../src/kernel/services.ts";
import { useSandbox } from "../src/sandbox/index.ts";
import { bashTool } from "../src/tools/bash.ts";
import { SessionCapabilities } from "../src/runtime/session-capabilities.ts";
import { systemShell } from "../src/platform.ts";
test("a session can stop only its own process handle, and a terminated job cannot target a reused PID", () => {
	const a=new BackgroundJobs(),b=new BackgroundJobs(),signals:string[]=[];
	const info:BackgroundJob={id:"owned",command:"dev",startedAt:1,exitCode:null,output:"",pid:123,status:"running"};
	const process:SandboxProcess={onOutput(){},onExit(){},onError(){},kill(signal){signals.push(signal??"");}};
	a.add(info,process);
	assert.equal(b.stop("owned",true),false);assert.equal(a.stop("123",true),false);assert.equal(signals.length,0);
	assert.equal(a.stop("owned"),true);assert.deepEqual(signals,["SIGTERM"]);
	info.finishedAt=2;info.status="exited";assert.equal(a.stop("owned",true),false);assert.equal(signals.length,1);
});

test("one unkillable background process cannot leak the other processes and session resources", async () => {
	const capabilities = new SessionCapabilities();
	const jobs = backgroundJobs(capabilities.state);
	const closed: string[] = [];
	const denied = new Error("EPERM: process belongs to a different user");
	for (const id of ["denied", "owned"]) {
		jobs.add({ id, command: "server", startedAt: 1, exitCode: null, output: "", status: "running" }, {
			onOutput() {}, onError() {}, onExit() {},
			kill() { closed.push(id); if (id === "denied") throw denied; },
		});
	}
	capabilities.mcp.closeAll = async () => { closed.push("mcp"); };
	capabilities.extensions.dispose = async () => { closed.push("extensions"); };
	let failure: unknown;
	await assert.rejects(capabilities.dispose(), error => { failure = error; return true; });
	assert.deepEqual(closed, ["denied", "owned", "mcp", "extensions"]);
	assert.ok(failure instanceof AggregateError);
	assert.deepEqual(failure.errors, [denied]);
	assert.equal(jobs.get("denied")?.status, "failed");
	assert.match(jobs.get("denied")?.error ?? "", /EPERM/);
});
test("a signalled command keeps its missing exit code instead of reporting exit 0", async () => {
	useSandbox({ run: () => ({ onOutput() {}, onError() {}, kill() {}, onExit(listener) { queueMicrotask(() => listener(null)); } }) });
	try {
		const result = await bashTool.execute({ command: "node verify.cjs" }, { cwd: process.cwd(), sessionId: "signal-test", state: new Map() });
		assert.ok("isError" in result && result.isError);
		assert.ok(result.details && typeof result.details === "object" && "exitCode" in result.details);
		assert.equal(result.details.exitCode, null);
		assert.match(result.content.flatMap((part) => part.type === "text" ? [part.text] : []).join(""), /terminated without an exit code/);
	} finally { useSandbox(null); }
});

test("ordinary stop closes a real descendant listener without stopping a sibling session's service", { timeout: 30_000 }, async t => {
	const root = await mkdtemp(join(tmpdir(), "lyra-owned-services-"));
	const ownedState = new Map<string, unknown>(), siblingState = new Map<string, unknown>();
	const registries = [backgroundJobs(ownedState), backgroundJobs(siblingState)];
	const until = async (condition: () => boolean, label: string) => {
		const deadline = Date.now() + 10_000;
		while (!condition() && Date.now() < deadline) await delay(25);
		assert.ok(condition(), `${label}: ${JSON.stringify(registries.map(jobs => jobs.list()))}`);
	};
	t.after(async () => {
		for (const jobs of registries) jobs.dispose();
		await until(() => registries.every(jobs => jobs.list().every(job => job.finishedAt !== undefined)), "fixture processes did not exit");
		await rm(root, { recursive: true, force: true });
	});
	await writeFile(join(root, "server.cjs"), `const {createServer}=require('node:http');
const server=createServer((request,response)=>response.end(process.argv[2]));
server.listen(0,'127.0.0.1',()=>console.log('SERVICE_READY '+process.pid+' '+server.address().port));
`);
	await writeFile(join(root, "launcher.cjs"), "require('node:child_process').spawn(process.execPath,['server.cjs','owned'],{stdio:'inherit'});\n");
	// Written for the shell that will run it: Git Bash on a Windows that has Git, PowerShell otherwise.
	const executable = systemShell().kind === "powershell" ? `& '${process.execPath.replaceAll("'", "''")}'` : `'${process.execPath.replaceAll("'", "'\\''")}'`;
	await bashTool.execute({ command: `${executable} launcher.cjs`, run_in_background: true }, { cwd: root, sessionId: "owned", state: ownedState });
	await bashTool.execute({ command: `${executable} server.cjs sibling`, run_in_background: true }, { cwd: root, sessionId: "sibling", state: siblingState });
	const jobs = registries.map(registry => registry.list()[0]);
	await until(() => registries.every(registry => /SERVICE_READY \d+ \d+/.test(registry.list()[0]?.output ?? "")), "services did not listen");
	const endpoints = registries.map(registry => {
		const match = registry.list()[0].output.match(/SERVICE_READY (\d+) (\d+)/); assert.ok(match);
		return { pid: Number(match[1]), port: Number(match[2]) };
	});
	assert.notEqual(endpoints[0].pid, jobs[0].pid, "the listener must belong to a descendant rather than the shell");
	assert.equal(await (await fetch(`http://127.0.0.1:${endpoints[0].port}`)).text(), "owned");
	assert.equal(registries[1].stop(jobs[0].id), false, "another session cannot stop this process handle");
	assert.equal(registries[0].stop(jobs[0].id), true);
	await until(() => registries[0].get(jobs[0].id)?.finishedAt !== undefined, "ordinary stop did not close the process tree");
	await assert.rejects(new Promise<void>((resolve, reject) => {
		const socket = connect(endpoints[0].port, "127.0.0.1");
		socket.once("connect", () => { socket.destroy(); resolve(); });
		socket.once("error", reject);
	}), { code: "ECONNREFUSED" });
	assert.equal(await (await fetch(`http://127.0.0.1:${endpoints[1].port}`)).text(), "sibling");
	assert.equal(registries[1].get(jobs[1].id)?.finishedAt, undefined);
});
