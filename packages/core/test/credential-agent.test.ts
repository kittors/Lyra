/**
 * The agent Lyra lends keys through, spoken to the way OpenSSH speaks to it.
 *
 * The first test is the reason this agent exists instead of `ssh2`'s: a client that opens with an
 * extension message (`session-bind@openssh.com`, sent by every OpenSSH since 8.9) and then asks for
 * the keys. `ssh2`'s server left the extension's body unread, answered twice, and the client took the
 * second failure for the answer to "list your keys" — every login through it failed. Measured with a
 * real `ssh` against a throwaway `sshd` before this was written; pinned here without either.
 */

import assert from "node:assert/strict";
import { verify } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import ssh2 from "ssh2";
import type { ParsedKey } from "ssh2";
import { AgentFramer, RSA_SHA2_256, RSA_SHA2_512, sshString } from "../src/credentials/agent-protocol.ts";
import { socketPathIn } from "../src/credentials/askpass-server.ts";
import { agentSignature, readPrivateKey, serveAgent } from "../src/credentials/ssh-agent.ts";

function keyOf(type: "ed25519" | "rsa" | "ecdsa", passphrase?: string): { text: string; key: ParsedKey } {
	const options = type === "rsa" ? { bits: 2048 } : type === "ecdsa" ? { bits: 256 } : {};
	const pair = ssh2.utils.generateKeyPairSync(type as "ed25519", { ...options, ...(passphrase ? { passphrase, cipher: "aes256-ctr" } : {}) } as never);
	const read = readPrivateKey(pair.private, passphrase);
	assert.ok("key" in read, `${type} parses`);
	return { text: pair.private, key: read.key };
}

/** A signature blob in SSH's encoding, checked against the key's public half. */
function verifies(key: ParsedKey, data: Buffer, format: string, blob: Buffer): boolean {
	const pem = key.getPublicPEM();
	if (format === "ssh-ed25519") return verify(null, data, pem, blob);
	if (format.startsWith("rsa-sha2-")) return verify(format === "rsa-sha2-512" ? "sha512" : "sha256", data, pem, blob);
	// ECDSA: two mpints back to back, turned into the fixed-width r||s Node checks.
	const r = blob.subarray(4, 4 + blob.readUInt32BE(0));
	const sOffset = 4 + r.length;
	const s = blob.subarray(sOffset + 4, sOffset + 4 + blob.readUInt32BE(sOffset));
	const fixed = (n: Buffer) => Buffer.concat([Buffer.alloc(32), n.subarray(n[0] === 0 ? 1 : 0)]).subarray(-32);
	return verify("sha256", data, { key: pem, dsaEncoding: "ieee-p1363" }, Buffer.concat([fixed(r), fixed(s)]));
}

const frame = (type: number, ...parts: Buffer[]) => {
	const body = Buffer.concat([Buffer.from([type]), ...parts]);
	const head = Buffer.alloc(4);
	head.writeUInt32BE(body.length, 0);
	return Buffer.concat([head, body]);
};

test("扩展消息带着消息体先到，后面的「列出密钥」照样被认出来", () => {
	const framer = new AgentFramer();
	const sessionBind = frame(27, sshString("session-bind@openssh.com"), sshString(Buffer.alloc(51, 7)), sshString(Buffer.alloc(32, 1)), sshString(Buffer.alloc(83, 2)), Buffer.from([0]));
	const both = Buffer.concat([sessionBind, frame(11)]);
	// Arriving in awkward pieces, as a socket may deliver it.
	const requests = [...framer.push(both.subarray(0, 7)), ...framer.push(both.subarray(7, 150)), ...framer.push(both.subarray(150))];
	assert.deepEqual(requests, [{ type: "extension", name: "session-bind@openssh.com" }, { type: "identities" }]);
	assert.throws(() => new AgentFramer().push(Buffer.from([0x7f, 0xff, 0xff, 0xff, 11])), /agent message/);
});

test("ed25519、RSA（SHA-256/512）、ECDSA 的签名都能被公钥验证", () => {
	const data = Buffer.from("session data to sign");
	const ed = keyOf("ed25519");
	const edSig = agentSignature(ed.key, data, 0)!;
	assert.equal(edSig.format, "ssh-ed25519");
	assert.ok(verifies(ed.key, data, edSig.format, edSig.blob));

	const rsa = keyOf("rsa");
	for (const [flags, format] of [[RSA_SHA2_256, "rsa-sha2-256"], [RSA_SHA2_512, "rsa-sha2-512"]] as const) {
		const signed = agentSignature(rsa.key, data, flags)!;
		assert.equal(signed.format, format);
		assert.ok(verifies(rsa.key, data, signed.format, signed.blob), format);
	}

	const ec = keyOf("ecdsa");
	const ecSig = agentSignature(ec.key, data, 0)!;
	assert.equal(ecSig.format, "ecdsa-sha2-nistp256");
	assert.ok(verifies(ec.key, data, ecSig.format, ecSig.blob), "SSH's mpint encoding, not OpenSSL's DER");
});

