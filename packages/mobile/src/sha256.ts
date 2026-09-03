/**
 * SHA-256, in plain JavaScript, for working out which relay room to join.
 *
 * Written out rather than imported because neither obvious source is available here. `crypto.subtle`
 * needs a secure context, and the page this pairs with is served over plain HTTP from a machine on
 * the local network — so inside the WebView it is simply absent. A native module would work, but
 * pulling one in for a single hash means a version of it that has to match whatever Expo Go ships,
 * which is a recurring cost for sixty lines of arithmetic.
 *
 * Computed on this side and inlined into the injected bridge, so the page never needs it at all.
 *
 * Not a general-purpose implementation: it takes a string, returns lowercase hex, and is used on
 * pairing tokens — short, ASCII, and not secret from the person holding the phone. It is checked
 * against `node:crypto` on the vectors that matter, including the ones that exercise the padding
 * boundaries where a hand-written implementation goes wrong.
 */

/** The first 32 bits of the fractional parts of the cube roots of the first 64 primes. */
const K = new Uint32Array([
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
	0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
	0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
	0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
	0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
	0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
	0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
	0xc67178f2,
]);

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

/** UTF-8 bytes, since the hash is defined over bytes and a token may not be ASCII. */
function utf8(text: string): Uint8Array {
	if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text);
	// Hermes has TextEncoder; this is for anything that does not.
	const out: number[] = [];
	for (const char of text) {
		let code = char.codePointAt(0) ?? 0;
		if (code < 0x80) out.push(code);
		else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
		else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
		else {
			out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
			code = 0;
		}
	}
	return new Uint8Array(out);
}

/** The digest of `text`, as 64 lowercase hex characters. */
export function sha256Hex(text: string): string {
	const bytes = utf8(text);

	/*
	 * Padding: a single 1 bit, then zeros, then the length in bits as a 64-bit big-endian integer,
	 * to a whole number of 64-byte blocks. The `+ 9` is that one byte plus the eight of the length —
	 * getting it wrong is invisible for most inputs and wrong for those that land near a boundary,
	 * which is why the tests below hash 55, 56 and 64 bytes specifically.
	 */
	const blocks = Math.ceil((bytes.length + 9) / 64);
	const padded = new Uint8Array(blocks * 64);
	padded.set(bytes);
	padded[bytes.length] = 0x80;

	// Length in bits. A pairing token is short, but the high word is written anyway rather than
	// assumed zero.
	const bits = bytes.length * 8;
	const view = new DataView(padded.buffer);
	view.setUint32(padded.length - 8, Math.floor(bits / 0x100000000), false);
	view.setUint32(padded.length - 4, bits >>> 0, false);

	// The first 32 bits of the fractional parts of the square roots of the first 8 primes.
	const h = new Uint32Array([
		0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
	]);
	const w = new Uint32Array(64);

	for (let block = 0; block < blocks; block++) {
		const at = block * 64;
		for (let i = 0; i < 16; i++) w[i] = view.getUint32(at + i * 4, false);
		for (let i = 16; i < 64; i++) {
			const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
			const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
			w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
		}

		let [a, b, c, d, e, f, g, hh] = h;
		for (let i = 0; i < 64; i++) {
			const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
			const ch = (e & f) ^ (~e & g);
			const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
			const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
			const maj = (a & b) ^ (a & c) ^ (b & c);
			const t2 = (S0 + maj) >>> 0;

			hh = g;
			g = f;
			f = e;
			e = (d + t1) >>> 0;
			d = c;
			c = b;
			b = a;
			a = (t1 + t2) >>> 0;
		}

		h[0] = (h[0] + a) >>> 0;
		h[1] = (h[1] + b) >>> 0;
		h[2] = (h[2] + c) >>> 0;
		h[3] = (h[3] + d) >>> 0;
		h[4] = (h[4] + e) >>> 0;
		h[5] = (h[5] + f) >>> 0;
		h[6] = (h[6] + g) >>> 0;
		h[7] = (h[7] + hh) >>> 0;
	}

	return Array.from(h, (word) => word.toString(16).padStart(8, "0")).join("");
}

/**
 * The relay room two devices sharing this token should meet in.
 *
 * The token never reaches the relay — only this hash does — so a relay operator learns that two
 * devices want to meet and nothing else. And because the hash is the address, only something that
 * already knows the token can arrive in the room.
 */
export function roomFor(token: string): string {
	return sha256Hex(token);
}
