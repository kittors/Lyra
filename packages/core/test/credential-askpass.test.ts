/**
 * The askpass helper: which prompt gets which value, and the helper itself run the way ssh runs it.
 *
 * The rules matter more than the plumbing. A wrong answer is a password sent to a server that was
 * never meant to see it, so every rule that refuses is pinned here: a confirmation, a destination no
 * credential is bound to, a prompt with no destination when only bound credentials are declared, and
 * two credentials that fit equally.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { type AskpassSecret, chooseAnswer, refusalNote } from "../src/credentials/askpass-answer.ts";
import { serveAskpass } from "../src/credentials/askpass-server.ts";

const kzhy: AskpassSecret = { name: "kzhy-root", kind: "password", target: "ssh://root@100.64.0.5", secret: "kzhy-pw" };
const nas: AskpassSecret = { name: "nas", kind: "password", target: "ssh://admin@nas.lan", secret: "nas-pw" };
const sudo: AskpassSecret = { name: "local-sudo", kind: "password", secret: "sudo-pw" };
const github: AskpassSecret = { name: "gh", kind: "login", target: "https://github.com", username: "kittors", secret: "gh-token" };

test("ssh 的两种密码提示都按目的地回答", () => {
	assert.deepEqual(chooseAnswer("root@100.64.0.5's password: ", [kzhy, nas]), { answer: "kzhy-pw", name: "kzhy-root" });
	assert.deepEqual(chooseAnswer("(root@100.64.0.5) Password: ", [kzhy, nas]), { answer: "kzhy-pw", name: "kzhy-root" });
	assert.deepEqual(chooseAnswer("admin@nas.lan's password: ", [kzhy, nas]), { answer: "nas-pw", name: "nas" });
});

test("绑在别处的密码不会交给这台主机", () => {
	assert.deepEqual(chooseAnswer("root@evil.example's password: ", [kzhy]), { refused: "no-match" });
	assert.deepEqual(chooseAnswer("admin@100.64.0.5's password: ", [kzhy]), { refused: "no-match" }, "same host, another user");
});

test("没写目的地的提示只认没绑定的凭据：给某台服务器的密码不是你的 sudo 密码", () => {
	assert.deepEqual(chooseAnswer("[sudo] password for kittors: ", [kzhy]), { refused: "no-match" });
	assert.deepEqual(chooseAnswer("[sudo] password for kittors: ", [kzhy, sudo]), { answer: "sudo-pw", name: "local-sudo" });
	assert.deepEqual(chooseAnswer("Password:", [sudo]), { answer: "sudo-pw", name: "local-sudo" });
	assert.deepEqual(chooseAnswer("Enter passphrase for key '/Users/k/.ssh/id_ed25519': ", [sudo]), { answer: "sudo-pw", name: "local-sudo" });
});

test("没绑定的凭据可以回答有目的地的提示，但绑在那里的优先", () => {
	assert.deepEqual(chooseAnswer("root@any.host's password: ", [sudo]), { answer: "sudo-pw", name: "local-sudo" });
	assert.deepEqual(chooseAnswer("root@100.64.0.5's password: ", [sudo, kzhy]), { answer: "kzhy-pw", name: "kzhy-root" });
});

test("确认一律不答：首次连接的主机指纹不是拿密码回答的", () => {
	const prompt = "The authenticity of host '[127.0.0.1]:2222' can't be established.\nAre you sure you want to continue connecting (yes/no/[fingerprint])?";
	assert.deepEqual(chooseAnswer(prompt, [kzhy, sudo]), { refused: "confirmation" });
	assert.deepEqual(chooseAnswer("Allow use of key /k/id?\nKey fingerprint SHA256:x", [sudo]), { refused: "confirmation" });
});

test("两个都合适时拒绝，不猜", () => {
	const another = { ...sudo, name: "other-sudo", secret: "other" };
	assert.deepEqual(chooseAnswer("Password:", [sudo, another]), { refused: "ambiguous" });
});

test("git 先问用户名再问密码，按 URL 认主机", () => {
	assert.deepEqual(chooseAnswer("Username for 'https://github.com': ", [github]), { answer: "kittors", name: "gh" });
	assert.deepEqual(chooseAnswer("Password for 'https://kittors@github.com': ", [github]), { answer: "gh-token", name: "gh" });
	const token: AskpassSecret = { name: "gh-token", kind: "token", target: "https://github.com", secret: "t" };
	assert.deepEqual(chooseAnswer("Username for 'https://github.com': ", [token]), { refused: "no-username" });
	assert.match(refusalNote("Username for 'https://github.com': ", "no-username"), /login credential|remote URL/);
});

test("认不出的提示不答", () => {
	assert.deepEqual(chooseAnswer("Enter the code we sent you:", [sudo]), { refused: "unknown-prompt" });
	assert.match(refusalNote("x", "confirmation"), /StrictHostKeyChecking=accept-new/);
});

const run = promisify(execFile);

/*
 * The wrapper is a `.cmd` on Windows, and how CreateProcess hands one to cmd.exe has not been
 * observed there yet — so this runs where the wrapper is a shell script, which is what ssh, sudo and
 * git were measured against.
 */
test("像 ssh 那样运行这个小程序：问 socket、打印答案；不答时以 1 退出", { skip: process.platform === "win32" }, async () => {
	const dir = await mkdtemp(join(tmpdir(), "ly-askpass-"));
	const asked: string[] = [];
	const server = await serveAskpass(dir, (prompt) => {
		asked.push(prompt);
		return prompt.includes("password") ? "s3cret value" : null;
	});
	try {
		assert.equal(server.env.SSH_ASKPASS_REQUIRE, "force");
		assert.equal(server.env.SSH_ASKPASS, server.env.SUDO_ASKPASS);
		assert.equal((await stat(server.env.SSH_ASKPASS!)).mode & 0o777, 0o700, "the wrapper is the user's alone");

		const answered = await run(server.env.SSH_ASKPASS!, ["root@h's password: "]);
		assert.equal(answered.stdout, "s3cret value\n");

		await assert.rejects(run(server.env.SSH_ASKPASS!, ["Are you sure (yes/no)?"]), (error: { code?: number; stdout?: string }) => error.code === 1 && error.stdout === "");
		assert.deepEqual(asked, ["root@h's password: ", "Are you sure (yes/no)?"]);
		assert.equal(Object.values(server.env).some((value) => value.includes("s3cret")), false, "the value is not in the environment");
	} finally {
		await server.close();
		await rm(dir, { recursive: true, force: true });
	}
});
