// TEMPORARY diagnosis — see .github/workflows/diag-landlock.yml. Which koffi call shape kills the process on x86_64?
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const core = join(dirname(fileURLToPath(import.meta.url)), "../../packages/core/package.json");
const cases = {
	"load-only": `lib;`,
	"declare-variadic": `lib.func("long syscall(long number, ...)");`,
	"variadic-no-varargs": `lib.func("long syscall(long number, ...)")(39);`,
	"variadic-void*-size_t-uint32": `lib.func("long syscall(long number, ...)")(444, "void *", null, "size_t", 0, "uint32_t", 1);`,
	"variadic-long-long-long": `lib.func("long syscall(long number, ...)")(444, "long", 0, "long", 0, "long", 1);`,
	"fixed-void*-size_t-uint32": `lib.func("syscall", "long", ["long", "void *", "size_t", "uint32_t"])(444, null, 0, 1);`,
	"fixed-long-long-long": `lib.func("syscall", "long", ["long", "long", "long", "long"])(444, 0, 0, 1);`,
	"fixed-getpid": `lib.func("int getpid()")();`,
	"variadic-prctl": `lib.func("int prctl(int option, ...)")(38, "unsigned long", 1, "unsigned long", 0, "unsigned long", 0, "unsigned long", 0);`,
	"fixed-prctl": `lib.func("prctl", "int", ["int", "unsigned long", "unsigned long", "unsigned long", "unsigned long"])(38, 1, 0, 0, 0);`,
	"variadic-open-2args": `lib.func("int open(const char *path, int flags, ...)")("/dev/null", 0);`,
	"fixed-open": `lib.func("open", "int", ["const char *", "int"])("/dev/null", 0);`,
};

const require = createRequire(core);
const koffiPath = require.resolve("koffi");
console.log("node", process.version, "koffi", require("koffi").version ?? "?", process.arch);

for (const [name, body] of Object.entries(cases)) {
	const script = `const koffi = require(${JSON.stringify(koffiPath)}); const lib = koffi.load("libc.so.6"); const r = (() => { return ${body} })(); console.log(String(r));`;
	const tally = {};
	let sample = "";
	for (let i = 0; i < 30; i++) {
		const run = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
		const key = run.signal ?? `exit ${run.status}`;
		tally[key] = (tally[key] ?? 0) + 1;
		if (!sample) sample = (run.stdout + run.stderr).trim().slice(0, 160);
	}
	console.log(`${name.padEnd(32)} ${JSON.stringify(tally)}  ${JSON.stringify(sample)}`);
}
