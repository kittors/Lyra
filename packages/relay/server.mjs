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
 * No dependencies, one file, Node 18.17+. `node server.mjs`, `PORT` to move it.
 */

import { createHash, randomUUID } from "node:crypto";
import { createServer, validateHeaderValue } from "node:http";

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
const MAX_ASSET_RESPONSE_BYTES = 7 * 1024 * 1024;
const ASSET_TIMEOUT_MS = 15_000;
const RATE_WINDOW_MS = 60_000;

/**
 * 一条连接上还没凑成完整帧的字节，最多攒到这里。
 *
 * `MAX_BYTES_PER_CONNECTION` 管的是一条连接一共转了多少，它不看这些字节是不是还堆在内存里。
 * 中间那个缺口是这样的：`decode` 对声明长度超过 8 MiB 的帧返回 `null`，而 `onData` 把 `null`
 * 读成「这块还不完整，等下一块」——于是缓冲再也不会被清空，对面只要一直发，进程的内存就一直
 * 涨。不需要是攻击，一个把长度字段写错了的客户端就能做到。
 *
 * 8 MiB 是 `decode` 允许的最大帧，加一点富余放帧头（最多 14 字节）和紧跟着的下一个帧头。攒到
 * 这个数还没成帧，说明对面发来的不是这个协议里的东西，等下去不会变好。
 */
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024 + 64;

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
/** Renderer capability → the desktop socket that can read that public build. */
const assetHosts = new Map();
/** Asset request id → the HTTP response waiting for the desktop. */
const assetRequests = new Map();

const WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const server = createServer((req, res) => {
	if (req.url === "/health") {
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify({ app: "lyra-relay", version: 1, rooms: rooms.size }));
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
		role: null,
		assetKey: null,
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

	/*
	 * 攒不出帧的字节有个上限，越过就断。
	 *
	 * 放在解码之前：要挡的正是那种解码永远不会成功的情况，解完再查等于永远查不到。断开而不是
	 * 丢弃缓冲——半截帧丢掉之后，后面的字节会从一个不是帧边界的位置开始读，那比断开更难查。
	 */
	if (client.buffer.length > MAX_BUFFERED_BYTES) {
		client.buffer = Buffer.alloc(0);
		return client.socket.destroy();
	}

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

		if (client.role === "desktop" && frame.opcode === 0x1 && acceptAssetResponse(client, frame.payload)) {
			continue;
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
	for (const peer of members) send(peer, { type: "peer-left" });
	if (members.size === 0) rooms.delete(client.room);
	client.room = null;
	client.role = null;
	client.assetKey = null;
}

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
	if (payload.length > MAX_ASSET_RESPONSE_BYTES) return false;
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
	process.stdout.write(`lyra-relay listening on :${server.address().port}\n`);
});
