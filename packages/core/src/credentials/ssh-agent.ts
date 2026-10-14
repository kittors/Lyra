/**
 * An SSH agent that lends a conversation's keys to the one command that asked for them.
 *
 * Why not the system's agent:
 *
 * - On Windows it is a service on one hard-coded pipe that refuses lifetimes and confirmation, and
 *   it writes every key it is given into the registry under DPAPI, where it survives a reboot. A key
 *   typed into a card for one conversation must not outlive that conversation.
 * - On macOS and Linux a private `ssh-agent -D -a` works (measured), but that is a second
 *   implementation behaving differently from the first. One agent here behaves the same on all three.
 *
 * The private key never leaves this process. The protocol has no request that returns a key, so a
 * command holding the socket can have things signed — the capability it was granted — and cannot
 * take the key away with it.
 */

import { sign as cryptoSign } from "node:crypto";
import { unlink } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import ssh2 from "ssh2";
import type { ParsedKey } from "ssh2";
import { AgentFramer, RSA_SHA2_256, RSA_SHA2_512, failureReply, identitiesReply, signReply, sshMpint } from "./agent-protocol.ts";

/** Why a pasted key cannot be used, in terms the card can turn into a sentence. */
export type KeyProblem = "not-a-key" | "needs-passphrase" | "wrong-passphrase" | "public-key";

export function readPrivateKey(text: string, passphrase?: string): { key: ParsedKey } | { problem: KeyProblem } {
	const parsed = ssh2.utils.parseKey(Buffer.from(text.trim(), "utf8"), passphrase ? passphrase : undefined);
	if (parsed instanceof Error) {
		/*
		 * The two passphrase failures are told apart by ssh2's own words, because they ask for
		 * different things: one wants a passphrase field, the other wants a different value in it.
		 */
		if (/no passphrase given/i.test(parsed.message)) return { problem: "needs-passphrase" };
		if (/passphrase/i.test(parsed.message)) return { problem: passphrase ? "wrong-passphrase" : "needs-passphrase" };
		return { problem: "not-a-key" };
	}
	// A file holding several keys parses to a list; only a single private key is meaningful here.
	const key = Array.isArray(parsed) ? (parsed as ParsedKey[]).find((one) => one.isPrivateKey()) : parsed;
	if (!key) return { problem: "not-a-key" };
	if (!key.isPrivateKey()) return { problem: "public-key" };
	return { key };
}

/** ECDSA's hash follows its curve; SSH names the signature after the key. */
const ECDSA_HASH: Record<string, string> = {
	"ecdsa-sha2-nistp256": "sha256",
	"ecdsa-sha2-nistp384": "sha384",
	"ecdsa-sha2-nistp521": "sha512",
};

/** A key's public half as one `authorized_keys` line: what a key is copied for, to a server or a code host. */
export function publicKeyLine(key: ParsedKey, comment: string): string {
	return `${key.type} ${key.getPublicSSH().toString("base64")} ${key.comment || comment}`;
}

/**
 * Signs the way an agent answers: the signature format's name, and the blob in that format.
 *
 * Done with `node:crypto` over the key's PEM rather than with `ParsedKey.sign`, because the blob
 * has to be SSH's encoding and that method returns OpenSSL's: for ECDSA that is DER, where SSH
 * wants the two integers as `mpint`s back to back.
 */
export function agentSignature(key: ParsedKey, data: Buffer, flags: number): { format: string; blob: Buffer } | null {
	const pem = key.getPrivatePEM();
	if (key.type === "ssh-ed25519") return { format: "ssh-ed25519", blob: cryptoSign(null, data, pem) };
	if (key.type === "ssh-rsa") {
		// Plain `ssh-rsa` is SHA-1, which current servers refuse; it is still what an old client asks for.
		const [format, hash] = flags & RSA_SHA2_512 ? ["rsa-sha2-512", "sha512"] : flags & RSA_SHA2_256 ? ["rsa-sha2-256", "sha256"] : ["ssh-rsa", "sha1"];
		return { format, blob: cryptoSign(hash, data, pem) };
	}
	const hash = ECDSA_HASH[key.type];
	if (hash) {
		const raw = cryptoSign(hash, data, { key: pem, dsaEncoding: "ieee-p1363" });
		const half = raw.length / 2;
		return { format: key.type, blob: Buffer.concat([sshMpint(raw.subarray(0, half)), sshMpint(raw.subarray(half))]) };
	}
	return null;
}

export interface LentKey {
	key: ParsedKey;
	/** The credential this key belongs to, so a signature can be attributed. */
	name: string;
}

export interface AgentHandle {
	close(): Promise<void>;
}

/**
 * Serves `keys()` on a Unix socket or a Windows named pipe until closed.
 *
 * `keys` is read on every request rather than captured, so a credential revoked while a command is
 * still running stops signing at once instead of when the command ends.
 */
export function serveAgent(path: string, keys: () => readonly LentKey[], onSign?: (name: string) => void): Promise<AgentHandle> {
	const sockets = new Set<Socket>();
	const server: Server = createServer((socket) => {
		sockets.add(socket);
		const framer = new AgentFramer();
		socket.on("data", (chunk: Buffer) => {
			let requests;
			try {
				requests = framer.push(chunk);
			} catch {
				socket.destroy();
				return;
			}
			for (const request of requests) {
				if (request.type === "identities") {
					socket.write(identitiesReply(keys().map((lent) => ({ blob: lent.key.getPublicSSH(), comment: lent.name }))));
					continue;
				}
				if (request.type === "sign") {
					const lent = keys().find((one) => one.key.getPublicSSH().equals(request.key));
					const signed = lent && agentSignature(lent.key, request.data, request.flags);
					if (!lent || !signed) {
						socket.write(failureReply());
						continue;
					}
					onSign?.(lent.name);
					socket.write(signReply(signed.format, signed.blob));
					continue;
				}
				/*
				 * Extensions, `session-bind@openssh.com` among them, are answered with a failure. The
				 * client treats that one as optional and carries on; binding a key to the host it
				 * signs for is a later step, not a reason to break logins now.
				 */
				socket.write(failureReply());
			}
		});
		socket.on("error", () => {});
		socket.on("close", () => sockets.delete(socket));
	});
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(path, () => {
			server.off("error", reject);
			resolve({
				close: async () => {
					for (const socket of sockets) socket.destroy();
					await new Promise<void>((done) => server.close(() => done()));
					// A named pipe is gone with its server; a Unix socket leaves a file behind.
					if (process.platform !== "win32") await unlink(path).catch(() => {});
				},
			});
		});
	});
}
