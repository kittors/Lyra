/**
 * Pictures kept on disk between launches, for the places that ask for the same few dozen every time.
 *
 * The market draws seventy icons, and over a slow link each one takes a second or more to arrive —
 * on every launch, because the only cache was this process's memory. Kept on disk, the second launch
 * draws them as soon as the catalogue is there.
 *
 * A picture is served from here whatever its age; one fetched more than an hour ago is also asked
 * for again in the background (`stale`), so an icon a maintainer replaced shows up on the next look
 * rather than never. Bounded by count, and the pictures fetched longest ago go first — anything still
 * in use has been refreshed recently and is not among them.
 *
 * Failures of the disk itself are never failures of the picture: every operation here swallows its
 * error, and the caller falls back to the network as if nothing had been kept.
 */

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface ImageStore {
	/** The picture kept for this URL, and whether it is old enough to be fetched again. */
	read(url: string): Promise<{ value: string; stale: boolean } | null>;
	write(url: string, value: string): Promise<void>;
}

/** How long a kept picture is taken as current without asking again. */
const FRESH_MS = 60 * 60 * 1000;

/** How many pictures are kept. Market icons are a few KB to a few tens of KB each. */
const LIMIT = 400;

/** How many writes go by between two looks at the directory's size. */
const PRUNE_EVERY = 25;

export function diskImageStore(dir: string, now: () => number = Date.now, limit = LIMIT): ImageStore {
	const pathOf = (url: string) => join(dir, createHash("sha256").update(url).digest("hex").slice(0, 32));
	let writes = 0;

	/** Drop the pictures fetched longest ago, down to the limit. */
	const prune = async () => {
		const names = await readdir(dir).catch(() => [] as string[]);
		if (names.length <= limit) return;
		const aged = await Promise.all(
			names.map(async (name) => ({ name, at: (await stat(join(dir, name)).catch(() => null))?.mtimeMs ?? 0 })),
		);
		aged.sort((a, b) => a.at - b.at);
		await Promise.all(aged.slice(0, aged.length - limit).map((file) => rm(join(dir, file.name), { force: true }).catch(() => {})));
	};

	return {
		async read(url) {
			try {
				const path = pathOf(url);
				const [value, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
				// Only what `write` puts here. Anything else is a file somebody else left, not a picture.
				if (!value.startsWith("data:image/")) return null;
				return { value, stale: now() - info.mtimeMs > FRESH_MS };
			} catch {
				return null;
			}
		},
		async write(url, value) {
			try {
				await mkdir(dir, { recursive: true });
				await writeFile(pathOf(url), value);
				writes += 1;
				if (writes % PRUNE_EVERY === 1) await prune();
			} catch {
				// A full disk or a read-only home costs the cache, never the picture.
			}
		},
	};
}
