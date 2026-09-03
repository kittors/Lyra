/**
 * What the phone is allowed to send.
 *
 * `sync-rpc.ts` used one helper for this: `s(value)`, which turns anything that is not a string
 * into `""`. That is not validation, it is coercion — a number, an object or a null arrives as an
 * empty string and travels on into the session store, which then looks up a session called "".
 * The failure surfaces somewhere else entirely, as a missing session rather than a bad request.
 *
 * These inputs come off a WebSocket. Everything else in this application is called by our own
 * renderer, where a wrong type is a bug we would have caught compiling; here it is whatever was on
 * the wire. That is the whole reason this file exists and `ipc-types.ts` does not need an
 * equivalent.
 *
 * Deliberately hand-written rather than a schema library. Nineteen methods, and the checks are all
 * "is it a string", "is it one of these three", "is it under a sane length" — a dependency would
 * carry more than it saves, and this file has to stay importable from a package that depends on
 * nothing (see the package's README).
 */

/** Why a call was refused. The wire only ever sees this shape, never an exception. */
export interface ArgsError {
	ok: false;
	error: "invalid-args";
	/** Which argument, and what was wrong with it. Safe to log; never contains the value. */
	detail: string;
}

export type Checked<T> = { ok: true; value: T } | ArgsError;

const bad = (detail: string): ArgsError => ({ ok: false, error: "invalid-args", detail });

/*
 * Bounds, chosen to be far above anything real and far below anything that would hurt.
 *
 * The point is not to guess the largest legitimate value — it is that an unbounded string from the
 * network becomes an unbounded allocation. A session id is a UUID; a prompt is prose.
 */
const MAX_ID = 200;
const MAX_PATH = 4096;
const MAX_TEXT = 2_000_000;

/** A non-empty string, bounded. Ids, paths and model names all go through here. */
export function str(value: unknown, name: string, max = MAX_ID): Checked<string> {
	if (typeof value !== "string") return bad(`${name} 必须是字符串，收到 ${typeof value}`);
	if (value.length === 0) return bad(`${name} 不能为空`);
	if (value.length > max) return bad(`${name} 超长（${value.length} > ${max}）`);
	return { ok: true, value };
}

/** A string that may be absent, but must be a string when present. */
export function optionalStr(value: unknown, name: string, max = MAX_ID): Checked<string | undefined> {
	if (value === undefined || value === null) return { ok: true, value: undefined };
	return str(value, name, max);
}

/** An absolute path. Relative paths are refused here rather than resolved somewhere surprising. */
export function path(value: unknown, name: string): Checked<string> {
	const checked = str(value, name, MAX_PATH);
	if (!checked.ok) return checked;
	// `/` on posix, `C:\` or `\\server\share` on Windows.
	if (!/^(\/|[A-Za-z]:[\\/]|\\\\)/.test(checked.value)) return bad(`${name} 必须是绝对路径`);
	return checked;
}

/** Prose: a prompt, a title, a commit message. Bounded far above anything anyone types. */
export function text(value: unknown, name: string): Checked<string> {
	if (typeof value !== "string") return bad(`${name} 必须是字符串，收到 ${typeof value}`);
	if (value.length > MAX_TEXT) return bad(`${name} 超长（${value.length} > ${MAX_TEXT}）`);
	return { ok: true, value };
}

/** One of a fixed set. The set is the contract; anything else is refused by name. */
export function oneOf<const T extends readonly string[]>(
	value: unknown,
	name: string,
	allowed: T,
): Checked<T[number]> {
	if (typeof value !== "string" || !allowed.includes(value)) {
		return bad(`${name} 必须是 ${allowed.join(" / ")} 之一`);
	}
	return { ok: true, value: value as T[number] };
}

/** A boolean, and only a boolean — `"false"` and `0` are refused rather than coerced. */
export function bool(value: unknown, name: string): Checked<boolean> {
	if (typeof value !== "boolean") return bad(`${name} 必须是布尔值`);
	return { ok: true, value };
}

/** A non-negative integer. Sequence numbers and indices. */
export function index(value: unknown, name: string): Checked<number> {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
		return bad(`${name} 必须是非负整数`);
	}
	return { ok: true, value };
}

/** A plain object. The shape inside is the caller's to check. */
export function record(value: unknown, name: string): Checked<Record<string, unknown>> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return bad(`${name} 必须是对象`);
	}
	return { ok: true, value: value as Record<string, unknown> };
}

/**
 * The content of a prompt: text, or a list of text and image parts.
 *
 * Checked structurally rather than deeply — an image's base64 payload is passed through to the
 * model provider, which is the thing that knows whether it decodes.
 */
export function content(value: unknown, name: string): Checked<unknown> {
	if (typeof value === "string") return text(value, name);
	if (!Array.isArray(value)) return bad(`${name} 必须是字符串或数组`);
	if (value.length > 64) return bad(`${name} 的分段过多（${value.length} > 64）`);
	for (const [i, part] of value.entries()) {
		if (typeof part !== "object" || part === null) return bad(`${name}[${i}] 必须是对象`);
		const type = (part as { type?: unknown }).type;
		if (type !== "text" && type !== "image") return bad(`${name}[${i}].type 必须是 text 或 image`);
	}
	return { ok: true, value };
}

/** Run several checks, and return the first failure. Keeps a handler to one `if`. */
export function all<T extends readonly Checked<unknown>[]>(
	...checks: T
): Checked<{ [K in keyof T]: T[K] extends Checked<infer V> ? V : never }> {
	const values = [];
	for (const check of checks) {
		if (!check.ok) return check;
		values.push(check.value);
	}
	return { ok: true, value: values as never };
}
