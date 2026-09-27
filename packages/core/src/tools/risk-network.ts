/**
 * Where the agent may connect, in three answers instead of two.
 *
 * The old rule had one bit: loopback was fine, everything else asked. That put "read a public
 * documentation page" and "POST to an internal admin endpoint" in the same box, and since reading
 * pages is the common case, the box was opened constantly — which is how a safeguard becomes a
 * button people press without reading.
 *
 * Three answers, because there are three genuinely different situations:
 *
 * **Allowed.** A GET to a public host. It reads something; it changes nothing on this machine. The
 * real hazard in a fetched page is that its *content* tries to instruct the model — and a prompt
 * showing a URL cannot help with that, because the content is not on screen and would not be read
 * if it were. That hazard is handled where it belongs: the fetched body is wrapped and labelled as
 * untrusted data.
 *
 * **Refused outright.** A private address, or a cloud metadata endpoint. This is the case the old
 * prompt was nominally for, and the case a prompt is worst at: shown
 * `http://169.254.169.254/latest/meta-data/iam/security-credentials/`, almost nobody sees a
 * credential theft in progress. A question a person cannot answer should not be asked — it should
 * be decided. Somebody who genuinely needs an internal host can allow it once, explicitly, in
 * settings, which is a decision made when they are thinking about it rather than mid-turn.
 *
 * **Asked.** Anything with a side effect the network cannot take back: POST, PUT, PATCH, DELETE.
 * Here a prompt earns its interruption, because the thing being decided — "send this data to that
 * host" — is exactly what the URL and method describe.
 */

import { isIP } from "node:net";
import { riskReason, type RiskCode, type RiskParams } from "./risk-reasons.ts";

/**
 * `reason` is the rule's own sentence — it is what the model is told when a fetch is refused —
 * and `code` names the rule, for the approval card to say in the interface's language.
 */
export type NetworkVerdict =
	| { decision: "allow" }
	| { decision: "refuse"; reason: string; code: RiskCode; params?: RiskParams }
	| { decision: "ask"; reason: string; code: RiskCode; params?: RiskParams };

function refuse(code: RiskCode, params?: RiskParams): NetworkVerdict {
	return { decision: "refuse", reason: riskReason(code, params), code, ...(params ? { params } : {}) };
}

function ask(code: RiskCode, params?: RiskParams): NetworkVerdict {
	return { decision: "ask", reason: riskReason(code, params), code, ...(params ? { params } : {}) };
}

/** Methods that only read. Anything else changes something at the other end. */
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Whether a hostname is one of this machine's own loopback names.
 *
 * Kept narrow deliberately. `*.localhost` resolves to loopback by specification and dev servers do
 * use it, but `127.0.0.1.nip.io` resolves to loopback too and is not a name this machine owns — it
 * is somebody else's DNS pointing inward. Names get the benefit of the doubt only when they are
 * literally loopback; everything else is settled by the address it resolves to.
 */
function isLoopbackName(host: string): boolean {
	return host === "localhost" || host.endsWith(".localhost");
}

/**
 * Whether an address is one nobody outside this network can route to.
 *
 * Written against the parsed octets rather than the text, because the text has too many spellings:
 * `192.168.1.1`, `0300.0250.1.1`, `3232235777` and `::ffff:192.168.1.1` are the same address, and a
 * string comparison catches one of them. `isIP` rejects the exotic spellings outright, and the ones
 * it accepts are compared numerically.
 */
export function isPrivateAddress(address: string): boolean {
	const family = isIP(address);
	if (family === 4) return isPrivateV4(address);
	if (family === 6) return isPrivateV6(address);
	return false;
}

function isPrivateV4(address: string): boolean {
	const [a, b] = address.split(".").map(Number);
	if (a === 10 || a === 127 || a === 0) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	if (a === 192 && b === 168) return true;
	// 169.254/16 is link-local, and 169.254.169.254 is where every major cloud puts the metadata
	// service that hands out credentials to whoever asks from inside the instance.
	if (a === 169 && b === 254) return true;
	// Carrier-grade NAT: not the public internet either.
	if (a === 100 && b >= 64 && b <= 127) return true;
	return false;
}

