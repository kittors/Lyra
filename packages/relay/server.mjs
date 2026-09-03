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
 * secrecy comes from running it behind TLS, and from the sync server's own token check, which this
 * has no way to satisfy on its own.
 *
 * No dependencies, one file, Node 18+. `node server.mjs`, `PORT` to move it.
 */

import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 8787);

/*
 * 限流，防的是失控而不是攻击。
 *
 * 这个中转不认识任何人——房间号是配对令牌的 SHA-256，它既不知道两端是谁，也不知道它们在说
 * 什么。所以这里能做的判断只有「一个来源要了多少」，而这恰好也够用：真正要挡的是一个重连循环
 * 跑飞的客户端，或者一个把房间当消息队列用的脚本，而不是一次有针对性的攻击——那种情况下换个
 * 令牌就是换个房间，限流拦不住，靠的是令牌本身。
 *
 * 三个数都取得比任何正常用法宽得多。一次配对建一个房间；一个会话的一天也到不了 1GB。
 */
const MAX_ROOMS_PER_MINUTE = 30;
const MAX_BYTES_PER_CONNECTION = 1024 * 1024 * 1024;
const RATE_WINDOW_MS = 60_000;

/** 每个来源最近一分钟建了几次房。键是 IP，值是时间戳数组。 */
const recentJoins = new Map();

/** 这个来源现在还能不能建房。顺手把过期的记录清掉，免得表无限长。 */
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
 * 记录只在有人来的时候清。
 *
 * 不用定时器：一个每分钟醒一次的进程，在没有连接的时候也醒着，而这个服务大部分时间没有连接。
 * 表的大小与最近一分钟的来源数同阶，那本来就是有界的。
 */
function forgetStale() {
	const now = Date.now();
	for (const [address, times] of recentJoins) {
		const live = times.filter((t) => now - t < RATE_WINDOW_MS);
		if (live.length === 0) recentJoins.delete(address);
		else recentJoins.set(address, live);
	}
}

/** Rooms hold at most two: a host and a guest. `Map<room, Set<socket>>`. */
const rooms = new Map();

const WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const server = createServer((req, res) => {
	if (req.url === "/health") {
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify({ app: "lyra-relay", version: 1, rooms: rooms.size }));
		return;
	}
	res.writeHead(404).end();
});

