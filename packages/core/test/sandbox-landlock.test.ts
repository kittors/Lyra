/**
 * The Landlock backend, as a real Linux kernel enforces it.
 *
 * The rules are data and are tested as data on every platform. The rest can only be believed where
 * a kernel has actually applied them: a ruleset built correctly and never enforced looks identical
 * from every other angle — which is how the Windows runner went unnoticed for as long as it did,
 * tested through a probe hook that said yes on its behalf.
 *
 * Forced to Landlock rather than left to selection, because a host with a working `bwrap` would
 * pick that and never exercise this at all.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { confine, resetProbeCache } from "../src/sandbox/backend.ts";
import { deviceRights, landlockAbi, landlockRules, parseLandlockArgs, writeRights } from "../src/sandbox/linux/landlock.ts";
import type { SandboxMode, SandboxNetwork } from "../src/sandbox/policy.ts";

const abi = landlockAbi();
const skip = process.platform === "linux" && abi >= 2 ? false : `no usable Landlock here (platform ${process.platform}, ABI ${abi})`;

test("the rights handled follow the kernel's ABI exactly", () => {
	// Handling a right the kernel does not know is EINVAL; leaving out one it does know is a hole.
	const v2 = writeRights(2);
	const v3 = writeRights(3);
	assert.ok((v3 & ~v2) === 1n << 14n, "ABI 3 adds exactly TRUNCATE");
	assert.ok((v2 & (1n << 13n)) !== 0n, "ABI 2 includes REFER");
	assert.equal(writeRights(1) & (1n << 13n), 0n, "ABI 1 has no REFER to handle");
	// Device rules may only carry file rights, and only ones the ruleset handles.
	for (const version of [2, 3, 4, 5]) assert.equal(deviceRights(version) & ~writeRights(version), 0n);
});

test("read-only allows back only the devices; workspace-write adds the project and the temp areas", () => {
	const ro = landlockRules({ workspace: "/work/app", mode: "read-only" }, 4);
	assert.deepEqual(ro.map((rule) => rule.path), ["/dev"]);
	const rw = landlockRules({ workspace: tmpdir(), mode: "workspace-write" }, 4);
	assert.ok(rw.some((rule) => rule.path === "/dev"));
	assert.ok(rw.some((rule) => rule.rights === writeRights(4) && rule.path !== "/dev"), JSON.stringify(rw.map((r) => r.path)));
});

test("the argv contract refuses what it does not recognise", () => {
	assert.deepEqual(parseLandlockArgs(["--workspace", "/w", "--mode", "read-only", "--", "true"]).command, ["true"]);
	assert.equal(parseLandlockArgs(["--workspace", "/w", "--mode", "workspace-write", "--network", "deny", "--", "true"]).network, "deny");
	assert.throws(() => parseLandlockArgs(["--workspace", "/w", "--mode", "full", "--", "true"]), /--mode/);
	assert.throws(() => parseLandlockArgs(["--workspace", "--mode", "read-only", "--", "true"]), /缺少值/);
	assert.throws(() => parseLandlockArgs(["--workspace", "/w", "--mode", "read-only"]), /--/);
});

/** Run one command through the Landlock runner the way `LocalSandbox` would. */
function run(command: string, cwd: string, mode: SandboxMode, network: SandboxNetwork = "allow"): Promise<{ code: number | null; signal: NodeJS.Signals | null; out: string }> {
	const wrap = confine({ mode, workspaceRoot: cwd, network }, { runners: ["landlock"] });
	assert.ok(wrap, "a confined mode must be wrapped");
	assert.equal(wrap.runner, "landlock");
	return new Promise((resolve) => {
		const child = spawn(wrap.command, [...wrap.args, "/bin/bash", "-c", command], {
			cwd,
			env: { ...process.env, ...wrap.env },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let out = "";
		child.stdout.on("data", (chunk) => { out += chunk; });
		child.stderr.on("data", (chunk) => { out += chunk; });
		child.on("close", (code, signal) => resolve({ code, signal, out }));
	});
}

test("workspace-write: the project and the temp areas are writable, nothing else is", { skip }, async (t) => {
	resetProbeCache();
	const ws = await mkdtemp(join(tmpdir(), "lyra-ll-ws-"));
	const outside = join(homedir(), `.lyra-landlock-probe-${process.pid}`);
	t.after(async () => {
		await rm(ws, { recursive: true, force: true });
		await rm(outside, { force: true });
	});

	let r = await run("echo hi > inside.txt && cat inside.txt", ws, "workspace-write");
	assert.equal(r.out.trim(), "hi", r.out);

	r = await run(`echo x > '${outside}'`, ws, "workspace-write");
	assert.notEqual(r.code, 0, r.out);
	assert.equal(existsSync(outside), false, "the file must not exist — this is the whole point");

	r = await run("cat > note.txt <<'EOF'\nheredoc line\nEOF\ncat note.txt", ws, "workspace-write");
	assert.match(r.out, /heredoc line/);

	r = await run('f=$(mktemp) && echo t > "$f" && cat "$f" && rm "$f"', ws, "workspace-write");
	assert.equal(r.out.trim(), "t", r.out);

	// ABI 2's REFER: moving a file between directories inside the grant.
	r = await run("mkdir -p a/b && echo m > a/b/f && mv a/b/f a/g && cat a/g", ws, "workspace-write");
	assert.equal(r.out.trim(), "m", r.out);
});

test("read-only: the project is not writable, the devices a shell needs are", { skip }, async (t) => {
	const ws = await mkdtemp(join(tmpdir(), "lyra-ll-ro-"));
	t.after(() => rm(ws, { recursive: true, force: true }));

	let r = await run("echo x > ro.txt", ws, "read-only");
	assert.notEqual(r.code, 0, r.out);
	assert.equal(existsSync(join(ws, "ro.txt")), false);

	r = await run("echo quiet > /dev/null && head -c 4 /bin/sh > /dev/null && echo ok", ws, "read-only");
	assert.equal(r.out.trim(), "ok", r.out);
});

test("the command's status and death are the runner's", { skip }, async (t) => {
	const ws = await mkdtemp(join(tmpdir(), "lyra-ll-st-"));
	t.after(() => rm(ws, { recursive: true, force: true }));

	assert.equal((await run("exit 3", ws, "workspace-write")).code, 3);
	const killed = await run("kill -TERM $$", ws, "workspace-write");
	assert.equal(killed.signal, "SIGTERM", JSON.stringify(killed));
	// How the runner was started is not something the command inherits.
	assert.equal((await run('printf %s "$ELECTRON_RUN_AS_NODE"', ws, "workspace-write")).out, "");
});

test("a denied network refuses TCP", { skip: skip || (abi < 4 ? `Landlock ABI ${abi} cannot deny the network` : false) }, async (t) => {
	const ws = await mkdtemp(join(tmpdir(), "lyra-ll-net-"));
	t.after(() => rm(ws, { recursive: true, force: true }));

	// A non-routable address: unconfined, the connection would hang, so a hang is its own verdict.
	const script =
		"setTimeout(() => { console.log('hung'); process.exit(2); }, 3000); " +
		"require('net').connect(9, '192.0.2.1').on('connect', () => console.log('connected')).on('error', (e) => { console.log('refused', e.code); process.exit(1); })";
	const r = await run(`'${process.execPath}' -e "${script}"`, ws, "workspace-write", "deny");
	assert.match(r.out, /refused EACCES/, r.out);
});

/*
 * Asking the kernel anything through `syscall` from a fresh process — the way every confined
 * command's runner starts — many times over.
 *
 * On x86_64 this killed about one process in eighteen with SIGSEGV: glibc's `syscall` reads its
 * sixth argument from the stack whether or not there is one, and koffi's own call stack ends right
 * there (see `syscallThrough`). Whether it crashed depended on what the kernel had mapped next to
 * that stack, so a single run proves nothing; eighty in a row surviving by luck is under one in a
 * hundred. Linux only, and on any architecture: aarch64 never crashed, and must not start to.
 */
test("the Landlock version query never takes the process down", { skip: process.platform === "linux" ? false : "Linux only" }, async () => {
	const landlockModule = new URL("../src/sandbox/linux/landlock.ts", import.meta.url).href;
	const script = `import(${JSON.stringify(landlockModule)}).then((m) => console.log(m.landlockAbi()))`;
	const endings: string[] = [];
	let started = 0;
	const lane = async () => {
		while (started < 80) {
			started++;
			endings.push(
				await new Promise<string>((resolve) => {
					const child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "-e", script], { stdio: "ignore" });
					child.on("close", (code, signal) => resolve(signal ?? `exit ${code}`));
				}),
			);
		}
	};
	await Promise.all(Array.from({ length: 8 }, lane));
	assert.deepEqual([...new Set(endings)], ["exit 0"], JSON.stringify(endings.filter((ending) => ending !== "exit 0")));
});
