/**
 * A rendezvous for two sockets that cannot reach each other.
 *
 * Both the desktop and the phone dial *out* to this, which is the entire point: an outbound
 * connection needs no port forward, so it works from behind the kind of NAT that has nothing to
 * forward. This process joins the two and copies bytes between them.
 *
 * It is deliberately ignorant. The room is a SHA-256 of the pairing token and the token itself is
 * never sent here, so this knows that two clients want to meet and neither who they are nor what
 * they say. Frames are relayed without being parsed. That is not confidentiality — this sits in
 * the plaintext path and can read the frames — it is only the absence of any reason to. Real
 * TLS protects the two network hops, but the relay operator can read and inject frames. The room
 * itself is a bearer capability on this transport, so a relay must be trusted.
 *
 * Frames are streamed, not collected: a frame's header is forwarded as soon as it is read and its
 * payload follows chunk by chunk, so a 100 MB message costs this process a socket buffer rather than
 * 100 MB. See docs/adr/0029-sync-link-streams-large-data.md for why the relay changed from
 * "decode whole frames up to 8 MiB" to this.
 *
 * No dependencies, one file, Node 18.17+. `node server.mjs`, `PORT` to move it.
 */

import { createHash, randomUUID } from "node:crypto";
import { createServer, validateHeaderValue } from "node:http";

const PORT = Number(process.env.PORT ?? 8787);
const MiB = 1024 * 1024;