test("贴进来的私钥有问题时说得出是哪种问题", () => {
	const locked = keyOf("ed25519", "pass-1");
	assert.deepEqual(readPrivateKey(locked.text), { problem: "needs-passphrase" });
	assert.deepEqual(readPrivateKey(locked.text, "wrong"), { problem: "wrong-passphrase" });
	assert.ok("key" in readPrivateKey(locked.text, "pass-1"));
	assert.deepEqual(readPrivateKey("hello"), { problem: "not-a-key" });
	const pub = ssh2.utils.generateKeyPairSync("ed25519").public;
	assert.deepEqual(readPrivateKey(pub), { problem: "public-key" });
});

test("在 socket 上按 OpenSSH 的顺序问：先 session-bind，再列密钥，再签名", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ly-agent-"));
	const lent = keyOf("ed25519");
	const signedWith: string[] = [];
	const path = socketPathIn(dir, "agent");
	const agent = await serveAgent(path, () => [{ key: lent.key, name: "deploy-key" }], (name) => signedWith.push(name));
	try {
		const socket = connect(path);
		let pending = Buffer.alloc(0);
		const next = () =>
			new Promise<Buffer>((resolve) => {
				const take = () => {
					if (pending.length >= 4 && pending.length >= 4 + pending.readUInt32BE(0)) {
						const length = pending.readUInt32BE(0);
						const body = pending.subarray(4, 4 + length);
						pending = pending.subarray(4 + length);
						resolve(body);
						return true;
					}
					return false;
				};
				if (take()) return;
				const onData = (chunk: Buffer) => {
					pending = Buffer.concat([pending, chunk]);
					if (take()) socket.off("data", onData);
				};
				socket.on("data", onData);
			});
		await new Promise<void>((resolve) => socket.once("connect", () => resolve()));

		socket.write(frame(27, sshString("session-bind@openssh.com"), sshString(Buffer.alloc(51, 7)), sshString(Buffer.alloc(32)), sshString(Buffer.alloc(83)), Buffer.from([0])));
		assert.equal((await next())[0], 5, "an extension is refused once");

		socket.write(frame(11));
		const list = await next();
		assert.equal(list[0], 12, "the identities answer, not a stray second failure");
		assert.equal(list.readUInt32BE(1), 1);

		const data = Buffer.from("to be signed");
		socket.write(frame(13, sshString(lent.key.getPublicSSH()), sshString(data), Buffer.from([0, 0, 0, 0])));
		const signed = await next();
		assert.equal(signed[0], 14);
		const signature = signed.subarray(5);
		const formatLength = signature.readUInt32BE(0);
		const format = signature.subarray(4, 4 + formatLength).toString();
		const blob = signature.subarray(8 + formatLength, 8 + formatLength + signature.readUInt32BE(4 + formatLength));
		assert.ok(verifies(lent.key, data, format, blob));
		assert.deepEqual(signedWith, ["deploy-key"]);
		socket.destroy();
	} finally {
		await agent.close();
		await rm(dir, { recursive: true, force: true });
	}
});

test("密钥被收回后，同一个 socket 立刻不再签名", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ly-agent-"));
	const lent = keyOf("ed25519");
	let held = true;
	const path = socketPathIn(dir, "agent");
	const agent = await serveAgent(path, () => (held ? [{ key: lent.key, name: "k" }] : []));
	try {
		const ask = (message: Buffer) =>
			new Promise<number>((resolve) => {
				const socket = connect(path, () => socket.write(message));
				socket.once("data", (chunk: Buffer) => {
					resolve(chunk[4]!);
					socket.destroy();
				});
			});
		const request = frame(13, sshString(lent.key.getPublicSSH()), sshString(Buffer.from("x")), Buffer.from([0, 0, 0, 0]));
		assert.equal(await ask(request), 14);
		held = false;
		assert.equal(await ask(request), 5);
	} finally {
		await agent.close();
		await rm(dir, { recursive: true, force: true });
	}
});