server.on("upgrade", (req, socket) => {
	const key = req.headers["sec-websocket-key"];
	if (!key) return socket.destroy();

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
		/** Bytes not yet forming a whole frame. */
		buffer: Buffer.alloc(0),
		/** 这条连接转发过多少字节，用来对上上限。 */
		bytes: 0,
		/** 建房限流按它算。反代后面这会是反代的地址——那种部署下限流该由反代做。 */
		address: socket.remoteAddress ?? "unknown",
	};

	socket.on("data", (chunk) => onData(client, chunk));
	socket.on("error", () => leave(client));
	socket.on("close", () => leave(client));
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

/** Decode as many whole frames as `chunk` completes, and act on each. */
function onData(client, chunk) {
	client.buffer = Buffer.concat([client.buffer, chunk]);

	for (;;) {
		const frame = decode(client.buffer);
		if (!frame) return;
		client.buffer = client.buffer.subarray(frame.size);

		// 0x8 close, 0x9 ping, 0xA pong.
		if (frame.opcode === 0x8) return client.socket.destroy();
		if (frame.opcode === 0x9) {
			client.socket.write(encode(frame.payload, 0xa));
			continue;
		}
		if (frame.opcode === 0xa) continue;

		if (!client.room) {
			join(client, frame.payload);
			continue;
		}

		/*
		 * Relayed verbatim, opcode included.
		 *
		 * The two ends speak the sync server's own protocol through here — JSON text today, and
		 * whatever it becomes later. Re-encoding as text would corrupt a binary frame the day one
		 * is sent, and this has no business knowing which is which.
		 */
		/*
		 * 转发之前先记账。
		 *
		 * 超过上限就断开这一条，而不是丢帧继续——一个只转发一半的连接，两端都不会知道它坏了，
		 * 而同步协议靠 seq 补齐，缺帧的表现是「手机上少了一条消息」，比断开难查得多。
		 */
		client.bytes += frame.payload.length;
		if (client.bytes > MAX_BYTES_PER_CONNECTION) {
			refuse(client, "quota-exceeded");
			return;
		}

		for (const peer of rooms.get(client.room) ?? []) {
			if (peer !== client && !peer.socket.destroyed) peer.socket.write(encode(frame.payload, frame.opcode));
		}
	}
}

function join(client, payload) {
	let hello;
	try {
		hello = JSON.parse(payload.toString("utf8"));
	} catch {
		return refuse(client, "bad-hello");
	}
	if (hello?.type !== "hello" || typeof hello.room !== "string" || !/^[a-f0-9]{64}$/.test(hello.room)) {
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

	client.room = hello.room;
	members.add(client);
	rooms.set(hello.room, members);

	if (members.size === 2) {
		for (const member of members) send(member, { type: "ready" });
	} else {
		send(client, { type: "waiting" });
	}
}

function leave(client) {
	if (!client.room) return;
	const members = rooms.get(client.room);
	if (!members) return;
	members.delete(client);
	for (const peer of members) send(peer, { type: "peer-left" });
	if (members.size === 0) rooms.delete(client.room);
	client.room = null;
}

function refuse(client, reason) {
	send(client, { type: "error", reason });
	client.socket.destroy();
}

function send(client, message) {
	if (!client.socket.destroyed) client.socket.write(encode(Buffer.from(JSON.stringify(message), "utf8"), 0x1));
}

// ---------------------------------------------------------------------------
// The two bits of RFC 6455 this needs
// ---------------------------------------------------------------------------

/**
 * One frame, if the buffer holds a whole one.
 *
 * Only the client-to-server direction, which is always masked. Returns the payload and how many
 * bytes it consumed, so the caller can keep the remainder for the next frame — TCP does not
 * preserve message boundaries, and a large frame arrives in pieces.
 */
function decode(buffer) {
	if (buffer.length < 2) return null;
	const opcode = buffer[0] & 0x0f;
	const masked = (buffer[1] & 0x80) !== 0;
	let length = buffer[1] & 0x7f;
	let offset = 2;

	if (length === 126) {
		if (buffer.length < offset + 2) return null;
		length = buffer.readUInt16BE(offset);
		offset += 2;
	} else if (length === 127) {
		if (buffer.length < offset + 8) return null;
		const big = buffer.readBigUInt64BE(offset);
		// A frame this large is not something a pairing exchange produces.
		if (big > 8n * 1024n * 1024n) return null;
		length = Number(big);
		offset += 8;
	}

	const maskLength = masked ? 4 : 0;
	if (buffer.length < offset + maskLength + length) return null;

	const mask = masked ? buffer.subarray(offset, offset + 4) : null;
	offset += maskLength;
	const payload = Buffer.from(buffer.subarray(offset, offset + length));
	if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];

	return { opcode, payload, size: offset + length };
}

/** Server-to-client, so never masked. */
function encode(payload, opcode = 0x1) {
	const length = payload.length;
	let header;
	if (length < 126) {
		header = Buffer.from([0x80 | opcode, length]);
	} else if (length < 65536) {
		header = Buffer.alloc(4);
		header[0] = 0x80 | opcode;
		header[1] = 126;
		header.writeUInt16BE(length, 2);
	} else {
		header = Buffer.alloc(10);
		header[0] = 0x80 | opcode;
		header[1] = 127;
		header.writeBigUInt64BE(BigInt(length), 2);
	}
	return Buffer.concat([header, payload]);
}

server.listen(PORT, "0.0.0.0", () => {
	process.stdout.write(`lyra-relay listening on :${PORT}\n`);
});
