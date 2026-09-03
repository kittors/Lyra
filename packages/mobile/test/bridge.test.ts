/**
 * The `window.lyra` the phone hands the desktop's own interface.
 *
 * Everything the renderer does goes through this object, and it fails in the least helpful way
 * available: a missing method is a TypeError thrown inside a React render, which the error
 * boundary turns into a blank screen with a message about the renderer rather than about the
 * connection. So the shape matters as much as the behaviour, and the shape is what this checks.
 *
 * Run against the generated source in a sandbox rather than in a WebView, because what is being
 * tested is the script — that it parses, that it builds the object it claims to, and that the
 * floor under it answers in the way each kind of caller expects.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { bridgeScript } from "../src/bridge.ts";
import { roomFor } from "../src/sha256.ts";
import type { Connection } from "../src/connection.ts";

const LAN: Connection = { host: "192.168.1.5", port: 4517, token: "tok", platform: "darwin" };

/**
 * Run the bridge with a stubbed browser around it, and return what it installed.
 *
 * `WebSocket` and `fetch` are replaced so the script's own connect-on-load does not reach the
 * network; the calls it makes are recorded instead.
 */
function install(
	connection: Connection = LAN,
	/** How the desktop answers an RPC. Defaults to a plain success. */
	reply: (body: { method?: string }) => unknown = () => ({ ok: true, value: "答案" }),
) {
	/** What the page sent down the socket, parsed. RPC goes this way now, not as a POST. */
	const calls: { url: string; body: unknown }[] = [];
	const sockets: string[] = [];

	// The sockets the script opened, kept so a test can drive the live one.
	const opened: {
		onopen: (() => void) | null;
		onmessage: ((event: { data: string }) => void) | null;
	}[] = [];
	const scope = {
		document: { documentElement: { setAttribute() {} }, addEventListener() {} },
		WebSocket: class {
			// 1 = OPEN. The script checks this before sending and queues if it is not open, which is
			// the behaviour that makes the renderer's first frame work — so a fake that is never
			// open would leave every call queued forever.
			readyState = 1;
			onopen: (() => void) | null = null;
			onmessage: ((event: { data: string }) => void) | null = null;
			onclose: (() => void) | null = null;
			onerror: (() => void) | null = null;
			constructor(url: string) {
				sockets.push(url);
				opened.push(this);
			}
			send(frame: string) {
				const body = JSON.parse(frame) as { type?: string; id?: string };
				calls.push({ url: sockets[sockets.length - 1], body });
				// Answer an RPC the way the desktop would, so the promise settles.
				if (body.type === "rpc") {
					const answer = reply(body as { method?: string }) as object;
					queueMicrotask(() =>
						this.onmessage?.({ data: JSON.stringify({ type: "rpc_result", id: body.id, ...answer }) }),
					);
				}
			}
			close() {}
		},
		// Kept only so the script has one if it ever reaches for it; RPC no longer goes this way.
		fetch: async () => ({ ok: true, json: async () => ({ ok: true, value: null }) }),
		setTimeout: () => 0,
		navigator: { clipboard: { writeText() {} } },
	} as Record<string, unknown>;

	const window: Record<string, unknown> = scope;
	scope.window = window;

	// Evaluated with `window` and the browser globals in scope, which is what a WebView provides.
	const run = new Function("window", "document", "WebSocket", "fetch", "setTimeout", "navigator", bridgeScript(connection));
	run(window, scope.document, scope.WebSocket, scope.fetch, scope.setTimeout, scope.navigator);

	/*
	 * The socket finishing its handshake, which the script waits for before sending anything.
	 *
	 * Done here rather than in the fake's constructor: at that point the script has not yet assigned
	 * the socket to its own variable, so a hello sent from inside it would be queued rather than
	 * sent — which is the very thing these tests are checking.
	 */
	opened.at(-1)?.onopen?.();

	return {
		lyra: window.lyra as Record<string, never>,
		calls,
		sockets,
		/** Deliver a message as the desktop's sync server would, down the most recent socket. */
		receive(message: unknown) {
			opened.at(-1)?.onmessage?.({ data: JSON.stringify(message) });
		},
	};
}

test("the script parses and installs an object", () => {
	const { lyra } = install();
	assert.equal(typeof lyra, "object");
	assert.equal((lyra as { platform: string }).platform, "darwin");
	assert.equal((lyra as { host: string }).host, "mobile");
});