/** A byte limit from the environment, for operators and for tests that cannot send gigabytes. */
function envBytes(name, fallback) {
	const value = Number(process.env[name]);
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

/*
 * Limits against runaway clients, not attacks.
 *
 * The relay knows no one: a room is a token hash, so the only judgement available is "how much has
 * one source asked for". That is enough for what these are for — a reconnect loop gone wrong, or a
 * script using a room as a pipe. A targeted attacker changes token and gets a new room; that is
 * stopped by the token, not by these.
 *
 * The per-connection quota was 1 GiB when nothing bigger than a transcript crossed the link. Phones
 * now upload files of up to 2 GiB through here (resumable, so a cut costs a retry rather than the
 * file), and one connection can carry several; 8 GiB keeps a runaway bounded without cutting a
 * legitimate transfer in half. An operator who wants a bandwidth cap should set one at the reverse
 * proxy, which can throttle instead of disconnect.
 */
const MAX_ROOMS_PER_MINUTE = 30;
const MAX_BYTES_PER_CONNECTION = envBytes("LYRA_RELAY_MAX_BYTES", 8 * 1024 * MiB);
/**
 * The largest single frame accepted.
 *
 * Not a memory bound any more — a streamed frame costs the same at any size — but a sanity bound on
 * what a length field may claim. Current clients send large data as 256 KiB frames; older desktops
 * send a whole transcript as one frame, and 256 MiB covers any of those with room to spare.
 */
const MAX_FRAME_BYTES = envBytes("LYRA_RELAY_MAX_FRAME", 256 * MiB);
/** The hello is a few hundred bytes. Anything much larger before joining is not this protocol. */
const MAX_HELLO_BYTES = 16 * 1024;
const MAX_ASSET_RESPONSE_BYTES = 7 * MiB;
/** How much of a desktop text frame is read before deciding whether it is an asset response. */
const SNIFF_BYTES = 64;
const ASSET_TIMEOUT_MS = 15_000;
const RATE_WINDOW_MS = 60_000;
/**
 * Unflushed bytes toward one receiver at which its sender is paused.
 *
 * Without this, a desktop on a fast uplink talking to a phone on a slow one parked the whole
 * difference in this process's memory. Pausing the sender's socket pushes the wait back through TCP
 * to the sender, where it belongs; the receiver's `drain` resumes it.
 */
const HIGH_WATER_BYTES = envBytes("LYRA_RELAY_HIGH_WATER", 1 * MiB);
/** How long a receiver may take nothing before it is treated as gone. */
const STALL_MS = envBytes("LYRA_RELAY_STALL_MS", 60_000);

/** Room creations per source in the last minute. Keyed by IP, valued by timestamps. */
const recentJoins = new Map();

/** Whether this source may open another room now. Expired entries are dropped on the way. */
function withinRate(address) {
	const now = Date.now();
	const seen = (recentJoins.get(address) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
	if (seen.length >= MAX_ROOMS_PER_MINUTE) {
		recentJoins.set(address, seen);
		return false;
	}
	seen.push(now);
	recentJoins.set(address, seen);
	return true;
}

/*
 * The table is swept when someone arrives, not on a timer: a process that wakes every minute is
 * awake when nobody is connected, which is most of the time. Its size is bounded by the sources seen
 * in the last minute anyway.
 */
function forgetStale() {
	const now = Date.now();
	for (const [address, times] of recentJoins) {
		const live = times.filter((t) => now - t < RATE_WINDOW_MS);
		if (live.length === 0) recentJoins.delete(address);
		else recentJoins.set(address, live);
	}
}

/** Rooms hold at most two: a host and a guest. `Map<room, Set<client>>`. */
const rooms = new Map();
/** Renderer capability → the desktop client that can read that public build. */
const assetHosts = new Map();
/** Asset request id → the HTTP response waiting for the desktop. */
const assetRequests = new Map();

const WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const server = createServer((req, res) => {
	if (req.url === "/health") {
		res.writeHead(200, { "content-type": "application/json" });
		// Version 2: frames are streamed with backpressure, and fragmented messages are kept whole.
		res.end(JSON.stringify({ app: "lyra-relay", version: 2, rooms: rooms.size }));
		return;
	}
	// Routing needs only the request target; an untrusted Host must never become a URL base.
	const target = req.url ?? "/";
	if (!URL.canParse(target, "http://localhost")) {
		res.writeHead(400).end();
		return;
	}
	const url = new URL(target, "http://localhost");
	if (req.method === "GET" && url.pathname.startsWith("/app/")) {
		void requestAsset(url.pathname, res);
		return;
	}
	res.writeHead(404).end();
});

server.on("upgrade", (req, socket, head) => {
	const key = req.headers["sec-websocket-key"];
	if (!key) return socket.destroy();
	// Small frames — a keystroke, a streamed token — should not wait for Nagle.
	socket.setNoDelay(true);
	/*
	 * A phone that loses its network sends neither FIN nor RST, and its member would hold the room's
	 * mobile role until something tried to write to it. Keepalive probes find it in about a minute.
	 */
	socket.setKeepAlive(true, 30_000);

	socket.write(
		[
			"HTTP/1.1 101 Switching Protocols",
			"Upgrade: websocket",
			"Connection: Upgrade",
			`Sec-WebSocket-Accept: ${createHash("sha1").update(key + WS_MAGIC).digest("base64")}`,
			"\r\n",
		].join("\r\n"),
	);

	const client = {
		id: randomUUID().slice(0, 8),
		socket,
		room: null,
		role: null,
		assetKey: null,
		/** Payload bytes this connection has sent, checked against the quota. */
		bytes: 0,
		/** Room creation is rate limited by this. Behind a reverse proxy it is the proxy's address. */
		address: socket.remoteAddress ?? "unknown",
		/** Incoming frame being read; see `onData`. */
		reader: { header: Buffer.alloc(14), have: 0, need: 2, frame: null },
		/** This client is in the middle of sending a fragmented message. */
		fragmented: false,
		/** Where the rest of that fragmented message goes: the peer it started on, or nobody. */
		fragmentTo: null,
		/** A forwarded frame's payload is partway written *to* this client. */
		midFrame: false,
		/** A fragmented message is partway forwarded *to* this client. */
		midMessage: false,
		/** The relay's own frames for this client, held until it is at a frame or message boundary. */
		pending: [],
		/** The receiver this client's socket is paused for, if any. */
		pausedFor: null,
		/** Fires if that receiver takes nothing for too long. */
		stall: null,
		/** No more input is read from this client. */
		dead: false,
		/** `leave` has run. */
		gone: false,
	};

	socket.on("data", (chunk) => onData(client, chunk));
	/*
	 * The HTTP server hands over upgraded sockets half-open, so a client's FIN emits `end` and
	 * nothing else — the socket never closes, `leave` never runs, and the member keeps its role in
	 * the room. The next connection from the same phone was then refused as `role-full` for as long
	 * as the dead one lingered. Nothing more will come from a client that has sent FIN.
	 */
	socket.on("end", () => socket.destroy());
	socket.on("error", () => leave(client));
	socket.on("close", () => leave(client));
	if (head?.length) onData(client, head);
	/*
	 * A socket that says nothing is a socket that will hold a room forever.
	 *
	 * The room is keyed on a token hash, so a stuck client denies that token its room — meaning a
	 * failed pairing attempt can lock out the retry. Ten seconds is far longer than a hello takes.
	 */
	setTimeout(() => {
		if (!client.room) socket.destroy();
	}, 10_000).unref?.();
});

// ---------------------------------------------------------------------------
// Reading frames, a chunk at a time
// ---------------------------------------------------------------------------

/**
 * Consume one TCP chunk: header bytes are gathered, payload bytes are handled as they arrive.
 *
 * Nothing is concatenated per chunk. The previous reader appended every chunk to one buffer and
 * re-scanned it, which copied a large frame once per chunk (quadratic in its size) and held all of
 * it in memory until the last byte arrived.
 */
function onData(client, chunk) {
	let at = 0;
	while (at < chunk.length && !client.dead) {
		const reader = client.reader;
		if (!reader.frame) {
			const take = Math.min(reader.need - reader.have, chunk.length - at);
			chunk.copy(reader.header, reader.have, at, at + take);
			reader.have += take;
			at += take;
			if (reader.have < reader.need) return;
			if (reader.need === 2) {
				// The first two bytes say how long the rest of the header is.
				const size = reader.header[1] & 0x7f;
				reader.need = 2 + (size === 126 ? 2 : size === 127 ? 8 : 0) + (reader.header[1] & 0x80 ? 4 : 0);
				if (reader.have < reader.need) continue;
			}
			if (!beginFrame(client)) return;
			if (client.reader.frame?.length === 0) endFrame(client);
			continue;
		}
		const frame = reader.frame;
		const take = Math.min(frame.length - frame.done, chunk.length - at);
		const piece = chunk.subarray(at, at + take);
		if (frame.mask) unmask(piece, frame.mask, frame.done);
		frame.done += take;
		at += take;
		if (frame.mode === "stream") forward(client, frame.peer, piece);
		else if (frame.mode !== "drop") frame.parts.push(piece);
		if (frame.mode === "sniff" && (frame.done >= SNIFF_BYTES || frame.done === frame.length)) sniff(client, frame);
		if (frame.done === frame.length) endFrame(client);
	}
}

/**
 * A header has been read: validate it and decide what happens to the payload.
 *
 * Three outcomes. Small frames the relay itself must read — control frames, the hello, and desktop
 * text frames that may be an asset response — are buffered. Everything else is streamed to the peer
 * with its FIN bit and opcode intact, which is what keeps a fragmented message a message: the old
 * relay re-sent every fragment with FIN set, turning a phone's 1 MB prompt (Chromium splits anything
 * over ~128 KiB) into a truncated message followed by orphan continuation frames, and the desktop
 * closed the link on the protocol error. With no peer in the room, the payload is dropped.
 */
function beginFrame(client) {
	const reader = client.reader;
	const header = reader.header;
	const fin = (header[0] & 0x80) !== 0;
	const reserved = header[0] & 0x70;
	const opcode = header[0] & 0x0f;
	const masked = (header[1] & 0x80) !== 0;
	let length = header[1] & 0x7f;
	let at = 2;
	if (length === 126) {
		length = header.readUInt16BE(2);
		at = 4;
	} else if (length === 127) {
		const big = header.readBigUInt64BE(2);
		if (big > BigInt(MAX_FRAME_BYTES)) return fail(client);
		length = Number(big);
		at = 10;
	}
	const mask = masked ? Buffer.from(header.subarray(at, at + 4)) : null;
	reader.have = 0;
	reader.need = 2;

	// No extension is negotiated, so a reserved bit is a client that does not speak this protocol.
	if (reserved) return fail(client);
	const control = opcode >= 0x8;
	if (control && (!fin || length > 125 || opcode > 0xa)) return fail(client);
	if (!control && opcode > 0x2) return fail(client);
	if (length > MAX_FRAME_BYTES) return fail(client);
	// A continuation needs a message to continue, and a new message cannot start inside one.
	if (!control && (opcode === 0x0) !== client.fragmented) return fail(client);

	const frame = { fin, opcode, mask, length, done: 0, mode: "drop", parts: [], peer: null };
	reader.frame = frame;
	if (control) {
		frame.mode = "buffer";
		return true;
	}
	if (!client.room) {
		if (length > MAX_HELLO_BYTES || !fin) {
			refuse(client, "bad-hello");
			return false;
		}
		frame.mode = "buffer";
		return true;
	}

	/*
	 * Counted before a byte is forwarded, and over the limit the connection is closed rather than
	 * the frame dropped: a link that silently loses half its frames looks healthy to both ends, and
	 * the sync protocol would show it as "a message is missing on the phone" — far harder to find.
	 */
	client.bytes += length;
	if (client.bytes > MAX_BYTES_PER_CONNECTION) {
		refuse(client, "quota-exceeded");
		return false;
	}

	/*
	 * A desktop's text frame may be an asset response, which the relay answers itself instead of
	 * forwarding. Its first bytes say which: the frame is held only until they arrive, then either
	 * kept whole (an asset response, at most 7 MiB) or streamed like any other.
	 */
	if (client.role === "desktop" && opcode === 0x1 && fin && length <= MAX_ASSET_RESPONSE_BYTES) {
		frame.mode = "sniff";
		return true;
	}

	const peer = opcode === 0x0 ? client.fragmentTo : peerOf(client);
	if (opcode !== 0x0) client.fragmentTo = fin ? null : peer;
	startStream(client, frame, peer, []);
	return true;
}

/** Announce the frame to the peer and forward whatever of its payload is already here. */
function startStream(client, frame, peer, already) {
	if (!peer || peer.socket.destroyed) {
		frame.mode = "drop";
		frame.parts = [];
		return;
	}
	frame.mode = "stream";
	frame.peer = peer;
	frame.parts = [];
	peer.midFrame = frame.length > 0;
	forward(client, peer, already.length ? Buffer.concat([frameHeader(frame.length, frame.opcode, frame.fin), ...already]) : frameHeader(frame.length, frame.opcode, frame.fin));
}

/** Enough of a desktop text frame to tell an asset response from a session message. */
function sniff(client, frame) {
	const head = Buffer.concat(frame.parts).subarray(0, SNIFF_BYTES).toString("latin1");
	if (head.startsWith('{"type":"asset_response"')) {
		frame.mode = "buffer";
		return;
	}
	startStream(client, frame, peerOf(client), frame.parts);
}

/** The whole payload has arrived: finish forwarding it, or act on it if it was buffered. */
function endFrame(client) {
	const frame = client.reader.frame;
	client.reader.frame = null;
	if (frame.opcode >= 0x8) return control(client, frame.opcode, Buffer.concat(frame.parts));

	if (frame.opcode !== 0x0) client.fragmented = !frame.fin;
	else if (frame.fin) {
		client.fragmented = false;
		client.fragmentTo = null;
	}

	if (frame.mode === "stream") {
		const peer = frame.peer;
		peer.midFrame = false;
		peer.midMessage = !frame.fin;
		flushPending(peer);
		return;
	}
	if (frame.mode !== "buffer") return;

	const payload = Buffer.concat(frame.parts);
	if (!client.room) return join(client, payload);
	if (acceptAssetResponse(client, payload)) return;
	/*
	 * Relayed verbatim, opcode included.
	 *
	 * The two ends speak the sync server's own protocol through here — JSON text and binary parts
	 * today, and whatever it becomes later. Re-encoding as text would corrupt a binary frame, and this
	 * has no business knowing which is which.
	 */
	const peer = peerOf(client);
	if (peer) forward(client, peer, Buffer.concat([frameHeader(payload.length, frame.opcode, true), payload]));
}

function control(client, opcode, payload) {
	// 0x8 close, 0x9 ping, 0xA pong.
	if (opcode === 0x8) {
		client.dead = true;
		client.socket.destroy();
		return;
	}
	if (opcode === 0x9) deliver(client, encode(payload, 0xa), true);
}

/** The other member of this client's room, or null. */
function peerOf(client) {
	for (const member of rooms.get(client.room) ?? []) {
		if (member !== client && !member.socket.destroyed) return member;
	}
	return null;
}

// ---------------------------------------------------------------------------
// Writing: forwarded bytes with backpressure, the relay's own frames at boundaries
// ---------------------------------------------------------------------------

/**
 * Bytes from one member to the other, pausing the sender while the receiver is behind.
 *
 * `pause()` stops reading the sender's socket, so its TCP window fills and the sender's own writes
 * back up. At most one chunk past the mark is held here.
 */
function forward(from, to, data) {
	if (to.socket.destroyed || to.socket.writableEnded) return;
	to.socket.write(data);
	if (to.socket.writableLength <= HIGH_WATER_BYTES || from.pausedFor) return;
	from.pausedFor = to;
	from.socket.pause();
	to.socket.once("drain", () => resume(from, to));
	/*
	 * A receiver that takes nothing for a whole minute is not slow, it is gone — and while the sender
	 * is paused this process cannot even see the sender leave (a paused socket does not report its
	 * end). Closing the receiver resumes the sender through `leave`.
	 */
	from.stall = setTimeout(() => {
		if (from.pausedFor === to) to.socket.destroy();
	}, STALL_MS);
	from.stall.unref?.();
}

function resume(from, to) {
	if (from.pausedFor !== to) return;
	from.pausedFor = null;
	clearTimeout(from.stall);
	if (!from.socket.destroyed) from.socket.resume();
}

/**
 * One of the relay's own frames, written only where the stream to this client allows it.
 *
 * A frame cannot be written into the middle of another frame's payload, and a data frame cannot be
 * written into the middle of a fragmented message — the receiver would read either as a protocol
 * error. Control frames (pong) may go between fragments; data frames (`ready`, `peer-left`,
 * `asset_request`) wait for the message to finish.
 */
function deliver(client, frame, isControl) {
	if (client.socket.destroyed) return;
	if (client.midFrame || (!isControl && client.midMessage) || client.pending.length > 0) {
		client.pending.push({ frame, isControl });
		flushPending(client);
		return;
	}
	client.socket.write(frame);
}

function flushPending(client) {
	while (client.pending.length > 0 && !client.socket.destroyed) {
		const next = client.pending[0];
		if (client.midFrame || (!next.isControl && client.midMessage)) return;
		client.pending.shift();
		client.socket.write(next.frame);
	}
}

function send(client, message) {
	deliver(client, encode(Buffer.from(JSON.stringify(message), "utf8"), 0x1), false);
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

function join(client, payload) {
	let hello;
	try {
		hello = JSON.parse(payload.toString("utf8"));
	} catch {
		return refuse(client, "bad-hello");
	}
	const role = hello?.role === "desktop" || hello?.role === "host"
		? "desktop"
		: hello?.role === "mobile" || hello?.role === "guest"
			? "mobile"
			: null;
	if (hello?.type !== "hello" || typeof hello.room !== "string" || !/^[a-f0-9]{64}$/.test(hello.room) || !role) {
		return refuse(client, "bad-hello");
	}
	if (hello.assetKey !== undefined && (typeof hello.assetKey !== "string" || !/^[a-f0-9]{64}$/.test(hello.assetKey))) {
		return refuse(client, "bad-hello");
	}
	// A public asset URL cannot prove room ownership, including while the real desktop is offline.
	if (hello.assetKey !== undefined && hello.assetKey !== createHash("sha256").update(`lyra-assets\0${hello.room}`).digest("hex")) {
		return refuse(client, "bad-hello");
	}

	if (!withinRate(client.address)) return refuse(client, "rate-limited");
	forgetStale();

	const members = rooms.get(hello.room) ?? new Set();
	/*
	 * Two is the whole room.
	 *
	 * The id is derived from the pairing token, so a third arrival means that token is known to
	 * someone it should not be. Refusing the newcomer is the safer half of a bad situation:
	 * evicting a member would let whoever holds the leaked token displace the real device.
	 */
	if (members.size >= 2) return refuse(client, "room-full");
	if ([...members].some((member) => member.role === role)) return refuse(client, "role-full");

	client.room = hello.room;
	client.role = role;
	client.assetKey = role === "desktop" && typeof hello.assetKey === "string" ? hello.assetKey : null;
	members.add(client);
	rooms.set(hello.room, members);
	if (client.assetKey) assetHosts.set(client.assetKey, client);

	if (members.size === 2) {
		for (const member of members) send(member, { type: "ready" });
	} else {
		send(client, { type: "waiting" });
	}
}

function leave(client) {
	if (client.gone) return;
	client.gone = true;
	client.dead = true;
	if (client.assetKey && assetHosts.get(client.assetKey) === client) assetHosts.delete(client.assetKey);
	for (const [id, pending] of assetRequests) {
		if (pending.desktop !== client) continue;
		clearTimeout(pending.timer);
		assetRequests.delete(id);
		if (!pending.res.headersSent) pending.res.writeHead(502).end();
	}
	if (!client.room) return;
	const members = rooms.get(client.room);
	if (!members) return;
	members.delete(client);
	for (const peer of members) {
		resume(peer, client);
		/*
		 * A message this client was halfway through sending cannot be finished for it.
		 *
		 * The peer is partway into reading it: another frame written now would be read as the rest
		 * of the payload, or as a data frame inside a fragmented message — a protocol error either
		 * way, or worse, bytes read as the wrong thing. Closing the peer's socket is the honest end;
		 * it reconnects and both sides resynchronise, which they do after any drop.
		 */
		if (peer.midFrame || peer.midMessage) {
			peer.dead = true;
			peer.socket.destroy();
			continue;
		}
		send(peer, { type: "peer-left" });
	}
	if (members.size === 0) rooms.delete(client.room);
	client.room = null;
	client.role = null;
	client.assetKey = null;
}

// ---------------------------------------------------------------------------
// The renderer asset tunnel
// ---------------------------------------------------------------------------

async function requestAsset(pathname, res) {
	const match = /^\/app\/([a-f0-9]{64})(\/.*)?$/.exec(pathname);
	if (!match) {
		res.writeHead(404).end();
		return;
	}
	if (!match[2]) {
		res.writeHead(302, { location: `${pathname}/` }).end();
		return;
	}

	const desktop = assetHosts.get(match[1]);
	if (!desktop || desktop.socket.destroyed) {
		res.writeHead(404).end();
		return;
	}

	const id = randomUUID();
	const timer = setTimeout(() => {
		const pending = assetRequests.get(id);
		if (!pending) return;
		assetRequests.delete(id);
		if (!res.headersSent) res.writeHead(504).end();
	}, ASSET_TIMEOUT_MS);
	timer.unref?.();
	assetRequests.set(id, { res, desktop, timer });
	send(desktop, { type: "asset_request", id, path: `/app${match[2]}` });
}

function acceptAssetResponse(client, payload) {
	if (client.role !== "desktop" || payload.length > MAX_ASSET_RESPONSE_BYTES) return false;
	let message;
	try {
		message = JSON.parse(payload.toString("utf8"));
	} catch {
		return false;
	}
	if (message?.type !== "asset_response" || typeof message.id !== "string") return false;

	const pending = assetRequests.get(message.id);
	if (!pending || pending.desktop !== client) return true;
	clearTimeout(pending.timer);
	assetRequests.delete(message.id);

	const status = message.status === 200 || message.status === 404 || message.status === 413 ? message.status : 502;
	const contentType = safeHeader(message.contentType, "application/octet-stream");
	const cacheControl = message.cacheControl === "public, max-age=31536000, immutable"
		? message.cacheControl
		: "no-store";
	const body = typeof message.bodyBase64 === "string" ? Buffer.from(message.bodyBase64, "base64") : Buffer.alloc(0);
	pending.res.writeHead(status, {
		"content-type": contentType,
		"cache-control": cacheControl,
		"content-length": String(body.length),
		"x-content-type-options": "nosniff",
	});
	pending.res.end(body);
	return true;
}

function safeHeader(value, fallback) {
	if (typeof value !== "string" || value.length > 200) return fallback;
	try {
		validateHeaderValue("content-type", value);
		return value;
	} catch {
		return fallback;
	}
}

/** Say why, then close. Nothing more is read from a refused client. */
function refuse(client, reason) {
	client.dead = true;
	send(client, { type: "error", reason });
	client.socket.end();
	setTimeout(() => client.socket.destroy(), 1000).unref?.();
}

/** Not this protocol, or not a well-formed frame: there is nothing to say that it would read. */
function fail(client) {
	client.dead = true;
	client.socket.destroy();
	return false;
}

// ---------------------------------------------------------------------------
// The two bits of RFC 6455 this needs
// ---------------------------------------------------------------------------

/** Client-to-server payloads are masked with a 4-byte key that cycles by payload offset. */
function unmask(piece, mask, offset) {
	for (let i = 0; i < piece.length; i++) piece[i] ^= mask[(offset + i) & 3];
}

/** Server-to-client, so never masked. FIN is kept as given: fragments stay fragments. */
function frameHeader(length, opcode, fin) {
	const first = (fin ? 0x80 : 0) | opcode;
	if (length < 126) return Buffer.from([first, length]);
	if (length < 65536) {
		const header = Buffer.alloc(4);
		header[0] = first;
		header[1] = 126;
		header.writeUInt16BE(length, 2);
		return header;
	}
	const header = Buffer.alloc(10);
	header[0] = first;
	header[1] = 127;
	header.writeBigUInt64BE(BigInt(length), 2);
	return header;
}

function encode(payload, opcode = 0x1) {
	return Buffer.concat([frameHeader(payload.length, opcode, true), payload]);
}

server.on("error", (error) => {
	process.stderr.write(`lyra-relay ${error instanceof Error ? error.message : String(error)}\n`);
	process.exit(1);
});

server.listen(PORT, "0.0.0.0", () => {
	process.stdout.write(`lyra-relay listening on :${server.address().port}\n`);
});
