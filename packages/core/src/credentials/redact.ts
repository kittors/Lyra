/**
 * Taking known secret values out of text before it is logged, shown, or sent to a model.
 *
 * This is the backstop, not the defence. The values reach programs through askpass, an agent socket
 * or the environment precisely so that they are never in a command line to begin with; what is
 * caught here is a program printing one by accident. A model determined to print a value can encode
 * it some way not listed below, and nothing in this file pretends otherwise — every vendor that
 * documents masking says the same (GitHub Actions, AWS's guide for coding agents).
 *
 * The forms follow GitHub Actions' log masker (`actions/runner`, `ValueEncoders.cs`), which has
 * seen more of how values leak through shells than anything else.
 */

import type { ToolResult } from "../types/tool.ts";

export interface RedactSecret {
	/** What the marker says: `kzhy-root`, or `my-key.passphrase` for a credential's second secret. */
	label: string;
	value: string;
}

/**
 * Below this many characters a value's derived forms are too short to be distinctive, and masking
 * them would scramble ordinary output. Actions uses the same floor for its PowerShell halves. The
 * value itself is still masked at any length.
 */
const DERIVED_MIN = 6;

const BASE64 = /[+/=]/g;
const urlSafe = (text: string) => text.replace(BASE64, (char) => (char === "+" ? "-" : char === "/" ? "_" : ""));

/**
 * The stretch of a value's base64 that does not depend on its neighbours.
 *
 * Base64 packs three bytes into four characters, so how a value encodes depends on how many bytes
 * came before it — `base64("user:" + password)` shares nothing with `base64(password)` at the edges.
 * For each of the three alignments, only the characters made entirely of the value's own bits are
 * kept. Actions encodes the shifted value whole and so misses it whenever bytes follow it.
 */
function base64Cores(bytes: Buffer): string[] {
	const cores: string[] = [];
	for (let offset = 0; offset < 3; offset++) {
		const encoded = Buffer.concat([Buffer.alloc(offset), bytes]).toString("base64").replace(/=+$/, "");
		const first = offset * 8;
		const last = (offset + bytes.length) * 8;
		let start = -1;
		let end = -1;
		for (let char = 0; char < encoded.length; char++) {
			const bitStart = char * 6;
			if (bitStart >= first && bitStart + 6 <= last) {
				if (start === -1) start = char;
				end = char + 1;
			}
		}
		if (start !== -1 && end - start >= DERIVED_MIN) {
			const core = encoded.slice(start, end);
			cores.push(core, urlSafe(core));
		}
	}
	return cores;
}

/**
 * PowerShell, failing on a value with `&` in it, colours the pieces separately — the log shows them
 * apart. Both halves are masked, as Actions does; `&+` costs the letter after it as well.
 */
function powershellHalves(value: string): string[] {
	if (!value.includes("&")) return [];
	const joined = value.indexOf("&+");
	const cut = joined >= 0 ? joined + 2 : value.lastIndexOf("&") + 1;
	const before = value.slice(0, cut);
	const after = value.slice(joined >= 0 ? cut + 1 : cut);
	return [before, after].filter((half) => half.length >= DERIVED_MIN);
}

const xmlEscape = (text: string) =>
	text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);

