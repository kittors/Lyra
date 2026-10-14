/**
 * Key pairs for tests: ssh2's generator, minus the pairs it writes wrong.
 *
 * ssh2 1.17 strips every leading zero byte off an ed25519 public key. It means the padding byte DER puts
 * in front, and takes the key's own first byte with it when that is zero — one key in 256 — so neither
 * the public line nor the private file written around it reads back. Keys ssh-keygen makes with the
 * same leading zero read fine: the generator is wrong, not the parser the product uses. A test that
 * drew one failed at random, once in the pre-push hook; a pair is drawn again until both halves read.
 */

import ssh2 from "ssh2";

export function keyPair(type: "ed25519" | "rsa" | "ecdsa", { passphrase, ...options }: { bits?: number; comment?: string; passphrase?: string } = {}) {
	const settings = { ...options, ...(passphrase ? { passphrase, cipher: "aes256-ctr" } : {}) } as never;
	for (let attempt = 0; attempt < 16; attempt++) {
		const pair = ssh2.utils.generateKeyPairSync(type as "ed25519", settings);
		if (!(ssh2.utils.parseKey(pair.public) instanceof Error) && !(ssh2.utils.parseKey(pair.private, passphrase) instanceof Error)) return pair;
	}
	throw new Error(`ssh2 made 16 ${type} keys and none of them reads back`);
}
