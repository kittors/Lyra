/**
 * The OpenSSH agent protocol, as much of it as an agent that only lends keys needs.
 *
 * Three requests matter — list the keys, sign with one, and the extensions a client sends unasked —
 * and everything else is refused. Written here rather than taken from `ssh2`'s `AgentProtocol`,
 * because that one does not skip the body of a message it does not recognise. OpenSSH 8.9 and later
 * open every connection with `session-bind@openssh.com`; its unread bytes were parsed as the next
 * request, a second failure went out, and the client took it for the answer to "list your keys".
 * Every login through it failed with "agent refused operation". Here a frame is cut by its length
 * first and read second, so a message nobody understands still ends where it says it ends.
 */

const SSH_AGENT_FAILURE = 5;
const SSH_AGENTC_REQUEST_IDENTITIES = 11;
const SSH_AGENT_IDENTITIES_ANSWER = 12;
const SSH_AGENTC_SIGN_REQUEST = 13;
const SSH_AGENT_SIGN_RESPONSE = 14;
const SSH_AGENTC_EXTENSION = 27;
/** `SSH_AGENT_RSA_SHA2_256` and `_512`: which hash an RSA signature is asked for. */
export const RSA_SHA2_256 = 2;
export const RSA_SHA2_512 = 4;

/** OpenSSH's own agent refuses messages over 256 KiB; nothing an honest client sends comes close. */
const MAX_MESSAGE = 256 * 1024;

export type AgentRequest =
	| { type: "identities" }
	| { type: "sign"; key: Buffer; data: Buffer; flags: number }
	| { type: "extension"; name: string }
	| { type: "other"; code: number };

/** Reads one SSH `string` (uint32 length, then bytes), or undefined when the buffer runs out. */
function readString(buffer: Buffer, at: number): { value: Buffer; next: number } | undefined {
	if (at + 4 > buffer.length) return undefined;
	const length = buffer.readUInt32BE(at);
	const end = at + 4 + length;
	if (end > buffer.length) return undefined;
	return { value: buffer.subarray(at + 4, end), next: end };
}

/** Parses the body of one complete message. A malformed body is a request this agent refuses. */
function parse(message: Buffer): AgentRequest {
	const code = message[0];
	if (code === SSH_AGENTC_REQUEST_IDENTITIES) return { type: "identities" };
	if (code === SSH_AGENTC_SIGN_REQUEST) {
		const key = readString(message, 1);
		const data = key && readString(message, key.next);
		if (!key || !data || data.next + 4 > message.length) return { type: "other", code };
		return { type: "sign", key: key.value, data: data.value, flags: message.readUInt32BE(data.next) };
	}
	if (code === SSH_AGENTC_EXTENSION) {
		const name = readString(message, 1);
		return { type: "extension", name: name ? name.value.toString("utf8") : "" };
	}
	return { type: "other", code };
}

/** Splits a byte stream into requests, however the stream happens to chunk it. */
export class AgentFramer {
	private pending: Buffer = Buffer.alloc(0);

	/** Feeds bytes and returns every request they complete, in order. Throws on an oversized frame. */
	push(chunk: Buffer): AgentRequest[] {
		this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
		const requests: AgentRequest[] = [];
		while (this.pending.length >= 4) {
			const length = this.pending.readUInt32BE(0);
			if (length === 0 || length > MAX_MESSAGE) throw new Error(`agent message of ${length} bytes`);
			if (this.pending.length < 4 + length) break;
			requests.push(parse(this.pending.subarray(4, 4 + length)));
			this.pending = this.pending.subarray(4 + length);
		}
		return requests;
	}
}

function frame(type: number, ...parts: Buffer[]): Buffer {
	const body = Buffer.concat([Buffer.from([type]), ...parts]);
	const header = Buffer.alloc(4);
	header.writeUInt32BE(body.length, 0);
	return Buffer.concat([header, body]);
}

export function sshString(value: Buffer | string): Buffer {
	const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : value;
	const length = Buffer.alloc(4);
	length.writeUInt32BE(bytes.length, 0);
	return Buffer.concat([length, bytes]);
}

/**
 * An unsigned big-endian integer as SSH writes it: no leading zeros, and one zero byte in front
 * when the top bit is set, so it is not read back as negative.
 */
export function sshMpint(value: Buffer): Buffer {
	let start = 0;
	while (start < value.length - 1 && value[start] === 0) start++;
	const trimmed = value.subarray(start);
	return sshString(trimmed[0]! & 0x80 ? Buffer.concat([Buffer.from([0]), trimmed]) : trimmed);
}

export function failureReply(): Buffer {
	return frame(SSH_AGENT_FAILURE);
}

export function identitiesReply(keys: readonly { blob: Buffer; comment: string }[]): Buffer {
	const count = Buffer.alloc(4);
	count.writeUInt32BE(keys.length, 0);
	return frame(SSH_AGENT_IDENTITIES_ANSWER, count, ...keys.flatMap((key) => [sshString(key.blob), sshString(key.comment)]));
}

/** `signature` is the blob in its format's own encoding; the format name travels beside it. */
export function signReply(format: string, signature: Buffer): Buffer {
	return frame(SSH_AGENT_SIGN_RESPONSE, sshString(Buffer.concat([sshString(format), sshString(signature)])));
}