/** Every form one value is masked in. */
export function variants(value: string): string[] {
	const forms = new Set<string>([value]);
	if (value.length >= DERIVED_MIN) {
		forms.add(JSON.stringify(value).slice(1, -1));
		forms.add(encodeURIComponent(value));
		forms.add(value.replace(/"/g, '\\"'));
		forms.add(xmlEscape(value));
		for (const core of base64Cores(Buffer.from(value, "utf8"))) forms.add(core);
		for (const half of powershellHalves(value)) forms.add(half);
	}
	return [...forms].filter(Boolean);
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** An image or a pasted binary: rewriting a character inside one breaks it for good. */
const looksBinary = (text: string) => text.startsWith("data:") || (text.length > 2048 && /^[A-Za-z0-9+/=\r\n]+$/.test(text));

export class Redactor {
	private readonly pattern: RegExp | null;
	private readonly labels = new Map<string, string>();
	/** Forms by first character, so a stream can ask cheaply whether its tail could still become one. */
	private readonly byFirst = new Map<string, string[]>();
	/** Longest form, so a stream knows how much to hold back. */
	readonly longest: number;

	constructor(secrets: readonly RedactSecret[]) {
		for (const secret of secrets) {
			if (!secret.value) continue;
			for (const form of variants(secret.value)) if (!this.labels.has(form)) this.labels.set(form, secret.label);
		}
		// Longest first, so a value that contains another is replaced whole rather than in pieces.
		const forms = [...this.labels.keys()].sort((a, b) => b.length - a.length);
		this.pattern = forms.length ? new RegExp(forms.map(escapeRegExp).join("|"), "g") : null;
		this.longest = forms[0]?.length ?? 0;
		for (const form of forms) {
			const list = this.byFirst.get(form[0]!);
			if (list) list.push(form);
			else this.byFirst.set(form[0]!, [form]);
		}
	}

	/**
	 * Where the end of `text` could still be the start of a form, or `text.length` when it cannot.
	 *
	 * A stream holds back only that much. Holding back a fixed `longest - 1` instead froze the end of
	 * every long-running command's output: a dev server prints its ready line and waits, and with a
	 * private key's length held back, the line it waits on never reaches the screen.
	 */
	heldFrom(text: string): number {
		for (let at = Math.max(0, text.length - this.longest + 1); at < text.length; at++) {
			const rest = text.slice(at);
			if (this.byFirst.get(text[at]!)?.some((form) => form.length > rest.length && form.startsWith(rest))) return at;
		}
		return text.length;
	}

	get empty(): boolean {
		return this.pattern === null;
	}

	text(input: string): string {
		if (!this.pattern || !input) return input;
		return input.replace(this.pattern, (found) => `[credential:${this.labels.get(found)}]`);
	}

	/** Where each match is, for a stream deciding what it may let go of. */
	matches(input: string): { start: number; end: number }[] {
		if (!this.pattern) return [];
		return [...input.matchAll(this.pattern)].map((match) => ({ start: match.index, end: match.index + match[0].length }));
	}

	/**
	 * A tool result, with every secret out of its text and its details.
	 *
	 * Images and binary-looking strings are left alone: OpenHands masked inside a screenshot's
	 * base64 once and every later request in that conversation was rejected with a 400. A
	 * screenshot's secrets are dealt with where it is taken (the browser masks filled fields).
	 * Throws on what it cannot walk; the caller turns that into a refusal, never into the original.
	 */
	result(result: ToolResult): ToolResult {
		if (!this.pattern) return result;
		const content = result.content.map((block) => (block.type === "text" ? { ...block, text: this.text(block.text) } : block));
		return result.details === undefined ? { ...result, content } : { ...result, content, details: this.deep(result.details, new WeakSet()) };
	}

	private deep(value: unknown, seen: WeakSet<object>): unknown {
		if (typeof value === "string") return looksBinary(value) ? value : this.text(value);
		if (!value || typeof value !== "object") return value;
		// Only plain data is walked. A Date or a Buffer rebuilt from its entries would come back empty.
		const plain = Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;
		if (!plain) return value;
		// Ancestors only: an object referenced twice is shared, not a cycle.
		if (seen.has(value)) throw new Error("details refer to themselves");
		seen.add(value);
		try {
			if (Array.isArray(value)) return value.map((item) => this.deep(item, seen));
			const out: Record<string, unknown> = {};
			for (const [key, item] of Object.entries(value)) out[key] = this.deep(item, seen);
			return out;
		} finally {
			seen.delete(value);
		}
	}
}

/**
 * Masking text that arrives in pieces.
 *
 * A value can straddle two chunks, so the end of each chunk is held back until the next one arrives
 * or the stream ends — but only the part that could still turn into a value. See `heldFrom`.
 */
export class StreamRedactor {
	private held = "";
	private readonly redactor: () => Redactor;

	// A field rather than a parameter property: Node's type stripping cannot rewrite those.
	constructor(redactor: () => Redactor) {
		this.redactor = redactor;
	}

	push(chunk: string): string {
		const redactor = this.redactor();
		if (redactor.empty) {
			const out = this.held + chunk;
			this.held = "";
			return out;
		}
		const text = this.held + chunk;
		let cut = redactor.heldFrom(text);
		// A value already whole across the cut is let go whole, not split across two outputs.
		for (const match of redactor.matches(text)) if (match.start < cut && match.end > cut) cut = match.end;
		this.held = text.slice(cut);
		return redactor.text(text.slice(0, cut));
	}

	flush(): string {
		const out = this.redactor().text(this.held);
		this.held = "";
		return out;
	}
}
