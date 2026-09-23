/**
 * Starting and stopping stdio MCP servers.
 *
 * Every test here runs a real server process — a few lines of Node that speak just enough JSON-RPC
 * to be connected to — because the two things being pinned down are properties of processes, not of
 * objects: which environment the server was started with, and whether it is still running after
 * Lyra has stopped talking to it. A mocked transport can say "closed" while the process it stands
 * for keeps running, which is exactly the bug.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test, type TestContext } from "node:test";

import { McpManager, type McpStdioServer } from "../src/mcp/client.ts";
import { forgetCommandPath, primeCommandPath } from "../src/sandbox/login-path.ts";

/**
 * A stdio MCP server that records what it was started with.
 *
 * It writes its pid into `FAKE_MCP_DIR` on start so a test can ask the OS whether it is still
 * alive, and its environment when `FAKE_MCP_DUMP_ENV` is set. `FAKE_MCP_INIT_DELAY` holds back the
 * answer to `initialize`; `FAKE_MCP_FAIL_LIST` makes `tools/list` an error.
 */
const SERVER = `
const fs = require("node:fs");
const path = require("node:path");
const dir = process.env.FAKE_MCP_DIR;
fs.writeFileSync(path.join(dir, process.pid + ".pid"), "");
if (process.env.FAKE_MCP_DUMP_ENV) fs.writeFileSync(path.join(dir, process.pid + ".env.json"), JSON.stringify(process.env));
const delay = Number(process.env.FAKE_MCP_INIT_DELAY || 0);
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
	buffer += chunk;
	let end;
	while ((end = buffer.indexOf("\\n")) !== -1) {
		const line = buffer.slice(0, end);
		buffer = buffer.slice(end + 1);
		if (!line.trim()) continue;
		const message = JSON.parse(line);
		if (message.id === undefined) continue;
		if (message.method === "initialize") {
			const result = { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fake", version: "0" } };
			setTimeout(() => send({ id: message.id, result }), delay);
		} else if (message.method === "tools/list") {
			if (process.env.FAKE_MCP_FAIL_LIST) send({ id: message.id, error: { code: -32603, message: "tools/list is broken" } });
			else send({ id: message.id, result: { tools: [{ name: "echo", description: "Echo.", inputSchema: { type: "object" } }] } });
		} else {
			send({ id: message.id, error: { code: -32601, message: "no such method" } });
		}
	}
});
process.stdin.on("end", () => process.exit(0));
`;

interface Fixture {
	dir: string;
	server(env?: Record<string, string>, id?: string): McpStdioServer;
	/** Pids of every server started so far, whether or not it is still running. */
	started(): Promise<number[]>;
	env(pid: number): Promise<Record<string, string>>;
}

async function fixture(t: TestContext): Promise<Fixture> {
	const dir = await mkdtemp(join(tmpdir(), "lyra-mcp-"));
	const script = join(dir, "server.cjs");
	await writeFile(script, SERVER);
	const started = async () => {
		const { readdir } = await import("node:fs/promises");
		return (await readdir(dir)).filter((name) => name.endsWith(".pid")).map((name) => Number(name.slice(0, -4)));
	};
	t.after(async () => {
		// Whatever a failing test left running, so one red test does not leave processes behind.
		for (const pid of await started()) if (alive(pid)) process.kill(pid, "SIGKILL");
		await rm(dir, { recursive: true, force: true });
	});
	return {
		dir,
		server: (env = {}, id = "fake") => ({
			id,
			name: id,
			transport: "stdio",
			command: process.execPath,
			args: [script],
			env: { FAKE_MCP_DIR: dir, ...env },
			enabled: true,
		}),
		started,
		env: async (pid) => JSON.parse(await readFile(join(dir, `${pid}.env.json`), "utf8")) as Record<string, string>,
	};
}

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

const dirs = (path: string | undefined) => (path ?? "").split(delimiter).filter(Boolean);

/** Exactly what launchd hands a double-clicked app on macOS. */
const GUI = "/usr/bin:/bin:/usr/sbin:/sbin";

test("a stdio server launched from an icon gets the repaired PATH, not launchd's four directories", { skip: process.platform === "win32" ? "POSIX-only: Windows reads PATH from the registry" : false }, async (t) => {
	const fx = await fixture(t);
	const real = process.env.PATH;
	process.env.PATH = GUI;
	forgetCommandPath();
	const manager = new McpManager();
	try {
		await manager.connect(fx.server({ FAKE_MCP_DUMP_ENV: "1" }));
		const [pid] = await fx.started();
		const path = dirs((await fx.env(pid)).PATH);
		/*
		 * `npx -y @scope/server` is how most MCP servers are configured, and from an icon `npx` is
		 * not in /usr/bin — it is wherever nvm, fnm or volta put it. The server command has to be
		 * resolved against the same PATH the agent's own commands get.
		 */
		assert.ok(path.length > dirs(GUI).length, `the server was started with launchd's PATH: ${path.join(delimiter)}`);
		for (const dir of dirs(GUI)) assert.ok(path.includes(dir), `${dir} was dropped`);
	} finally {
		await manager.closeAll();
		// The ask the repair started must not land in a later test's environment.
		await primeCommandPath();
		process.env.PATH = real;
		forgetCommandPath();
	}
});

test("a server's own env still wins over the inherited environment", async (t) => {
	const fx = await fixture(t);
	const manager = new McpManager();
	try {
		await manager.connect(fx.server({ FAKE_MCP_DUMP_ENV: "1", HOME: "/configured/home" }));
		const [pid] = await fx.started();
		assert.equal((await fx.env(pid)).HOME, "/configured/home");
	} finally {
		await manager.closeAll();
	}
});

/** Run the rest of the test as if on Windows, restoring the real platform however it ends. */
function asWindows(t: TestContext): void {
	const platform = Object.getOwnPropertyDescriptor(process, "platform");
	assert.ok(platform);
	Object.defineProperty(process, "platform", { ...platform, value: "win32" });
	t.after(() => Object.defineProperty(process, "platform", platform));
}

test("on Windows a server's own Path replaces the inherited PATH instead of sitting beside it", async (t) => {
	const fx = await fixture(t);
	asWindows(t);
	const manager = new McpManager();
	try {
		/*
		 * `{ ...process.env }` on Windows spells it `Path`, the SDK adds its own `PATH` underneath,
		 * and a child handed both reads whichever Node sorts first. The one the user configured has
		 * to be the only one.
		 */
		await manager.connect(fx.server({ FAKE_MCP_DUMP_ENV: "1", Path: "C:\\configured" }));
		const [pid] = await fx.started();
		const env = await fx.env(pid);
		const spellings = Object.keys(env).filter((key) => key.toUpperCase() === "PATH");
		assert.deepEqual(spellings, ["PATH"], `the child saw ${spellings.join(", ")}`);
		assert.equal(env.PATH, "C:\\configured");
	} finally {
		await manager.closeAll();
	}
});
