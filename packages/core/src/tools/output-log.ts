import { randomUUID } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { finished } from "node:stream/promises";

/** Spool full command output to the session scratch directory, outside model context and the session records. */
export async function createOutputLog(scratchDir: string | undefined) {
	if (!scratchDir) return undefined;
	const directory = join(scratchDir, "tool-output");
	await mkdir(directory, { recursive: true });
	const path = join(directory, `${randomUUID()}.log`);
	const handle = await open(path, "wx", 0o600);
	const stream = handle.createWriteStream();
	let characters = 0;
	let error: string | undefined;
	let closed = false;
	const done = finished(stream).catch((cause: unknown) => { error = String(cause); });
	return {
		path,
		append(text: string) { characters += text.length; if (!closed && !error) stream.write(text); },
		async close() { if (!closed) { closed = true; stream.end(); } await done; return { outputPath: path, outputCharacters: characters, outputComplete: !error, outputError: error }; },
	};
}
