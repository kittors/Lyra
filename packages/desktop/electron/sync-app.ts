/**
 * Serving the desktop's own interface to the phone.
 *
 * The phone does not ship a copy of the UI — it loads this one, from the machine it is paired
 * with. Which means the two are the same build by construction: update the desktop and the phone
 * has the new interface on its next load, with no app store in between.
 *
 * Same origin as the API, and that is not incidental. The renderer's CSP is `connect-src 'self'`;
 * served from here, "self" *is* the sync server, so its fetches and its WebSocket are allowed
 * without loosening anything. A copy bundled into the app would have to be granted permission to
 * talk to an arbitrary host, which is a much wider door.
 */

import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { ServerResponse } from "node:http";

/** Where `electron-vite` puts the renderer, relative to the main process bundle. */
const ROOT = resolve(import.meta.dirname, "..", "renderer");

const TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".map": "application/json; charset=utf-8",
};

/** Base64 expands by a third; five MiB stays below the relay's eight MiB frame ceiling. */
const MAX_RELAY_ASSET_BYTES = 5 * 1024 * 1024;

export interface AppAsset {
	status: 200 | 404 | 413;
	contentType: string;
	cacheControl: string;
	body: Buffer;
}

/**
 * The file for a request path, or null if it is not one of ours.
 *
 * `normalize` then a prefix check, because the path arrives from the network: `/app/../../../etc/
 * passwd` is a request someone will make, and it is the whole reason this does not simply join.
 */
function resolveAsset(pathname: string): string | null {
	const relative = pathname.replace(/^\/app\/?/, "") || "index.html";
	const full = resolve(ROOT, normalize(relative));
	if (full !== ROOT && !full.startsWith(ROOT + sep)) return null;
	return full;
}

async function appFile(pathname: string): Promise<string | null> {
	const candidate = resolveAsset(pathname);
	if (!candidate) return null;

	let file = candidate;
	try {
		const info = await stat(file);
		if (info.isDirectory()) file = join(file, "index.html");
	} catch {
		file = join(ROOT, "index.html");
	}

	try {
		await stat(file);
		return file;
	} catch {
		return null;
	}
}

function contentType(file: string): string {
	return TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
}

function cacheControl(file: string): string {
	return file.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable";
}

function mobileShell(html: string): string {
	return html.replace(
		/<meta name="viewport"[^>]*>/,
		'<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />',
	);
}

/** Read one renderer resource for the relay's deliberately narrow static-resource tunnel. */
export async function readAppAsset(pathname: string): Promise<AppAsset> {
	const file = await appFile(pathname);
	if (!file) {
		return {
			status: 404,
			contentType: "text/plain; charset=utf-8",
			cacheControl: "no-store",
			body: Buffer.from("not found"),
		};
	}

	const info = await stat(file);
	if (info.size > MAX_RELAY_ASSET_BYTES) {
		return {
			status: 413,
			contentType: "text/plain; charset=utf-8",
			cacheControl: "no-store",
			body: Buffer.from("asset too large"),
		};
	}

	const body = file.endsWith("index.html")
		? Buffer.from(mobileShell(await readFile(file, "utf8")))
		: await readFile(file);
	return { status: 200, contentType: contentType(file), cacheControl: cacheControl(file), body };
}

/**
 * Send an asset, or answer false so the caller can 404 it.
 *
 * A directory or a missing file both fall back to `index.html` — the renderer routes on the hash,
 * so a deep link is a page this server has never heard of and the app sorts out on its own.
 */
export async function serveApp(pathname: string, res: ServerResponse): Promise<boolean> {
	const file = await appFile(pathname);
	if (!file) return false;

	/*
	 * The shell gets a viewport of its own, and it is not cosmetic.
	 *
	 * iOS zooms the page whenever a focused input has a font smaller than 16px — a readability
	 * rule that predates apps like this one. The composer is 14px (`--text-body`), so tapping it
	 * scaled everything up, and a scaled viewport is a wider one: the right-hand cards and the send
	 * button slid off the screen, and they stayed off after the keyboard closed.
	 *
	 * Fixed here rather than by enlarging the composer, because the type scale is the desktop's and
	 * this is a phone's quirk. Only this route is touched — the desktop window loads the same file
	 * over `loadFile`, never through this server, so its own zooming is untouched.
	 *
	 * `viewport-fit=cover` so the page may paint under the notch; the insets are applied outside
	 * the WebView, see `desk.tsx`.
	 */
	if (file.endsWith("index.html")) {
		const html = mobileShell(await readFile(file, "utf8"));
		res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
		res.end(html);
		return true;
	}

	res.writeHead(200, {
		"content-type": contentType(file),
		/*
		 * Hashed assets are immutable; the shell is not.
		 *
		 * Vite fingerprints every asset it emits, so those can be cached hard — which matters on a
		 * phone, where the alternative is re-downloading a four-megabyte bundle over mobile data
		 * every time the app is opened. `index.html` names those hashes, so it must never be held.
		 */
		"cache-control": cacheControl(file),
	});
	createReadStream(file).pipe(res);
	return true;
}
