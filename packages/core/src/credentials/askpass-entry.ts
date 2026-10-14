/**
 * The askpass helper: what ssh, sudo and git run when they need a password.
 *
 * Started as `<this runtime> askpass.js <socket> <prompt>` through the wrapper `askpass-server.ts`
 * writes, it asks the broker over the socket and prints what comes back. The value passes through
 * this process and its stdout pipe to the program that asked, and nowhere else — not an environment
 * variable, not an argument, not a file. `ps eww` reads any process's environment to a user's other
 * processes (measured), which is why the value is not simply exported to the command.
 *
 * `node:net` and nothing else: this starts once per prompt, and every module imported is time the
 * command spends waiting.
 */

import { connect } from "node:net";

const [socketPath, prompt = ""] = process.argv.slice(2);
if (!socketPath) process.exit(1);

/*
 * No answer is exit 1, which ssh, sudo and git all read as "cancelled". Set before anything can go
 * wrong, so a broken socket or a reply that is not JSON never looks like an empty password.
 */
process.exitCode = 1;
let reply = "";
const socket = connect(socketPath);
socket.setEncoding("utf8");
socket.on("connect", () => socket.write(`${JSON.stringify({ prompt })}\n`));
socket.on("data", (chunk: string) => {
	reply += chunk;
});
socket.on("end", () => {
	try {
		const parsed = JSON.parse(reply) as { answer?: unknown };
		if (typeof parsed.answer === "string") {
			process.stdout.write(`${parsed.answer}\n`);
			process.exitCode = 0;
		}
	} catch {
		// Not an answer; exit 1 stands.
	}
});
socket.on("error", () => {});
