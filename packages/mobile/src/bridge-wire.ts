/**
 * The phone half of wire 2, as source for the bridge to embed.
 *
 * The desktop half is `desktop/electron/sync-wire.ts`, and the protocol is written up there and in
 * docs/adr/0028-sync-link-streams-large-data.md. This is the same protocol in the WebView's own
 * JavaScript: large messages as acknowledged binary parts, a window on how much may be in flight, and
 * file uploads read a slice at a time from the picked `File`.
 *
 * Source text rather than a module for the reason the bridge is: it runs in the WebView, and the only
 * way across is text. Kept apart from `bridge.ts` so it can be read — and tested — on its own:
 * `createWire(host)` is a factory whose only view of the bridge is the `host` it is handed.
 *
 * The part size and pacing come from measuring Chromium (the Android WebView), not from taste.
 * Chromium moves outgoing messages through a 64 KiB pipe and splits any that straddle a read into
 * continuation frames — under load it split 387 of 400 back-to-back 64 KiB messages. The desktop and
 * a version 2 relay put fragments back together, so on those links parts are 256 KiB and several may
 * be queued. A version 1 relay re-sent every fragment as a whole message and the desktop closed the
 * link on it; through a relay not known to be version 2, parts are 48 KiB and each waits for
 * `bufferedAmount` to reach zero — one part in the pipe at a time, with room left for the small
 * messages that follow it, was never split in 500 sends. Nothing else waits: acks, pings and calls
 * go out as soon as they are made.
 */

