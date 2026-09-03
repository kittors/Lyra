/**
 * Reading what the desktop's QR code says.
 *
 * The desktop writes this string (see `settings/pairing.ts` there); this end has to accept every
 * shape it produces and refuse everything else. Refusing matters: a camera picks up whatever is in
 * frame, so this is handed arbitrary strings from posters, packaging and other apps' codes, and it
 * has to say "that is not a Lyra code" rather than half-parse one into a connection that will
 * never work.
 */

import type { Connection } from "./client";

export type ScanResult =
	| { ok: true; connection: Connection }
	/** Why it was refused, in words worth showing on screen. */
	| { ok: false; reason: string };

/**
 * A pairing code, or the reason it is not one.
 *
 * Tolerant about the wrapper and strict about the contents. Leading whitespace and a trailing
 * newline come from clipboards; the scheme is matched case-insensitively because some scanners
 * upper-case what they decode. What is not tolerated is a missing host or token — those produce a
 * connection that fails later, somewhere less obvious than here.
 */
export function parsePairingCode(raw: string): ScanResult {
	const text = raw.trim();
	if (!text) return { ok: false, reason: "没有读到内容" };

	const match = /^lyra:\/\/pair\?(.+)$/i.exec(text);
	if (!match) return { ok: false, reason: "这不是 Lyra 的配对码" };

	let params: URLSearchParams;
	try {
		params = new URLSearchParams(match[1]);
	} catch {
		return { ok: false, reason: "配对码格式不对" };
	}

	const token = params.get("token")?.trim();
	if (!token) return { ok: false, reason: "配对码里没有令牌" };

	/*
	 * A relay code names a socket instead of a host.
	 *
	 * Both sides dial out to it, so there is nothing to reach directly and no port of our own to
	 * speak of — the endpoint is the whole address. Parsed here so the caller gets a `Connection`
	 * either way and does not have to know which kind of code was scanned.
	 */
	const relay = params.get("relay")?.trim();
	if (relay) {
		let url: URL;
		try {
			url = new URL(relay);
		} catch {
			return { ok: false, reason: "中转地址看不明白" };
		}
		if (!url.hostname) return { ok: false, reason: "中转地址缺少主机名" };
		const tls = url.protocol === "wss:" || url.protocol === "https:";
		const port = url.port ? Number(url.port) : tls ? 443 : 80;
		if (!validPort(port)) return { ok: false, reason: "中转地址的端口不对" };
		return { ok: true, connection: { host: url.hostname, port, token, tls, relay: true } };
	}

	const host = params.get("host")?.trim();
	if (!host) return { ok: false, reason: "配对码里没有地址" };

	const port = Number(params.get("port") ?? "4517");
	if (!validPort(port)) return { ok: false, reason: "配对码里的端口不对" };

	// Present and not "0"/"false" — the desktop writes `tls=1` and omits it otherwise.
	const flag = params.get("tls");
	const tls = flag !== null && flag !== "0" && flag.toLowerCase() !== "false";

	return { ok: true, connection: { host, port, token, tls } };
}

function validPort(port: number): boolean {
	return Number.isInteger(port) && port > 0 && port < 65536;
}
