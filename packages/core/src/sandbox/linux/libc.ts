/**
 * The few libc calls the Linux side needs and Node does not expose, through koffi.
 */

import { koffi } from "../native.ts";

export interface Libc {
	syscall: (...args: unknown[]) => number | bigint;
	open: (path: string, flags: number) => number;
	close: (fd: number) => number;
	prctl: (...args: unknown[]) => number;
	pipe2: (fds: Buffer, flags: number) => number;
	errno: () => number;
}

let cached: Libc | undefined;

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
		syscall: lib.func("long syscall(long number, ...)") as Libc["syscall"],
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
