/**
 * Dialling out to a relay, for the case where nothing can dial in.
 *
 * The sync server waits to be connected to, which works on a shared network and nowhere else. A
 * phone on mobile data and a desktop behind a home router have no route between them and no port
 * either end can open. A relay solves it by having *both* sides dial out — an outbound connection
 * needs no forwarding — and copying bytes between the two.
 *
 * So this is the desktop's outbound half. It connects, announces which room it wants, and from then
 * on the socket behaves exactly like a phone that connected directly: the same frames, answered by
 * the same code. That symmetry is the point — `sync-server.ts` adds it to `clients` and never has
 * to know which kind of connection it is holding.
 *
 * The room is the SHA-256 of the pairing token. The token itself never reaches the relay, so a
 * relay can route the devices without receiving the token. The room remains a bearer capability:
 * its holder and the relay operator can inject session frames, so the relay must be trusted.
 */

import { createHash } from "node:crypto";
import { WebSocket } from "ws";

/** Where two devices meet, derived from the secret they share without disclosing it. */
export function roomFor(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

/** Separate from the conversation room so an asset URL never grants access to session frames. */
export function assetKeyFor(token: string): string {
	return createHash("sha256").update(`lyra-assets\0${roomFor(token)}`).digest("hex");
}

/**
 * Normalise whatever someone typed into the relay field.
 *
 * People paste `relay.example.com`, `https://relay.example.com` and `wss://relay.example.com:9000`
 * interchangeably, and all three mean the same thing. A bare host defaults to `wss` rather than
 * `ws`: a relay is reached across the internet, and the frames passing through it are a session
 * transcript.
 */
export function relaySocketUrl(configured: string): string | null {
	const trimmed = configured.trim();
	if (!trimmed) return null;
	try {
		const url = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `wss://${trimmed}`);
		if (!url.hostname) return null;
		url.protocol = url.protocol === "http:" || url.protocol === "ws:" ? "ws:" : "wss:";
		return url.toString().replace(/\/$/, "");
	} catch {
		return null;
	}
}

export interface RelayHandlers {
	/**
	 * The socket to the relay is open, before any phone is in the room.
	 *
	 * The relay's asset requests arrive from this moment — a phone loads the interface over HTTP
	 * before its WebSocket joins — so the socket needs its channel before `joined`.
	 */
	opened(socket: WebSocket): void;
	/**
	 * A frame from the far end — a phone, speaking the sync server's own protocol — or the relay's
	 * own asset request. Passed as it arrived: wire 2 sends binary parts as well as JSON text.
	 */
	message(socket: WebSocket, data: Buffer, isBinary: boolean): void;
	/** The far end arrived. The socket can be treated as a connected client from here. */
	joined(socket: WebSocket): void;
	/**
	 * The phone left the room; the socket to the relay stays open for the next one.
	 *
	 * Whatever was in flight to or from it belonged to that phone, and the next one to arrive may be
	 * a different build that has never heard of it.
	 */
	peerLeft(socket: WebSocket): void;
	/** The link went away, by either end. */
	left(socket: WebSocket): void;
}

/** The relay's own words, which come as small JSON text frames. */
const RELAY_WORDS = new Set(["waiting", "ready", "peer-left", "error"]);

/** How long to wait before dialling again, doubling to a ceiling. */
const FIRST_RETRY = 1000;
const MAX_RETRY = 30_000;

/**
 * Keep a link to the relay open for as long as the server is running.
 *
 * Reconnecting is not optional. This is a long-lived outbound connection over the public internet:
 * it will be closed by an idle timeout, a laptop lid, a change of network. If it stayed down, sync
 * would appear to work until the first time anything moved and then silently stop — the failure
 * that a phone experiences as "the desktop stopped answering" with nothing on either screen to say
 * why.
 */
export class RelayLink {
	private socket: WebSocket | null = null;
	private retry = FIRST_RETRY;
	private timer: NodeJS.Timeout | null = null;
	private stopped = false;

	private readonly url: string;
	private readonly token: string;
	private readonly handlers: RelayHandlers;

	constructor(url: string, token: string, handlers: RelayHandlers) {
		this.url = url;
		this.token = token;
		this.handlers = handlers;
	}

	start(): void {
		this.stopped = false;
		this.open();
	}

	stop(): void {
		this.stopped = true;
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		const socket = this.socket;
		this.socket = null;
		socket?.close();
	}

	/** Whether a phone is currently on the other end of the relay. */
	get connected(): boolean {
		return this.socket?.readyState === 1;
	}

	private open(): void {
		if (this.stopped) return;

		let socket: WebSocket;
		try {
			socket = new WebSocket(this.url);
		} catch {
			this.later();
			return;
		}
		this.socket = socket;

		socket.on("open", () => {
			this.handlers.opened(socket);
			// The room, and nothing else: the relay refuses anything that is not a well-formed hello,
			// and closes a socket that says nothing within ten seconds.
			socket.send(JSON.stringify({
				type: "hello",
				room: roomFor(this.token),
				role: "desktop",
				assetKey: assetKeyFor(this.token),
			}));
			this.retry = FIRST_RETRY;
		});

		socket.on("message", (data: Buffer, isBinary: boolean) => {
			/*
			 * The relay's own words, which are not from the phone.
			 *
			 * `waiting` means the room is ours alone so far; `ready` means a phone has arrived and
			 * `peer-left` that it went. Everything else came from the far end and is the sync
			 * protocol — including binary parts, which used to be dropped here by a `JSON.parse` that
			 * could never succeed on them. Only short text frames are looked at.
			 */
			if (!isBinary && data.length < 256) {
				let word: unknown;
				try {
					word = (JSON.parse(data.toString("utf8")) as { type?: unknown }).type;
				} catch {
					word = null;
				}
				if (typeof word === "string" && RELAY_WORDS.has(word)) {
					if (word === "ready") this.handlers.joined(socket);
					else if (word === "peer-left") this.handlers.peerLeft(socket);
					return;
				}
			}
			this.handlers.message(socket, data, isBinary);
		});

		const gone = () => {
			if (this.socket === socket) this.socket = null;
			this.handlers.left(socket);
			this.later();
		};
		socket.on("close", gone);
		// Both fire on a failed connection; `close` follows `error`, and doing this twice would
		// schedule two reconnects racing each other.
		socket.on("error", () => socket.close());
	}

	private later(): void {
		if (this.stopped || this.timer) return;
		this.timer = setTimeout(() => {
			this.timer = null;
			this.open();
		}, this.retry);
		this.timer.unref?.();
		this.retry = Math.min(this.retry * 2, MAX_RETRY);
	}
}
