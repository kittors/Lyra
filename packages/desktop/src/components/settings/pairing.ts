/**
 * What the QR code says, and how to say it for each way of reaching this desktop.
 *
 * Three routes, and the phone cannot work out which one it is on: a LAN address, a public name
 * that a proxy or port forward routes here, and a relay both sides dial out to. They differ in
 * scheme, in port, and in whether a host is even the right question — so the code carries the
 * answer rather than making the phone guess and retry.
 *
 * Kept apart from the component that renders it because the mobile app parses the same string. A
 * format defined inside a React component is a format that gets adjusted when the layout changes.
 */

export type PairingRoute =
	| { kind: "lan"; address: string; port: number }
	/** A host that already routes here — `lyra.example.com`, `https://lyra.example.com:8443`. */
	| { kind: "public"; url: string }
	/** A rendezvous both sides dial out to — `wss://relay.example.com`. */
	| { kind: "relay"; url: string };

export interface ParsedEndpoint {
	host: string;
	port: number;
	/** Whether to speak https/wss rather than http/ws. */
	tls: boolean;
}

/**
 * Split a typed address into the parts a client needs.
 *
 * People type what they know — with a scheme or without, with a port or without — and every one of
 * those is a correct way to write the same endpoint. Rejecting the shapes that are merely unusual
 * would make this a field you have to get right rather than one you can fill in.
 *
 * The default port follows the scheme, not the other way round: `https://lyra.example.com` means
 * 443, and a proxy is the case this exists for.
 */
export function parseEndpoint(raw: string): ParsedEndpoint | null {
	const text = raw.trim();
	if (!text) return null;

	const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
	let url: URL;
	try {
		url = new URL(withScheme);
	} catch {
		return null;
	}
	if (!url.hostname) return null;

	const tls = url.protocol === "https:" || url.protocol === "wss:";
	const port = url.port ? Number(url.port) : tls ? 443 : 80;
	if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
	return { host: url.hostname, port, tls };
}

/**
 * The pairing string for a route, or null when the route is not usable yet.
 *
 * `lyra://pair?…` rather than an https link on purpose: it is scanned by this app's own camera and
 * never opened by a browser, and a payload that looks like a web address invites someone to tap it
 * — landing on a page that does not exist, with the token in a URL that a browser will keep.
 */
export function pairingCode(route: PairingRoute, token: string | null): string | null {
	if (!token) return null;

	if (route.kind === "lan") {
		if (!route.address) return null;
		return `lyra://pair?host=${encodeURIComponent(route.address)}&port=${route.port}&token=${encodeURIComponent(token)}`;
	}

	const endpoint = parseEndpoint(route.url);
	if (!endpoint) return null;

	if (route.kind === "relay") {
		/*
		 * The relay needs a room, and the token already is one.
		 *
		 * Two devices that share a token are exactly the pair that should meet, so deriving the
		 * room from it means there is no second secret to distribute and no way to typo yourself
		 * into someone else's session. The relay only ever sees the room id; see `relay/README`.
		 */
		return `lyra://pair?relay=${encodeURIComponent(`${endpoint.tls ? "wss" : "ws"}://${endpoint.host}:${endpoint.port}`)}&token=${encodeURIComponent(token)}`;
	}

	return `lyra://pair?host=${encodeURIComponent(endpoint.host)}&port=${endpoint.port}${endpoint.tls ? "&tls=1" : ""}&token=${encodeURIComponent(token)}`;
}

/** How the address reads under the QR code, so what was scanned can be checked at a glance. */
export function routeLabel(route: PairingRoute): string {
	if (route.kind === "lan") return `${route.address}:${route.port}`;
	const endpoint = parseEndpoint(route.url);
	if (!endpoint) return route.url;
	const shown = endpoint.tls ? "https" : "http";
	const port = (endpoint.tls && endpoint.port === 443) || (!endpoint.tls && endpoint.port === 80) ? "" : `:${endpoint.port}`;
	return route.kind === "relay" ? `中转 ${endpoint.host}${port}` : `${shown}://${endpoint.host}${port}`;
}
