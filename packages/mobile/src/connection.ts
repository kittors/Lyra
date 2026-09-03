/**
 * The desktop this phone is paired with: what it is, and whether it is there.
 *
 * Everything that used to live around a `SyncClient` — sessions, messages, tool runs, approvals —
 * is gone with the screen that drew them. The phone shows the desktop's own interface now
 * (`app/desk.tsx`), and that interface talks to the desktop directly through the bridge. There is
 * nothing left for this side to model except the address.
 *
 * So this file is two things: the shape of a connection, and the two questions asked before one is
 * saved. Both of those are about *pairing*, which is the one job this app still has of its own.
 */

import { roomFor } from "./sha256.ts";

export interface Connection {
	host: string;
	port: number;
	token: string;
	/**
	 * Speak https/wss rather than http/ws.
	 *
	 * A desktop on the LAN is plain http — it is on the same network and there is no certificate to
	 * have. Anything reached through a reverse proxy or a tunnel is almost always TLS, and guessing
	 * wrong is not a degraded connection but no connection: http against a TLS port hangs until it
	 * times out, and the error names neither cause.
	 */
	tls?: boolean;
	/**
	 * This endpoint is a relay to meet at, not the desktop itself.
	 *
	 * Kept so the UI can say which way it is connected — 「通过中转」 is worth showing, because it
	 * explains both the extra hop of latency and why it still works away from home.
	 */
	relay?: boolean;
	/**
	 * The desktop's platform, learned when pairing.
	 *
	 * The renderer reads it before its first paint to decide where the window controls go and which
	 * shortcut glyphs to print. It describes the machine the session runs on, not this phone.
	 */
	platform?: string;
}

/** The origin the WebView loads the interface from. */
export function originOf(connection: Connection): string {
	return `${connection.tls ? "https" : "http"}://${connection.host}:${connection.port}`;
}

/**
 * Is there a Lyra listening there?
 *
 * `/api/ping` is the one route that answers without a token — it exists so this question can be
 * asked before pairing rather than after. It says a sync server is up; it says nothing about
 * whether the token is right, which is what `verifyToken` is for.
 */
export async function pingDesktop(host: string, port: number, tls = false): Promise<boolean> {
	try {
		const response = await fetch(`${tls ? "https" : "http"}://${host}:${port}/api/ping`, {
			signal: AbortSignal.timeout(5000),
		});
		if (!response.ok) return false;
		const body = (await response.json()) as { app?: string };
		return body.app === "lyra";
	} catch {
		return false;
	}
}

/**
 * Does this token actually open anything?
 *
 * Asked of a route that needs it, because that is the only way to find out. Pairing with a wrong
 * token otherwise succeeds and produces a WebView that loads the interface and then fails every
 * call inside it — an error a long way from its cause.
 */
export async function verifyToken(connection: Connection): Promise<boolean> {
	try {
		const response = await fetch(`${originOf(connection)}/api/sessions`, {
			headers: { authorization: `Bearer ${connection.token}` },
			signal: AbortSignal.timeout(8000),
		});
		return response.ok;
	} catch {
		return false;
	}
}

/**
 * Whether a relay is reachable and will let us into our room.
 *
 * Not `pingDesktop`: a relay is not a sync server. It answers no HTTP route this app knows and has
 * no opinion about the token, so the question it *can* answer is whether the desktop is in the room
 * — which is `ready`, and is a stronger answer than either half alone. It says the relay works,
 * that the desktop is dialled in, and that both ends derived the same room, which they can only do
 * from the same token. That last part is why this doubles as the token check on this path.
 *
 * `waiting` is not enough: it means the room opened and nobody else is in it, which is equally what
 * a wrong token looks like — a room of one, belonging to nobody.
 */
export function pingRelay(host: string, port: number, tls: boolean, token: string): Promise<boolean> {
	return new Promise((resolve) => {
		let socket: WebSocket;
		try {
			socket = new WebSocket(`${tls ? "wss" : "ws"}://${host}:${port}`);
		} catch {
			resolve(false);
			return;
		}

		const done = (ok: boolean) => {
			clearTimeout(timer);
			try {
				socket.close();
			} catch {
				/* already gone */
			}
			resolve(ok);
		};
		// Longer than the direct ping: this crosses the internet twice, and the relay itself allows
		// ten seconds before it hangs up on a socket that has said nothing.
		const timer = setTimeout(() => done(false), 8000);

		socket.onopen = () => socket.send(JSON.stringify({ type: "hello", room: roomFor(token) }));
		socket.onerror = () => done(false);
		socket.onclose = () => done(false);
		socket.onmessage = (event) => {
			let message: { type?: string };
			try {
				message = JSON.parse(String(event.data)) as typeof message;
			} catch {
				return;
			}
			if (message.type === "ready") done(true);
			// `waiting` is not an answer yet — the desktop may still be dialling in — so it is left
			// to the timeout. `refused` (room-full, bad hello) is a definite no.
			else if (message.type === "refused") done(false);
		};
	});
}