export function wireSource(): string {
	return `function createWire(host) {
	var VERSION = 2;
	/** Upward part payload; see the note on Chromium at the top of bridge-wire.ts. */
	var PART_PACED = 49152;
	var PART_FREE = 262144;
	/** Queued-but-unsent bytes allowed on a link that does not need pacing. */
	var LOW_WATER = 524288;
	/** Messages larger than this go in parts, once the desktop has said it reads them. */
	var THRESHOLD = 49152;
	/** Unacknowledged bytes allowed in flight, uploads and messages together. */
	var WINDOW = 1048576;
	/** The largest message this page will accept from the desktop in parts. */
	var MAX_INBOUND = 268435456;
	var PROGRESS_MS = 150;
	/** An upload waiting this long for the link to come back gives up and says so. */
	var PAUSE_LIMIT_MS = 300000;
	var inflates = (function () {
		try { return typeof DecompressionStream === "function" && Boolean(new DecompressionStream("deflate-raw")); } catch (error) { return false; }
	})();
	var encoder = typeof TextEncoder === "function" ? new TextEncoder() : null;
	var decoder = typeof TextDecoder === "function" ? new TextDecoder() : null;

	var desktopWire = 0;
	var maxUpload = 0;
	var nextSid = 1;
	var outbound = [];
	var inbound = new Map();
	var ordered = [];
	var orderedBusy = false;
	var chain = Promise.resolve();
	var decoding = 0;
	var uploads = new Map();
	var nextUpload = 0;
	var listeners = new Set();
	var pumpTimer = null;
	/*
	 * Paced through a relay until it says it is version 2. Its own /health answers on the origin
	 * this page was served from; a relay that does not answer, or answers 1, keeps the pacing.
	 */
	var paced = Boolean(host.relay);
	if (paced && typeof fetch === "function") {
		fetch(host.origin + "/health").then(function (response) { return response.json(); }).then(function (health) {
			if (health && health.app === "lyra-relay" && Number(health.version) >= 2) paced = false;
		}, function () {});
	}
	function partSize() { return paced ? PART_PACED : PART_FREE; }

	function socket() { return host.socket(); }
	function usable() { var current = socket(); return host.linked() && current && current.readyState === 1; }
	function sendRaw(data) { var current = socket(); if (current && current.readyState === 1) current.send(data); }
	function control(message) { sendRaw(JSON.stringify(message)); }

	function frame(kind, sid, offset, payload) {
		var bytes = new Uint8Array(13 + payload.byteLength);
		var view = new DataView(bytes.buffer);
		view.setUint8(0, kind);
		view.setUint32(1, sid);
		view.setFloat64(5, offset);
		bytes.set(payload, 13);
		return bytes;
	}

	// -- Progress, for whatever draws it -------------------------------------------------

	function emit(detail) {
		listeners.forEach(function (listener) { try { listener(detail); } catch (error) {} });
		try { window.dispatchEvent(new CustomEvent("lyra:transfer", { detail: detail })); } catch (error) {}
	}

	function throttled(entry, force) {
		var now = Date.now();
		if (!force && now - (entry.lastEmit || 0) < PROGRESS_MS) return false;
		entry.lastEmit = now;
		return true;
	}

	function uploadProgress(state, force) {
		if (!throttled(state, force || state.status !== "active")) return;
		var detail = { id: state.id, kind: "upload", direction: "up", name: state.name, done: state.committed, total: state.size, state: state.status };
		if (state.error) detail.error = state.error;
		if (state.onProgress) { try { state.onProgress(detail); } catch (error) {} }
		emit(detail);
	}

	function streamProgress(stream, direction, done, state) {
		if (!throttled(stream, state !== "active")) return;
		emit({ id: direction + stream.sid, kind: "message", direction: direction, name: stream.label || null, done: done, total: stream.size, state: state });
	}

	// -- Inbound: whole messages, in the order they finished arriving ---------------------

	/*
	 * A message that needs inflating is delivered when it has been, and everything after it waits
	 * its turn — an agent's events must not overtake one another because one of them was large.
	 * With nothing being inflated, delivery is immediate, exactly as before wire 2.
	 */
	function deliver(message) {
		if (decoding === 0) { host.dispatch(message); return; }
		chain = chain.then(function () { host.dispatch(message); });
	}

	function deliverLater(pending) {
		decoding++;
		chain = chain.then(function () { return pending; }).then(function (message) {
			decoding--;
			if (message) host.dispatch(message);
		}, function () { decoding--; });
	}

	function announce(message) {
		var sid = Number(message.s);
		var size = Number(message.size);
		if (!(size > 0) || size > MAX_INBOUND) { control({ type: "stream_abort", s: sid, reason: "refused" }); return; }
		var stream = { sid: sid, size: size, compressed: message.z === 1, buffer: new Uint8Array(size), received: 0, rpc: typeof message.for === "string" ? message.for : null, label: typeof message.label === "string" ? message.label : null, lastEmit: 0 };
		inbound.set(sid, stream);
		if (stream.rpc) host.touch(stream.rpc);
		streamProgress(stream, "down", 0, "active");
	}

	function receive(data) {
		var bytes = new Uint8Array(data);
		if (bytes.length < 13) return;
		var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		if (view.getUint8(0) !== 1) return;
		var sid = view.getUint32(1);
		var offset = view.getFloat64(5);
		var payload = bytes.subarray(13);
		var stream = inbound.get(sid);
		if (!stream || offset !== stream.received || stream.received + payload.length > stream.size) return;
		stream.buffer.set(payload, stream.received);
		stream.received += payload.length;
		control({ type: "ack", s: sid, n: stream.received });
		if (stream.rpc) host.touch(stream.rpc);
		if (stream.received < stream.size) { streamProgress(stream, "down", stream.received, "active"); return; }
		inbound.delete(sid);
		streamProgress(stream, "down", stream.size, "done");
		if (!stream.compressed && decoding === 0) {
			var parsed = parse(decoder.decode(stream.buffer));
			if (parsed) host.dispatch(parsed);
			return;
		}
		deliverLater(decode(stream).then(parse));
	}

	function decode(stream) {
		if (!stream.compressed) return Promise.resolve(decoder.decode(stream.buffer));
		var inflated = new Blob([stream.buffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
		return new Response(inflated).text();
	}

	function parse(text) {
		try { return JSON.parse(text); } catch (error) { return null; }
	}

	// -- Outbound: calls in order, large ones in parts ------------------------------------

	/*
	 * Calls keep their order — an abort must not overtake the prompt it is aborting — so while one
	 * is going out in parts the ones behind it wait. Uploads are not calls and do not wait.
	 */
	function send(text, rpc) {
		if (orderedBusy) { ordered.push({ text: text, rpc: rpc }); return; }
		sendNow(text, rpc);
	}

	function sendNow(text, rpc) {
		if (desktopWire < VERSION || !encoder || text.length <= THRESHOLD / 3) { sendRaw(text); return; }
		var bytes = encoder.encode(text);
		if (bytes.length <= THRESHOLD) { sendRaw(text); return; }
		var sid = nextSid++;
		orderedBusy = true;
		control({ type: "stream", s: sid, size: bytes.length });
		outbound.push({ sid: sid, size: bytes.length, bytes: bytes, sent: 0, acked: 0, rpc: rpc || null, label: null, lastEmit: 0, written: function () {
			orderedBusy = false;
			while (!orderedBusy && ordered.length > 0) { var next = ordered.shift(); sendNow(next.text, next.rpc); }
		} });
		pump();
	}

	function acknowledge(message) {
		var sid = Number(message.s);
		var received = Number(message.n);
		for (var i = 0; i < outbound.length; i++) {
			var stream = outbound[i];
			if (stream.sid !== sid) continue;
			stream.acked = Math.max(stream.acked, Math.min(received, stream.size));
			if (stream.rpc) host.touch(stream.rpc);
			streamProgress(stream, "up", stream.acked, stream.acked >= stream.size ? "done" : "active");
			if (stream.acked >= stream.size) outbound.splice(i, 1);
			break;
		}
		pump();
	}

	function inFlight() {
		var total = 0;
		outbound.forEach(function (stream) { total += stream.sent - stream.acked; });
		uploads.forEach(function (state) { if (state.status === "active") total += state.sent - state.committed; });
		return total;
	}

	/*
	 * One part per turn; on a paced link the next only once the socket has handed the last one on —
	 * see the note on Chromium at the top of bridge-wire.ts. Messages before uploads: a person is
	 * waiting on a call, while an upload is already showing its progress.
	 */
	function pump() {
		if (pumpTimer !== null) return;
		for (;;) {
			var current = socket();
			if (!usable()) return;
			if (current.bufferedAmount > (paced ? 0 : LOW_WATER)) { pumpTimer = setTimeout(function () { pumpTimer = null; pump(); }, 4); return; }
			if (inFlight() >= WINDOW) return;
			var stream = null;
			for (var i = 0; i < outbound.length; i++) { if (outbound[i].sent < outbound[i].size) { stream = outbound[i]; break; } }
			if (stream) {
				var payload = stream.bytes.subarray(stream.sent, stream.sent + partSize());
				current.send(frame(1, stream.sid, stream.sent, payload));
				stream.sent += payload.length;
				if (stream.sent >= stream.size && stream.written) { var written = stream.written; stream.written = null; written(); }
				continue;
			}
			var next = null;
			uploads.forEach(function (state) { if (!next && state.status === "active" && !state.reading && state.sent < state.size) next = state; });
			if (next) feed(next);
			return;
		}
	}

	// -- Uploads -------------------------------------------------------------------------

	function feed(state) {
		state.reading = true;
		var start = state.sent;
		var end = Math.min(state.size, start + partSize());
		var sid = state.sid;
		var current = socket();
		var slice = state.file.slice(start, end);
		var read = typeof slice.arrayBuffer === "function" ? slice.arrayBuffer() : new Response(slice).arrayBuffer();
		read.then(function (buffer) {
			state.reading = false;
			if (state.sid !== sid || socket() !== current || state.status !== "active" || state.sent !== start || !usable()) return;
			current.send(frame(2, sid, start, new Uint8Array(buffer)));
			state.sent = end;
			pump();
		}, function (error) {
			state.reading = false;
			fail(state, "读取文件失败：" + (error && error.message ? error.message : String(error)));
		});
	}

	function sizeText(bytes) {
		if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1).replace(/\\.0$/, "") + " GB";
		if (bytes >= 1048576) return Math.round(bytes / 1048576) + " MB";
		return Math.max(1, Math.round(bytes / 1024)) + " KB";
	}

	function upload(file, options) {
		options = options || {};
		if (!file || typeof file.slice !== "function" || typeof file.size !== "number") return Promise.reject(new Error("没有可以上传的文件"));
		// An old desktop, or one without an upload store: the caller falls back to what it did before.
		if (desktopWire < VERSION || !maxUpload) return Promise.resolve(null);
		if (file.size > maxUpload) return Promise.reject(new Error("文件太大（" + sizeText(file.size) + "），手机一次最多传 " + sizeText(maxUpload)));
		return new Promise(function (resolve, reject) {
			var state = {
				id: "u" + ++nextUpload, file: file, name: options.name || file.name || "upload", size: file.size,
				mimeType: file.type || "application/octet-stream", upload: null, sid: 0, sent: 0, committed: 0,
				reading: false, status: "starting", restarts: 0, error: null, lastEmit: 0, pausedAt: 0, pauseTimer: null,
				onProgress: typeof options.onProgress === "function" ? options.onProgress : null, resolve: resolve, reject: reject,
			};
			uploads.set(state.id, state);
			if (options.signal) {
				if (options.signal.aborted) { cancel(state); return; }
				options.signal.addEventListener("abort", function () { cancel(state); }, { once: true });
			}
			begin(state);
		});
	}

	function begin(state) {
		if (!usable() || desktopWire < VERSION) { pause(state); return; }
		clearTimeout(state.pauseTimer);
		state.pausedAt = 0;
		state.status = "starting";
		state.sid = 0;
		var request = { type: "upload_begin", id: state.id, name: state.name, size: state.size, mimeType: state.mimeType };
		if (state.upload) request.resume = state.upload;
		control(request);
		uploadProgress(state, true);
	}

	function pause(state) {
		if (state.status === "done" || state.status === "failed" || state.status === "cancelled") return;
		state.status = "paused";
		state.sid = 0;
		if (!state.pausedAt) {
			state.pausedAt = Date.now();
			state.pauseTimer = setTimeout(function () {
				if (state.status === "paused") fail(state, "连接中断太久，文件没有传完，请重新发送");
			}, PAUSE_LIMIT_MS);
		}
		uploadProgress(state, true);
	}

	function settle(state, status) {
		clearTimeout(state.pauseTimer);
		state.status = status;
		uploads.delete(state.id);
		uploadProgress(state, true);
	}

	function fail(state, reason) {
		if (!uploads.has(state.id)) return;
		state.error = reason;
		settle(state, "failed");
		state.reject(new Error(reason));
	}

	function cancel(state) {
		if (!uploads.has(state.id)) return;
		if (state.upload && usable()) control({ type: "upload_abort", upload: state.upload });
		settle(state, "cancelled");
		var error = new Error("上传已取消");
		error.name = "AbortError";
		state.reject(error);
	}

	function find(message) {
		if (typeof message.id === "string" && uploads.has(message.id)) return uploads.get(message.id);
		var found = null;
		uploads.forEach(function (state) {
			if (found) return;
			if (typeof message.upload === "string" && state.upload === message.upload) found = state;
			else if (typeof message.sid === "number" && state.sid === message.sid && state.sid !== 0) found = state;
		});
		return found;
	}

	function reason(message) {
		if (message.error === "too-large") return "文件超过了桌面端允许的大小（" + sizeText(maxUpload) + "）";
		if (message.error === "disk-full") return "桌面端磁盘空间不足，放不下这个文件";
		if (message.error === "busy") return "同时上传的文件太多，请等前面的传完再试";
		return "上传失败：" + (message.message || message.error || "未知错误");
	}

	function uploadMessage(message) {
		var state = find(message);
		if (!state) return;
		if (message.type === "upload_state") {
			state.upload = message.upload;
			state.sid = Number(message.sid) || 0;
			state.sent = state.committed = Number(message.offset) || 0;
			state.status = "active";
			uploadProgress(state, true);
			pump();
		} else if (message.type === "upload_ack") {
			var committed = Number(message.n) || 0;
			if (committed > state.committed) { state.committed = committed; state.restarts = 0; }
			uploadProgress(state, false);
			pump();
		} else if (message.type === "upload_done") {
			state.committed = state.size;
			settle(state, "done");
			state.resolve({ id: message.upload, name: message.name, size: message.size, mimeType: message.mimeType, path: message.path });
		} else if (message.type === "upload_error") {
			/*
			 * The desktop lost track of the stream — it restarted, or a relay handed it a new link —
			 * but the file on its disk is still there: ask again, and continue from its length.
			 */
			if ((message.error === "unknown-stream" || message.error === "offset") && state.restarts++ < 3) { begin(state); return; }
			fail(state, reason(message));
		}
	}

	return {
		/** The desktop's hello: whether it reads wire 2, and how large an upload it takes. */
		hello: function (message) {
			desktopWire = Number(message.wire) || 0;
			maxUpload = Number(message.maxUpload) || 0;
			uploads.forEach(function (state) { if (state.status === "paused" || state.status === "starting") begin(state); });
		},
		/** The link is usable. Said first, before any queued call, so their answers can come in parts. */
		opened: function () {
			control({ type: "wire", version: VERSION, inflate: inflates ? ["deflate-raw"] : [] });
		},
		/** The link is gone, or the far end changed. What was in flight belonged to the old one. */
		closed: function () {
			desktopWire = 0;
			outbound = [];
			inbound.clear();
			ordered = [];
			orderedBusy = false;
			uploads.forEach(function (state) { pause(state); });
		},
		/** A text message from the desktop. True when it was the wire's own and needs nothing more. */
		control: function (message) {
			if (message.type === "ack") { acknowledge(message); return true; }
			if (message.type === "stream") { announce(message); return true; }
			if (message.type === "stream_abort") {
				// Refused by the desktop (too large for it). Its call fails on its own deadline; the calls
				// queued behind it must not wait for parts that will never be acknowledged.
				outbound = outbound.filter(function (stream) {
					if (stream.sid !== Number(message.s)) return true;
					if (stream.written) { var written = stream.written; stream.written = null; written(); }
					return false;
				});
				pump();
				return true;
			}
			if (typeof message.type === "string" && message.type.indexOf("upload_") === 0) { uploadMessage(message); return true; }
			return false;
		},
		receive: receive,
		deliver: deliver,
		send: send,
		upload: upload,
		onTransfer: function (listener) { listeners.add(listener); return function () { listeners.delete(listener); }; },
		capabilities: function () { return { wire: desktopWire, uploads: desktopWire >= VERSION && maxUpload > 0, maxUpload: maxUpload }; },
	};
}`;
}