function isPrivateV6(address: string): boolean {
	const lower = address.toLowerCase().replace(/^\[|\]$/g, "");
	if (lower === "::1" || lower === "::") return true;
	// An IPv4 address wearing an IPv6 spelling is still that address.
	const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
	if (mapped) return isPrivateV4(mapped[1]);
	// fc00::/7 unique-local, fe80::/10 link-local.
	if (/^f[cd]/.test(lower)) return true;
	if (/^fe[89ab]/.test(lower)) return true;
	return false;
}

/** What a private destination is called when the refusal has to be explained. */
function privateCode(address: string): RiskCode {
	if (/^169\.254\.169\.254$/.test(address)) return "cloud-metadata";
	if (isIP(address) === 4 && /^(127\.|0\.)/.test(address)) return "loopback";
	return "private-network";
}

export interface NetworkRequest {
	url: string;
	/** Defaults to GET, which is what a fetch without one does. */
	method?: string;
	/**
	 * Addresses the hostname resolved to, when the caller has already looked them up.
	 *
	 * This is the half a hostname check cannot do. `evil.com` is a public name that can resolve to
	 * `192.168.1.1` — the name passes every check and the connection goes somewhere internal. The
	 * caller resolves once and passes the answers here, so the decision is made about the address
	 * the socket will actually reach.
	 */
	addresses?: readonly string[];
	/** Hosts the user has explicitly allowed, matched by hostname. */
	allowHosts?: readonly string[];
}

/**
 * Decide one network request.
 *
 * Refusal wins over everything: an explicit allow-list entry cannot open a private address that
 * arrived through a public name, because that is the shape of the attack rather than a
 * configuration anybody intends.
 */
export function assessNetwork(request: NetworkRequest): NetworkVerdict {
	let url: URL;
	try {
		url = new URL(request.url.trim());
	} catch {
		return refuse("unparsable-url");
	}

	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return refuse("unsupported-protocol", { protocol: url.protocol });
	}
	if (url.username || url.password) {
		return refuse("credentials-in-url");
	}

	const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
	const method = (request.method ?? "GET").toUpperCase();

	// Every address this could reach: the hostname when it is already literal, plus whatever it
	// resolved to. One private answer is enough to refuse — a name with several addresses reaches
	// whichever the resolver hands the socket.
	const candidates = [host, ...(request.addresses ?? [])];
	for (const candidate of candidates) {
		if (isPrivateAddress(candidate)) {
			/*
			 * The one exception, and it is why developers can test their own work: a dev server on
			 * this machine is not the internet, and asking about `http://localhost:3000/` teaches
			 * nothing except the habit of clicking through.
			 *
			 * Decided on the host as written, never on what it resolved to. `127.0.0.1.nip.io`
			 * resolves to loopback and is somebody else's DNS pointing inward — granting the
			 * exception to anything that *lands* on loopback would hand it to every such name.
			 */
			if (isLoopbackName(host) || isLoopbackV4OrV6(host)) {
				return READ_METHODS.has(method) ? { decision: "allow" } : ask("local-service-write");
			}
			return refuse(privateCode(candidate));
		}
	}

	if (request.allowHosts?.some((allowed) => allowed.toLowerCase() === host)) return { decision: "allow" };
	if (!READ_METHODS.has(method)) return ask("method-writes", { method });
	return { decision: "allow" };
}

function isLoopbackV4OrV6(address: string): boolean {
	if (isIP(address) === 4) return address.startsWith("127.");
	const lower = address.toLowerCase().replace(/^\[|\]$/g, "");
	if (lower === "::1") return true;
	const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
	return mapped ? mapped[1].startsWith("127.") : false;
}
