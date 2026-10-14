/**
 * The guards around credentials that live outside the broker.
 *
 * - A credential card and a `mustAsk` permission are asked in full-access mode too, and an "always"
 *   answer to either is not remembered.
 * - Reading the vault's own files is a `mustAsk` read.
 * - A confined command cannot read those files at all — measured by building the path in `node`,
 *   which no pattern over the command's text can see, so what refuses it is the kernel.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ApprovalGate } from "../src/runtime/approvals.ts";
import { selectRunner } from "../src/sandbox/backend.ts";
import { bwrapArgs, canonicalPath, seatbeltArgs } from "../src/sandbox/policy.ts";
import { assessRead } from "../src/tools/read-access.ts";
import { bashTool } from "../src/tools/bash.ts";
import type { ApprovalRequest, ToolResult } from "../src/types.ts";

function gate(remembered: string[] = []) {
	const asked: string[] = [];
	const instance = new ApprovalGate(
		{ mode: () => "full", cwd: () => "/", ask: async (pending) => void asked.push(pending.id), remember: (subject) => void remembered.push(subject), questionTimeoutMs: 40, unattendedTimeoutMs: 5000 },
		[],
	);
	return { instance, asked, remembered };
}

const CARD: ApprovalRequest = { kind: "credential", title: "kzhy", detail: "", subject: "credential:kzhy-root", credential: { key: "k", name: "kzhy-root", kind: "password", fields: [] } };

test("凭据卡片：完全访问模式下照样出卡片，只认「已提交」和「拒绝」", async () => {
	const { instance, asked } = gate();
	const decision = instance.request(CARD);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(asked.length, 1, "full access does not answer a card");
	const [id] = asked;
	assert.equal(instance.resolve(id!, "always"), false);
	assert.equal(instance.resolve(id!, { answer: "x" }), false);
	assert.equal(instance.resolve(id!, "once"), true);
	assert.equal(await decision, "once");
});

test("凭据卡片按「问题」等，不按五分钟的授权：没人答就是拒绝", async () => {
	const { instance } = gate();
	assert.equal(await instance.request(CARD), "reject", "the question timeout (40ms here), not the 5s permission one");
});

test("mustAsk：完全访问模式下也问，「始终允许」只算这一次", async () => {
	const remembered: string[] = [];
	const { instance, asked } = gate(remembered);
	const read: ApprovalRequest = { kind: "read", title: "vault", detail: "/h/.lyra/vault.key", subject: "read:/h/.lyra/vault.key", mustAsk: true };
	const first = instance.request(read);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(asked.length, 1);
	instance.resolve(asked[0]!, "always");
	assert.equal(await first, "once");
	assert.deepEqual(remembered, [], "not written to the settings");

	const second = instance.request(read);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(asked.length, 2, "and not remembered in this process either");
	instance.resolve(asked[1]!, "reject");
	assert.equal(await second, "reject");
});

test("读保险库那两个文件是 mustAsk；别的密钥文件照旧按文件问", () => {
	const home = "/Users/k/.lyra-test";
	for (const file of ["vault.key", "credentials.json"]) {
		const verdict = assessRead(join(home, file), "/work", { lyraHomeDir: home });
		assert.deepEqual(verdict, { decision: "ask", reason: "读取 Lyra 的保险库", scope: "file", vault: true });
	}
	assert.equal((assessRead("/Users/k/.lyra/vault.key", "/work", { lyraHomeDir: home }) as { vault?: true }).vault, true, "the default spelling too");
	const key = assessRead("/Users/k/.ssh/id_ed25519", "/work", { lyraHomeDir: home });
	assert.equal(key.decision === "ask" && key.vault, undefined);
});

// Seatbelt and bwrap profiles are written for macOS and Linux only; on Windows the paths they would hold are not POSIX.
test("沙箱规则：两个文件禁读；禁网时只放行这条命令自己的 socket", { skip: process.platform === "win32" }, () => {
	const unreadable = [join(tmpdir(), "vault.key")];
	const sockets = [join(tmpdir(), "agent.sock")];
	const denied = seatbeltArgs({ mode: "workspace-write", workspaceRoot: tmpdir(), network: "deny", unreadable, sockets })[1]!;
	assert.ok(denied.includes(`(deny file-read* (literal "${canonicalPath(unreadable[0]!)}"))`));
	assert.ok(denied.includes(`(remote unix-socket (path-literal "${canonicalPath(sockets[0]!)}"))`));
	assert.ok(denied.indexOf("deny file-read*") > denied.indexOf("(allow default)"), "after every allow: the later rule wins");
	const open = seatbeltArgs({ mode: "workspace-write", workspaceRoot: tmpdir(), unreadable, sockets })[1]!;
	assert.equal(open.includes("unix-socket"), false, "nothing to let through when nothing is denied");
	const args = bwrapArgs({ mode: "workspace-write", workspaceRoot: tmpdir(), unreadable });
	const at = args.indexOf("/dev/null", args.indexOf("--ro-bind", 3));
	assert.equal(args[at + 1], canonicalPath(unreadable[0]!));
});

const runner = selectRunner();
const refuses = runner === "seatbelt" || runner === "bwrap" ? false : `the ${runner} backend cannot refuse one file`;

test("沙箱里的命令读不到保险库：node 拼出路径也读不到，同目录别的文件照常可读", { skip: refuses }, async () => {
	const home = await mkdtemp(join(tmpdir(), "ly-vault-home-"));
	const workspace = await mkdtemp(join(tmpdir(), "ly-vault-ws-"));
	process.env.LYRA_HOME = home;
	try {
		await writeFile(join(home, "vault.key"), "KEY-BYTES-7f3a");
		await writeFile(join(home, "credentials.json"), '{"CIPHER":"9c2e"}');
		await writeFile(join(home, "notes.txt"), "plain-notes-ok");
		const script = "const f=require('fs'),p=require('path'),h=process.argv[1];for(const n of ['vault'+'.key','credentials'+'.json','notes.txt']){try{console.log(n+'='+f.readFileSync(p.join(h,n),'utf8'))}catch(e){console.log(n+' refused '+e.code)}}";
		const result = (await bashTool.execute({ command: `node -e "${script}" "${home}"` }, { cwd: workspace, sessionId: "t", state: new Map(), sandboxMode: "workspace-write" })) as ToolResult;
		const output = result.content.map((block) => (block.type === "text" ? block.text : "")).join("");
		assert.equal(output.includes("KEY-BYTES-7f3a"), false, output);
		assert.equal(output.includes("9c2e"), false, output);
		assert.match(output, /notes\.txt=plain-notes-ok/, "the files beside them stay readable");
	} finally {
		delete process.env.LYRA_HOME;
		await rm(home, { recursive: true, force: true });
		await rm(workspace, { recursive: true, force: true });
	}
});
