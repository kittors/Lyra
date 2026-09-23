/**
 * The few libc calls the Linux side needs and Node does not expose, through koffi.
 */

import { koffi } from "../native.ts";

/** One argument to a system call: a number, or a buffer (or null) passed as a pointer. */
export type SyscallArg = number | Buffer | null;

export interface Libc {
	/** `syscall(2)` with its six argument slots always filled — see `syscallThrough`. */
	syscall: (number: number, ...args: SyscallArg[]) => number;
	open: (path: string, flags: number) => number;
	close: (fd: number) => number;
	prctl: (...args: unknown[]) => number;
	pipe2: (fds: Buffer, flags: number) => number;
	errno: () => number;
}

let cached: Libc | undefined;

/**
 * `syscall(2)`, declared with all six argument slots and called with all six.
 *
 * glibc's x86_64 `syscall` is a few lines of assembly that load the sixth argument from the stack,
 * `8(%rsp)`, whether the caller passed one or not. Under a C compiler that is harmless — the slot
 * is the caller's own frame. Under koffi it is not: koffi runs each foreign call on a stack of its
 * own, and a call with no stack arguments puts the return address in the top eight bytes of it, so
 * that slot is the first byte past the end of the mapping. Whether anything is mapped there is
 * down to where the kernel happened to place it — so asking the kernel for its Landlock version
 * killed the process with SIGSEGV on some runs and not others, only on x86_64 (aarch64's `syscall`
 * reads nothing from the stack), and every confined command died with it: `(no output)`,
 * `[terminated by SIGSEGV]`.
 *
 * Six arguments after the number are seven in all, and the seventh goes on koffi's stack — so the
 * slot the assembly reads is one that was allocated and written. Each shape of argument list —
 * which slots are pointers — is declared once, on first use.
 */
function syscallThrough(lib: ReturnType<ReturnType<typeof koffi>["load"]>): Libc["syscall"] {
	const shapes = new Map<string, (...args: SyscallArg[]) => number | bigint>();
	return (number, ...args) => {
		if (args.length > 6) throw new Error(`syscall 最多六个参数，收到 ${args.length} 个`);
		const filled: SyscallArg[] = [...args, ...Array<number>(6 - args.length).fill(0)];
		const params = filled.map((arg) => (arg === null || Buffer.isBuffer(arg) ? "void *" : "long"));
		const key = params.join(",");
		let call = shapes.get(key);
		if (!call) {
			call = lib.func("syscall", "long", ["long", ...params]) as (...args: SyscallArg[]) => number | bigint;
			shapes.set(key, call);
		}
		return Number(call(number, ...filled));
	};
}

/** libc by its soname — glibc's, then musl's. Throws when neither loads. */
export function libc(): Libc {
	if (cached) return cached;
	const ffi = koffi();
	let lib: ReturnType<typeof ffi.load> | undefined;
	for (const name of ["libc.so.6", `libc.musl-${process.arch === "arm64" ? "aarch64" : "x86_64"}.so.1`]) {
		try {
			lib = ffi.load(name);
			break;
		} catch {
			// The other libc, then.
		}
	}
	if (!lib) throw new Error("找不到 libc");
	cached = {
		syscall: syscallThrough(lib),
		open: lib.func("int open(const char *path, int flags, ...)") as Libc["open"],
		close: lib.func("int close(int fd)") as Libc["close"],
		prctl: lib.func("int prctl(int option, ...)") as Libc["prctl"],
		pipe2: lib.func("int pipe2(void *fds, int flags)") as Libc["pipe2"],
		errno: () => ffi.errno(),
	};
	return cached;
}

const O_CLOEXEC = 0o2000000;

/**
 * An ordinary pipe — read end and write end — or `undefined` where one cannot be had.
 *
 * Why a command's output needs one on Linux: Node gives a child's stdio a *socketpair*, and Linux
 * will not `open()` a socket through `/proc/self/fd`. So `echo x > /dev/stderr` — in countless
 * scripts, and in the error paths of more — failed with `No such device or address`, sandbox or
 * no sandbox, while macOS (whose `/dev/fd` duplicates rather than reopens) never showed it.
 * A real pipe opens fine. Close-on-exec, so no other child inherits it by accident; the one it is
 * meant for gets it through `spawn`'s `stdio`, which `dup2`s it into place.
 */
export function osPipe(): { read: number; write: number } | undefined {
	if (process.platform !== "linux") return undefined;
	try {
		const api = libc();
		const fds = Buffer.alloc(8);
		if (api.pipe2(fds, O_CLOEXEC) !== 0) return undefined;
		return { read: fds.readInt32LE(0), write: fds.readInt32LE(4) };
	} catch {
		return undefined;
	}
}