test("the socket points at the desktop, carrying the token", () => {
	const { sockets } = install();
	assert.equal(sockets.length, 1);
	assert.match(sockets[0], /^ws:\/\/192\.168\.1\.5:4517\/ws\?token=tok$/);
});

test("a TLS connection speaks wss and https", () => {
	const { sockets, lyra } = install({ ...LAN, tls: true });
	assert.match(sockets[0], /^wss:\/\//);
	void (lyra as unknown as { settings: { get(): Promise<unknown> } }).settings.get();
});

test("a call becomes one frame on the socket, with the method and args intact", async () => {
	/*
	 * Over the socket rather than as a POST, and that is the point: a relay joins two WebSockets and
	 * copies bytes between them, so an HTTP request has nowhere to go through one. Everything down
	 * the same pipe is what lets the same bridge work on a local network and through a relay without
	 * knowing which it is on.
	 */
	const page = install();
	const api = page.lyra as unknown as { sessions: { transcript(a: string, b: string): Promise<unknown> } };
	const answer = await api.sessions.transcript("p1", "s1");

	const sent = page.calls.map((c) => c.body as { type?: string; method?: string; args?: unknown[]; id?: string });
	const rpc = sent.filter((frame) => frame.type === "rpc");
	assert.equal(rpc.length, 1, "一次调用只发一帧");
	assert.equal(rpc[0].method, "sessions.transcript");
	assert.deepEqual(rpc[0].args, ["p1", "s1"]);
	assert.equal(typeof rpc[0].id, "string", "要带一个 id，答复靠它对上");
	assert.equal(answer, "答案");
});

test("two calls in flight at once do not answer each other", async () => {
	// The id is what keeps them apart; without it the second answer would settle the first promise.
	const answers = new Map([
		["sessions.list", "列表"],
		["settings.get", "设置"],
	]);
	const page = install(LAN, (body) => ({ ok: true, value: answers.get(body.method ?? "") ?? null }));
	const lyra = page.lyra as unknown as {
		sessions: { list(): Promise<unknown> };
		settings: { get(): Promise<unknown> };
	};

	const [list, settings] = await Promise.all([lyra.sessions.list(), lyra.settings.get()]);
	assert.equal(list, "列表");
	assert.equal(settings, "设置");
});

test("every group the renderer reaches for is present", () => {
	// Not an arbitrary list: these are the ones `store.ts` and its slices touch on the startup
	// path, and a missing one is a blank screen rather than a missing feature.
	const lyra = install().lyra as unknown as Record<string, unknown>;
	for (const group of ["settings", "sessions", "agent", "workspace", "subAgents", "sideChat", "git", "system", "clipboard"]) {
		assert.equal(typeof lyra[group], "object", `缺少 ${group}`);
	}
});

test("a method nobody wrote down still answers, rather than throwing", async () => {
	/*
	 * The interface is 177 methods and grows; the phone must degrade when the desktop gains one
	 * rather than break. `onSomething` gets an unsubscribe function because that is what its
	 * callers store and later call; everything else resolves to null, which is what every caller
	 * already handles as "no data".
	 */
	const lyra = install().lyra as unknown as Record<string, Record<string, (...args: unknown[]) => unknown>>;

	const unsubscribe = lyra.updates.onProgress(() => {});
	assert.equal(typeof unsubscribe, "function", "订阅要返回退订函数");
	assert.doesNotThrow(() => (unsubscribe as () => void)());

	assert.equal(await lyra.updates.somethingNew(), null);
	assert.equal(await lyra.aWholeNewGroup.aWholeNewMethod(), null);
});

test("an unlisted method on the root is callable, not just reachable", async () => {
	/*
	 * Found on a real phone, not here: the interface carries methods and groups side by side at the
	 * top level — `setWindowTheme` is a method, `settings` is a group — and nothing in the name says
	 * which. A floor that assumed "group" handed back an object, and the app died on the first
	 * top-level method the desktop called, before anything had rendered.
	 */
	const lyra = install().lyra as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
	assert.equal(await lyra.setWindowTheme({ color: "#111", symbolColor: "#eee" }), null);
});

test("the same name works as a group if that is how it is used", async () => {
	// The other half of the same problem: one floor has to answer both ways, because the caller
	// decides which it is and the bridge finds out afterwards.
	const lyra = install().lyra as unknown as Record<string, Record<string, () => Promise<unknown>>>;
	assert.equal(await lyra.somethingNew.deeper.stillFine(), null);
});

test("awaiting something that fell through the floor settles", async () => {
	/*
	 * `await` looks for `.then`, and the floor answers every name — so without a carve-out it would
	 * hand back a function, `await` would call it expecting a resolver, and the turn would hang
	 * with no error to show for it.
	 */
	const lyra = install().lyra as unknown as Record<string, unknown>;
	const reached = await (lyra.neverHeardOfIt as Promise<unknown>);
	assert.equal(typeof reached, "function", "兜底节点本身是可调用的，await 它只会原样拿回来");
});

test("a subscription on the root still returns an unsubscribe", () => {
	// `onFullScreenChange` is read at mount and its result is stored to be called on unmount.
	const lyra = install().lyra as unknown as Record<string, (h: () => void) => unknown>;
	const off = lyra.onFullScreenChange(() => {});
	assert.equal(typeof off, "function");
	assert.doesNotThrow(() => (off as () => void)());
});

test("subscribing to agent events hands back a working unsubscribe", () => {
	const lyra = install().lyra as unknown as {
		agent: { onEvent(handler: (payload: unknown) => void): () => void };
	};
	let seen = 0;
	const off = lyra.agent.onEvent(() => {
		seen++;
	});
	assert.equal(typeof off, "function");
	off();
	assert.equal(seen, 0);
});

test("a refused method reads as nothing, not as an error", async () => {
	/*
	 * Half of what the renderer calls has no meaning on a phone and is absent from the desktop's
	 * allowlist. Throwing would turn a page that should quietly omit a feature into a crash.
	 */
	const page = install(LAN, () => ({ ok: false, error: "method-not-allowed" }));
	const lyra = page.lyra as unknown as { sessions: { transcript(a: string, b: string): Promise<unknown> } };
	// A method that does go over RPC, so the server's refusal is what is being read.
	assert.equal(await lyra.sessions.transcript("p", "s"), null);
});

test("a genuine failure does throw, so it is not mistaken for absence", async () => {
	const page = install(LAN, () => ({ ok: false, error: "会话不存在" }));
	const lyra = page.lyra as unknown as { sessions: { transcript(a: string, b: string): Promise<unknown> } };
	await assert.rejects(() => lyra.sessions.transcript("p", "s"), /会话不存在/);
});

test("the token is escaped into the socket URL", () => {
	const { sockets } = install({ ...LAN, token: "a b&c" });
	assert.match(sockets[0], /token=a%20b%26c$/);
});

test("the generated script has no stray backtick in it", () => {
	/*
	 * The bridge is one long template literal, so a backtick anywhere inside it — including inside a
	 * comment, which is where it keeps happening — ends the string early and the whole module stops
	 * parsing. It has cost two rounds of "why is the file failing rather than the test", both times
	 * from writing `inert` in prose out of habit.
	 *
	 * Checked on the *output* rather than the source, because that is what has to survive: an
	 * escaped backtick in the source is fine and appears here as a plain one.
	 */
	const script = bridgeScript(LAN);
	assert.doesNotThrow(() => new Function(script), "生成的脚本本身要能解析");

	// And it really is one template literal in the source, which is what makes the above a risk
	// rather than a curiosity.
	assert.ok(script.startsWith("(() => {"), "脚本应当是一整段立即执行函数");
});

/*
 * The half of Android's back button that lives in the page.
 *
 * There is no Android emulator on this machine, so this is the closest thing to running it: the
 * script is evaluated with a document that can be changed underneath it, and what it reports is
 * read back. `back.test.ts` covers what the native side does with those numbers.
 */

/** A document with a mutable set of elements, and a MutationObserver that fires on demand. */
function pageWith(elements: { attrs: string[] }[]) {
	const posted: string[] = [];
	// Every observer the script installs, fired together: which one is which is the script's
	// business, and both of them already ignore a change that did not change their own answer.
	const observers: (() => void)[] = [];
	const listeners: Record<string, (() => void)[]> = {};

	const element = (el: { attrs: string[] }) => ({ hasAttribute: (name: string) => el.attrs.includes(name) });
	let dark = true;
	const documentElement = {
		setAttribute() {},
		classList: { contains: (name: string) => (name === "dark" ? dark : !dark) },
	};
	const document = {
		documentElement,
		body: {},
		querySelectorAll(selector: string) {
			const wanted = selector === '[data-pane="drawer"]' ? "data-pane" : "aria-modal";
			return elements.filter((el) => el.attrs.includes(wanted)).map(element);
		},
		addEventListener(type: string, handler: () => void) {
			(listeners[type] ??= []).push(handler);
		},
		dispatchEvent: () => true,
	};

	const scope = {
		document,
		WebSocket: class {
			close() {}
		},
		fetch: async () => ({ ok: true, json: async () => ({ ok: true, value: null }) }),
		setTimeout: () => 0,
		navigator: {},
		getComputedStyle: () => ({ getPropertyValue: () => (dark ? "#171717" : "#ffffff") }),
		KeyboardEvent: class {
			type: string;
			constructor(type: string) {
				this.type = type;
			}
		},
		MutationObserver: class {
			constructor(handler: () => void) {
				observers.push(handler);
			}
			observe() {}
		},
	} as Record<string, unknown>;

	const window: Record<string, unknown> = scope;
	scope.window = window;
	window.ReactNativeWebView = { postMessage: (data: string) => posted.push(data) };

	const run = new Function(
		"window",
		"document",
		"WebSocket",
		"fetch",
		"setTimeout",
		"navigator",
		"getComputedStyle",
		"KeyboardEvent",
		"MutationObserver",
		bridgeScript(LAN),
	);
	run(
		window,
		document,
		scope.WebSocket,
		scope.fetch,
		scope.setTimeout,
		scope.navigator,
		scope.getComputedStyle,
		scope.KeyboardEvent,
		scope.MutationObserver,
	);

	/** Messages of one kind, in order — the page reports more than one thing down this channel. */
	const of = (type: string) =>
		posted.map((raw) => JSON.parse(raw) as { type: string }).filter((message) => message.type === type);

	return {
		window,
		posted,
		of,
		/** Change what is on the page, then let the observers notice. */
		change(next: { attrs: string[] }[]) {
			elements = next;
			for (const fire of observers) fire();
		},
		/** Switch the page's theme, as the desktop's settings would. */
		setDark(next: boolean) {
			dark = next;
			for (const fire of observers) fire();
		},
	};
}

test("the page reports how many layers it has open", () => {
	const page = pageWith([{ attrs: ["data-pane", "aria-modal", "inert"] }]);
	assert.deepEqual(page.of("layers")[0], { type: "layers", depth: 0 }, "关着的抽屉不算一层");

	page.change([{ attrs: ["data-pane", "aria-modal"] }]);
	assert.deepEqual(page.of("layers")[1], { type: "layers", depth: 1 }, "抽屉打开了要报上去");

	page.change([{ attrs: ["data-pane", "aria-modal"] }, { attrs: ["aria-modal"] }]);
	assert.deepEqual(page.of("layers")[2], { type: "layers", depth: 2 });
});

test("an unchanged depth is not reported again", () => {
	/*
	 * The observer watches the whole document, and a streaming reply changes it constantly. Posting
	 * on every mutation would put a message across the bridge for every token.
	 */
	const page = pageWith([{ attrs: ["data-pane", "aria-modal", "inert"] }]);
	const before = page.of("layers").length;
	page.change([{ attrs: ["data-pane", "aria-modal", "inert"] }]);
	page.change([{ attrs: ["data-pane", "aria-modal", "inert"] }]);
	assert.equal(page.of("layers").length, before, "层数没变就不该再发");
});

test("closing a layer is offered as a function the native side can call", () => {
	// Android's back button reaches the page through this and nothing else.
	const page = pageWith([]);
	assert.equal(typeof page.window.__lyraBack, "function");
	assert.doesNotThrow(() => (page.window.__lyraBack as () => void)());
});

test("the page reports its theme, so the phone's own chrome can match", () => {
	/*
	 * The status bar and the strips behind the notch and home indicator are painted natively, and
	 * nothing tells them the page went light. Left alone that is white status text on a white page,
	 * with a dark border around it.
	 */
	const page = pageWith([]);
	assert.deepEqual(page.of("theme")[0], { type: "theme", dark: true, shell: "#171717" });

	page.setDark(false);
	assert.deepEqual(page.of("theme")[1], { type: "theme", dark: false, shell: "#ffffff" });
});

test("a class change that is not a theme change is not reported", () => {
	// The observer fires on any class change to the root, and the renderer toggles several.
	const page = pageWith([]);
	const before = page.of("theme").length;
	page.setDark(true);
	assert.equal(page.of("theme").length, before, "主题没变就不该再发");
});

/*
 * The names on the wire, which are a contract between two files that never import each other.
 *
 * `sync-server.ts` picks them and this picks them again, and nothing checks that the two agree —
 * they did not. The desktop broadcast `settings_changed` and the phone listened for `settings`, so
 * every settings change was sent, received, and silently dropped: switch the desktop to a light
 * theme with a phone in your hand and it stayed dark, with no error anywhere to say why.
 */

test("a settings change from the desktop reaches whoever subscribed", () => {
	const page = install();
	const lyra = page.lyra as unknown as { settings: { onChanged(fn: (s: unknown) => void): () => void } };

	const seen: unknown[] = [];
	lyra.settings.onChanged((next) => seen.push(next));

	// Exactly the shape `SyncServer.broadcastSettings` puts on the wire.
	page.receive({ type: "settings_changed", settings: { appearance: { theme: "light" } } });

	assert.deepEqual(seen, [{ appearance: { theme: "light" } }]);
});

test("an agent event still reaches its own subscribers", () => {
	// The other half of the same contract, and the one that was already right.
	const page = install();
	const lyra = page.lyra as unknown as { agent: { onEvent(fn: (e: unknown) => void): () => void } };

	const seen: unknown[] = [];
	lyra.agent.onEvent((event) => seen.push(event));
	page.receive({ type: "agent_event", sessionId: "s1", event: { type: "text", text: "嗨" } });

	assert.deepEqual(seen, [{ sessionId: "s1", event: { type: "text", text: "嗨" } }]);
});

test("a message of a kind this version does not know is ignored", () => {
	// The desktop may be newer than the phone; an unknown type is not a reason to throw inside a
	// socket handler, where nothing would catch it.
	const page = install();
	assert.doesNotThrow(() => page.receive({ type: "something_from_the_future", payload: 1 }));
	assert.doesNotThrow(() => page.receive("not json at all"));
});

/*
 * The relay path, which changes exactly one thing: where the socket goes.
 *
 * Direct, it carries the token in the query and the desktop checks it. Through a relay there is
 * nothing to authenticate to — the relay joins two sockets by room and copies bytes — so the room
 * is the address, and the room is the token's SHA-256. Everything after the hello is the same
 * protocol on both paths, which is what keeps this to one bridge rather than two.
 */

const RELAY: Connection = { host: "relay.example.com", port: 9977, token: "tok", platform: "darwin", relay: true };

test("a relayed connection dials the relay, not a desktop", () => {
	const { sockets } = install(RELAY);
	assert.equal(sockets.length, 1);
	// No /ws path and no token in the URL: neither means anything to a relay, and the token must
	// not be handed to one.
	assert.equal(sockets[0], "ws://relay.example.com:9977");
	assert.ok(!sockets[0].includes("tok"), "令牌不能出现在中转的地址里");
});

test("it claims the room before saying anything else", () => {
	/*
	 * The relay closes a socket that has not named a room within ten seconds, and refuses anything
	 * that is not a well-formed hello.
	 */
	const page = install(RELAY);
	const first = page.calls[0]?.body as { type?: string; room?: string };
	assert.equal(first?.type, "hello");
	assert.equal(first?.room, roomFor("tok"));
	assert.match(String(first?.room), /^[a-f0-9]{64}$/);
});

test("calls wait for the far end to arrive", () => {
	/*
	 * A frame sent into a room of one is dropped by the relay, not held — so a call made before the
	 * desktop joins would be lost, and the promise would sit until it timed out. The queue drains on
	 * `ready` instead.
	 */
	const page = install(RELAY);
	const lyra = page.lyra as unknown as { sessions: { list(): Promise<unknown> } };
	void lyra.sessions.list();

	const kinds = () => page.calls.map((c) => (c.body as { type?: string }).type);
	assert.deepEqual(kinds(), ["hello"], "还没 ready，调用要压着");

	page.receive({ type: "ready" });
	assert.deepEqual(kinds(), ["hello", "rpc"], "对端到了，压着的调用就发出去");
});

test("a direct connection does not wait for anything", () => {
	// There is no room and no far end to wait for; the desktop is already listening.
	const page = install(LAN);
	const lyra = page.lyra as unknown as { sessions: { list(): Promise<unknown> } };
	void lyra.sessions.list();
	assert.deepEqual(
		page.calls.map((c) => (c.body as { type?: string }).type),
		["rpc"],
		"直连不发 hello，也不用等",
	);
});
