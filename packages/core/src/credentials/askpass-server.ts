/**
 * The broker's end of the askpass helper: a socket for one command, and the script ssh is pointed at.
 *
 * One per command rather than one per app, so the socket exists exactly as long as the command that
 * was granted it. Any process of the same user can reach a socket it knows the path of — the 0700
 * directory keeps other users out, not this one's other programs — and a socket that is gone cannot
 * be asked anything.
 */

import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let entry: string | undefined;

/**
 * Where the helper's script is. The desktop build emits it as `askpass.js` beside the main bundle,
 * as it does the sandbox runner, and says so at startup; the CLI and the tests run the TypeScript
 * file beside this one.
 */
export function useAskpassEntry(path: string | undefined): void {
	entry = path;
}

function helperArgv(): string[] {
	const script = entry ?? join(dirname(fileURLToPath(import.meta.url)), "askpass-entry.ts");
	return [process.execPath, ...(script.endsWith(".ts") ? ["--experimental-strip-types", "--no-warnings"] : []), script];
}

const posixQuote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;

/**
 * The wrapper ssh, sudo and git are pointed at. `SSH_ASKPASS` names a program and passes it the
 * prompt and nothing else, so the runtime, the script and the socket have to be baked in here.
 *
 * `ELECTRON_RUN_AS_NODE` is set inside the wrapper and not in the command's environment: there it
 * would turn any Electron app the command starts — `code`, say — into a bare Node process.
 */
function wrapperFor(socketPath: string, dir: string): { path: string; text: string } {
	const argv = helperArgv();
	if (process.platform === "win32") {
		// Not yet measured on Windows: how CreateProcess hands a `.cmd` to cmd.exe is assumed, not observed.
		const line = [...argv, socketPath].map((part) => `"${part}"`).join(" ");
		return { path: join(dir, "askpass.cmd"), text: `@echo off\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n${line} %1\r\n` };
	}
	return { path: join(dir, "askpass"), text: `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${[...argv, socketPath].map(posixQuote).join(" ")} "$1"\n` };
}

export function socketPathIn(dir: string, name: string): string {
	// A Windows pipe has no file; its name only has to be unguessable and unique.
	return process.platform === "win32" ? `\\\\.\\pipe\\lyra-${name}-${randomBytes(12).toString("hex")}` : join(dir, `${name}.sock`);
}

export interface AskpassServer {
	/** What the command's environment needs for ssh, sudo and git to ask here. */
	env: Record<string, string>;
	/** The socket, for a sandbox that has to be told to let the command reach it. */
	socket: string;
	close(): Promise<void>;
}

/** Longest prompt read; anything past it is not a prompt. */
const MAX_PROMPT = 4096;

export async function serveAskpass(dir: string, answer: (prompt: string) => string | null): Promise<AskpassServer> {
	const socketPath = socketPathIn(dir, "askpass");
	const sockets = new Set<Socket>();
	const server: Server = createServer((socket) => {
		sockets.add(socket);
		let buffer = "";
		socket.setEncoding("utf8");
		socket.on("data", (chunk: string) => {
			buffer += chunk;
			const newline = buffer.indexOf("\n");
			if (newline === -1) {
				if (buffer.length > MAX_PROMPT) socket.destroy();
				return;
			}
			let prompt = "";
			try {
				const parsed = JSON.parse(buffer.slice(0, newline)) as { prompt?: unknown };
				prompt = typeof parsed.prompt === "string" ? parsed.prompt : "";
			} catch {
				// Unreadable is the same as an unknown prompt: no answer.
			}
			const reply = answer(prompt);
			socket.end(`${JSON.stringify(reply === null ? {} : { answer: reply })}\n`);
		});
		socket.on("error", () => {});
		socket.on("close", () => sockets.delete(socket));
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(socketPath, () => {
			server.off("error", reject);
			resolve();
		});
	});
	const wrapper = wrapperFor(socketPath, dir);
	await writeFile(wrapper.path, wrapper.text, { mode: 0o700 });
	return {
		env: {
			SSH_ASKPASS: wrapper.path,
			// `force`: ask here even with no `DISPLAY`. OpenSSH 8.4 and later; Windows 10's own ssh is 8.1.
			SSH_ASKPASS_REQUIRE: "force",
			SUDO_ASKPASS: wrapper.path,
			GIT_ASKPASS: wrapper.path,
		},
		socket: socketPath,
		close: async () => {
			for (const socket of sockets) socket.destroy();
			await new Promise<void>((done) => server.close(() => done()));
		},
	};
}
