// TEMPORARY diagnosis — see .github/workflows/diag-landlock.yml. One step of the Landlock runner at a time.
import { spawnSync } from "node:child_process";
import { koffi } from "../../packages/core/src/sandbox/native.ts";
import { libc } from "../../packages/core/src/sandbox/linux/libc.ts";
import { landlockAbi, landlockRules, writeRights } from "../../packages/core/src/sandbox/linux/landlock.ts";

const [variant, ws] = process.argv.slice(2);
const O_PATH = 0o10000000;
const O_CLOEXEC = 0o2000000;

if (variant !== "plain") {
	const api = libc();
	const abi = landlockAbi();
	if (variant === "ruleset" || variant === "restrict") {
		const attr = Buffer.alloc(8);
		attr.writeBigUInt64LE(writeRights(abi), 0);
		const ruleset = api.syscall(444, attr, 8, 0);
		if (ruleset < 0) process.exit(90);
		for (const rule of landlockRules({ workspace: ws, mode: "workspace-write" }, abi)) {
			const fd = api.open(rule.path, O_PATH | O_CLOEXEC);
			if (fd < 0) continue;
			const beneath = Buffer.alloc(12);
			beneath.writeBigUInt64LE(rule.rights, 0);
			beneath.writeInt32LE(fd, 8);
			if (api.syscall(445, ruleset, 1, beneath, 0) < 0) process.exit(91);
			api.close(fd);
		}
		if (api.prctl(38, "unsigned long", 1, "unsigned long", 0, "unsigned long", 0, "unsigned long", 0) !== 0) process.exit(92);
		if (variant === "restrict" && api.syscall(446, ruleset, 0) < 0) process.exit(93);
		api.close(ruleset);
	}
	if (variant === "restrict-fixed") {
		const lib = koffi().load("libc.so.6");
		const create = lib.func("syscall", "long", ["long", "void *", "size_t", "uint32_t"]);
		const add = lib.func("syscall", "long", ["long", "int", "int", "void *", "uint32_t"]);
		const restrict = lib.func("syscall", "long", ["long", "int", "uint32_t"]);
		const open = lib.func("open", "int", ["const char *", "int"]);
		const close = lib.func("close", "int", ["int"]);
		const prctl = lib.func("prctl", "int", ["int", "unsigned long", "unsigned long", "unsigned long", "unsigned long"]);
		const attr = Buffer.alloc(8);
		attr.writeBigUInt64LE(writeRights(abi), 0);
		const ruleset = Number(create(444, attr, 8, 0));
		if (ruleset < 0) process.exit(90);
		for (const rule of landlockRules({ workspace: ws, mode: "workspace-write" }, abi)) {
			const fd = open(rule.path, O_PATH | O_CLOEXEC);
			if (fd < 0) continue;
			const beneath = Buffer.alloc(12);
			beneath.writeBigUInt64LE(rule.rights, 0);
			beneath.writeInt32LE(fd, 8);
			if (Number(add(445, ruleset, 1, beneath, 0)) < 0) process.exit(91);
			close(fd);
		}
		if (prctl(38, 1, 0, 0, 0) !== 0) process.exit(92);
		if (Number(restrict(446, ruleset, 0)) < 0) process.exit(93);
		close(ruleset);
	}
}

const result = spawnSync("/bin/bash", ["-c", "echo hi > f.txt && cat f.txt"], { stdio: "inherit", cwd: ws });
if (result.signal) process.kill(process.pid, result.signal);
process.exit(result.status ?? 128);
