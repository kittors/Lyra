import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readdir, realpath, rename, rm } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { ImportedFont, ImportedFontData } from "../shared/custom-fonts.ts";
import { fontDirectory, fontSource, hasCode, readFontFile, writeFontFile } from "./custom-font-files.ts";
import { MAX_FONT_SIZE, validateFont } from "./font-validation.ts";

const FONT_ID = /^[a-f0-9]{64}$/u;
const METADATA_LIMIT = 4096;

function checkId(id: string): void {
	if (typeof id !== "string" || !FONT_ID.test(id)) throw new Error("Invalid imported font id");
}

function digest(bytes: Buffer): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function visibleCharacter(character: string): boolean {
	return character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127;
}

function metadata(value: unknown, id: string): ImportedFont {
	if (typeof value !== "object" || value === null || !("id" in value) || value.id !== id
		|| !("name" in value) || typeof value.name !== "string" || value.name.length === 0 || value.name.length > 255
		|| !Array.from(value.name).every(visibleCharacter)
		|| !("family" in value) || value.family !== `Lyra Imported ${id}`
		|| !("format" in value) || (value.format !== "ttf" && value.format !== "otf" && value.format !== "woff" && value.format !== "woff2")
		|| !("size" in value) || typeof value.size !== "number" || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > MAX_FONT_SIZE) {
		throw new Error("Invalid imported font metadata");
	}
	return { id, name: value.name, family: value.family, format: value.format, size: value.size };
}

/** No paths enter through IPC; only the native picker can call importFile. */
export class CustomFontStore {
	private readonly userData: string;

	constructor(userData: string) {
		this.userData = userData;
	}

	private async directory(): Promise<string> {
		// Canonicalize the trusted app directory so system aliases such as macOS /var remain usable.
		const base = await realpath(this.userData);
		if ((await lstat(this.userData)).isSymbolicLink()) throw new Error("Unsafe font user data directory");
		await fontDirectory(base);
		const root = join(base, "fonts");
		try {
			await mkdir(root, { mode: 0o700 });
		} catch (error) {
			if (!hasCode(error, "EEXIST")) throw error;
		}
		await fontDirectory(root);
		return root;
	}

	private async load(root: string, id: string): Promise<{ font: ImportedFont; bytes: Buffer }> {
		checkId(id);
		await fontDirectory(root);
		const directory = join(root, id);
		await fontDirectory(directory);
		const value: unknown = JSON.parse((await readFontFile(join(directory, "metadata.json"), METADATA_LIMIT)).toString("utf8"));
		const font = metadata(value, id);
		const bytes = await readFontFile(join(directory, "font.bin"), MAX_FONT_SIZE);
		if (bytes.length !== font.size || digest(bytes) !== id) throw new Error("Imported font integrity check failed");
		validateFont(bytes, font.format);
		return { font, bytes };
	}

	async list(): Promise<ImportedFont[]> {
		const root = await this.directory();
		const fonts: ImportedFont[] = [];
		for (const entry of await readdir(root)) {
			// Interrupted transactions are invisible; a committed entry is never partially published.
			if (!FONT_ID.test(entry)) continue;
			try {
				fonts.push((await this.load(root, entry)).font);
			} catch (error) {
				throw new Error(`Cannot list imported font ${entry}: stored font is unsafe, missing or corrupt`, { cause: error });
			}
		}
		return fonts.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
	}

	async read(id: string): Promise<ImportedFontData> {
		checkId(id);
		const { font, bytes } = await this.load(await this.directory(), id);
		return { ...font, data: `data:font/${font.format};base64,${bytes.toString("base64")}` };
	}

	async importFile(path: string): Promise<ImportedFontData> {
		await fontSource(path);
		const bytes = await readFontFile(path, MAX_FONT_SIZE);
		const format = validateFont(bytes, extname(path));
		const id = digest(bytes);
		const root = await this.directory();
		const target = join(root, id);
		let existing = false;
		try {
			await lstat(target);
			existing = true;
		} catch (error) {
			if (!hasCode(error, "ENOENT")) throw error;
		}
		if (existing) {
			try {
				return await this.read(id);
			} catch (error) {
				// A broken existing entry must not be replaced by an otherwise identical import.
				if (hasCode(error, "ENOENT")) throw new Error("Imported font entry is incomplete", { cause: error });
				throw error;
			}
		}
		const name = Array.from(basename(path, extname(path))).filter(visibleCharacter).join("").trim().slice(0, 255) || "Imported font";
		const font: ImportedFont = { id, name, family: `Lyra Imported ${id}`, format, size: bytes.length };
		const pending = await mkdtemp(join(root, ".import-"));
		try {
			await fontDirectory(pending);
			await writeFontFile(join(pending, "font.bin"), bytes);
			await writeFontFile(join(pending, "metadata.json"), JSON.stringify(font));
			await fontDirectory(root);
			await fontDirectory(pending);
			try {
				// Renaming a complete directory commits the resource and name together. A concurrent
				// writer cannot replace the winner's nonempty directory, even across store instances.
				await rename(pending, target);
			} catch (error) {
				if (!hasCode(error, "EEXIST") && !hasCode(error, "ENOTEMPTY") && !hasCode(error, "EPERM") && !hasCode(error, "EACCES")) throw error;
				await this.load(root, id);
			}
		} finally {
			await fontDirectory(root);
			// Only the transaction's own temporary directory is eligible for cleanup.
			await rm(pending, { recursive: true, force: true });
		}
		return this.read(id);
	}
}
