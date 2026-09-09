/**
 * What a file has to look like before it is allowed to become a `data:` URL in the renderer.
 *
 * This is a container check, not a sanitizer. It answers "is this the kind of file it claims to
 * be, and does its own table of contents describe something that fits inside it" — the questions
 * whose answers are cheap and whose wrong answers are expensive: an oversized allocation, a table
 * offset pointing past the end, a brotli stream that expands without bound. The outlines
 * themselves are the browser's problem, which is why `loadImportedFont` still has to await
 * `FontFace.load()` and report what it says.
 *
 * The extension is checked against the signature rather than trusted. A `.otf` holding TrueType
 * bytes is refused even though both are fonts: the format is recorded in the store's metadata and
 * spelt again in the `data:` URL's media type, and a record that disagrees with its contents is
 * the kind of thing that is discovered much later, by something else.
 */

import { brotliDecompressSync } from "node:zlib";
import type { ImportedFont } from "../shared/custom-fonts.ts";

/**
 * 32 MiB.
 *
 * Above the largest fonts anyone actually installs — a full Source Han Sans weight is around 16 MB
 * — and low enough that the bytes can be held twice (raw, then base64) without the main process
 * noticing. The store reads with this bound before a byte is parsed, so a file that lies about its
 * size in a header never gets the chance to be allocated.
 */
export const MAX_FONT_SIZE = 32 * 1024 * 1024;

const EXTENSIONS: Record<string, ImportedFont["format"]> = { ttf: "ttf", otf: "otf", woff: "woff", woff2: "woff2" };

const TRUETYPE = 0x00010000;
/** Apple's older spelling of the same thing; still shipped by some system fonts. */
const TRUETYPE_APPLE = 0x74727565;
const CFF = 0x4f54544f;

const REQUIRED = ["cmap", "head", "maxp"];

/**
 * Only the WOFF2 table indices this file reasons about.
 *
 * The full known-tag list is 60-odd entries and every one of them would be written here from
 * memory. The required-table check needs six, all of them at the low end of the list where the
 * numbering is not in doubt; anything else becomes an opaque `#n` that still counts for duplicate
 * detection and is otherwise carried through untouched.
 */
const WOFF2_TAGS: Record<number, string> = { 0: "cmap", 1: "head", 4: "maxp", 10: "glyf", 11: "loca", 13: "CFF " };
const WOFF2_GLYF = 10;
const WOFF2_LOCA = 11;
const WOFF2_CUSTOM_TAG = 0x3f;

function invalid(reason: string): never {
	throw new Error(`Invalid font: ${reason}`);
}

/** Which container the bytes actually are, regardless of what the file was called. */
function container(bytes: Buffer): ImportedFont["format"] | undefined {
	if (bytes.length < 4) return undefined;
	const signature = bytes.toString("latin1", 0, 4);
	if (signature === "wOFF") return "woff";
	if (signature === "wOF2") return "woff2";
	const version = bytes.readUInt32BE(0);
	if (version === TRUETYPE || version === TRUETYPE_APPLE) return "ttf";
	if (version === CFF) return "otf";
	return undefined;
}

/**
 * Enough of a font to be worth showing text in.
 *
 * Deliberately short of what the spec calls mandatory: `name`, `post`, `OS/2` and the metrics
 * tables are all required by OpenType and all absent from fonts that browsers load anyway. These
 * three plus outlines are the ones whose absence means the file is not a font at all.
 */
function requiredTables(flavor: number, tags: Set<string>): void {
	for (const tag of REQUIRED) if (!tags.has(tag)) invalid(`missing ${tag} table`);
	const outlines = flavor === CFF ? ["CFF ", "CFF2"].some((tag) => tags.has(tag)) : ["glyf", "loca"].every((tag) => tags.has(tag));
	if (!outlines) invalid(flavor === CFF ? "missing CFF outlines" : "missing glyf/loca outlines");
}

/** Two tables may abut but not share a byte; a font that overlaps them is describing two things at once. */
function withoutOverlap(spans: Array<[number, number]>): void {
	const sorted = [...spans].sort((left, right) => left[0] - right[0]);
	for (let index = 1; index < sorted.length; index++) {
		if (sorted[index][0] < sorted[index - 1][1]) invalid("tables overlap");
	}
}

function checkSfnt(bytes: Buffer): void {
	if (bytes.length < 12) invalid("truncated header");
	const flavor = bytes.readUInt32BE(0);
	const count = bytes.readUInt16BE(4);
	const directoryEnd = 12 + count * 16;
	if (count === 0 || directoryEnd > bytes.length) invalid("the table directory does not fit in the file");

	const tags = new Set<string>();
	const spans: Array<[number, number]> = [];
	for (let index = 0; index < count; index++) {
		const record = 12 + index * 16;
		const tag = bytes.toString("latin1", record, record + 4);
		const offset = bytes.readUInt32BE(record + 8);
		const length = bytes.readUInt32BE(record + 12);
		// Both fields are unsigned 32-bit, so the sum is exact in a double and cannot wrap.
		if (offset < directoryEnd || offset + length > bytes.length) invalid(`table ${tag} lies outside the file`);
		if (tags.has(tag)) invalid(`duplicate ${tag} table`);
		tags.add(tag);
		spans.push([offset, offset + length]);
	}
	withoutOverlap(spans);
	requiredTables(flavor, tags);
}

function checkWoff(bytes: Buffer): void {
	if (bytes.length < 44) invalid("truncated header");
	const flavor = bytes.readUInt32BE(4);
	const declared = bytes.readUInt32BE(8);
	const count = bytes.readUInt16BE(12);
	const sfntSize = bytes.readUInt32BE(16);
	const directoryEnd = 44 + count * 20;
	if (count === 0 || directoryEnd > bytes.length) invalid("the table directory does not fit in the file");
	if (declared > bytes.length) invalid("the declared length is larger than the file");
	if (sfntSize > MAX_FONT_SIZE) invalid("the decompressed font would exceed 32 MiB");

	const tags = new Set<string>();
	const spans: Array<[number, number]> = [];
	for (let index = 0; index < count; index++) {
		const entry = 44 + index * 20;
		const tag = bytes.toString("latin1", entry, entry + 4);
		const offset = bytes.readUInt32BE(entry + 4);
		const stored = bytes.readUInt32BE(entry + 8);
		const original = bytes.readUInt32BE(entry + 12);
		// A stored table is written uncompressed and both lengths agree; deflate never grows one.
		if (original > MAX_FONT_SIZE || stored > original) invalid(`table ${tag} declares an impossible length`);
		if (offset < directoryEnd || offset + stored > bytes.length) invalid(`table ${tag} lies outside the file`);
		if (tags.has(tag)) invalid(`duplicate ${tag} table`);
		tags.add(tag);
		spans.push([offset, offset + stored]);
	}
	withoutOverlap(spans);
	requiredTables(flavor, tags);
}

/**
 * WOFF2's variable-width length, which is where a table directory can lie cheaply.
 *
 * Five bytes at most, no leading `0x80` — the spec forbids the padded spelling so that one length
 * has one encoding — and the running value is bounded before each shift so a long sequence cannot
 * quietly become a small number.
 */
function readBase128(bytes: Buffer, cursor: { at: number }): number {
	let value = 0;
	for (let byte = 0; byte < 5; byte++) {
		if (cursor.at >= bytes.length) invalid("truncated table directory");
		const digit = bytes[cursor.at++];
		if (byte === 0 && digit === 0x80) invalid("a padded length in the table directory");
		if (value > 0x01ffffff) invalid("a length in the table directory exceeds 32 bits");
		value = value * 128 + (digit & 0x7f);
		if ((digit & 0x80) === 0) return value;
	}
	invalid("a length in the table directory is longer than five bytes");
}

/** Bounded so a small file cannot ask for an unbounded allocation on the main process. */
function decompress(compressed: Buffer): Buffer {
	try {
		return brotliDecompressSync(compressed, { maxOutputLength: MAX_FONT_SIZE });
	} catch (cause) {
		throw new Error("Invalid font: the compressed table stream could not be read", { cause });
	}
}

function checkWoff2(bytes: Buffer): void {
	if (bytes.length < 48) invalid("truncated header");
	const flavor = bytes.readUInt32BE(4);
	const declared = bytes.readUInt32BE(8);
	const count = bytes.readUInt16BE(12);
	const sfntSize = bytes.readUInt32BE(16);
	const compressedSize = bytes.readUInt32BE(20);
	if (count === 0) invalid("the font declares no tables");
	if (declared > bytes.length) invalid("the declared length is larger than the file");
	if (sfntSize > MAX_FONT_SIZE) invalid("the decompressed font would exceed 32 MiB");

	const cursor = { at: 48 };
	const tags = new Set<string>();
	let expected = 0;
	for (let index = 0; index < count; index++) {
		if (cursor.at >= bytes.length) invalid("truncated table directory");
		const flags = bytes[cursor.at++];
		const known = flags & 0x3f;
		let tag: string;
		if (known === WOFF2_CUSTOM_TAG) {
			if (cursor.at + 4 > bytes.length) invalid("truncated table directory");
			tag = bytes.toString("latin1", cursor.at, cursor.at + 4);
			cursor.at += 4;
		} else {
			tag = WOFF2_TAGS[known] ?? `#${known}`;
		}
		const original = readBase128(bytes, cursor);
		/*
		 * Which version means "left alone" is not the same for every table: glyf and loca have a
		 * transform defined, so 3 is their null version, while everything else has none and 0 is.
		 * A transformed table carries a second length, and reading the directory past that point
		 * depends on getting this right.
		 */
		const version = flags >> 6;
		const transformed = known === WOFF2_GLYF || known === WOFF2_LOCA ? version !== 3 : version !== 0;
		const length = transformed ? readBase128(bytes, cursor) : original;
		if (original > MAX_FONT_SIZE || length > MAX_FONT_SIZE) invalid(`table ${tag} declares an impossible length`);
		if (tags.has(tag)) invalid(`duplicate ${tag} table`);
		tags.add(tag);
		expected += length;
		if (expected > MAX_FONT_SIZE) invalid("the decompressed tables would exceed 32 MiB");
	}

	if (cursor.at + compressedSize > bytes.length) invalid("the compressed stream lies outside the file");
	// The tables are stored back to back with no padding, so the stream is exactly their total.
	if (decompress(bytes.subarray(cursor.at, cursor.at + compressedSize)).length < expected) {
		invalid("the compressed stream is shorter than the tables it declares");
	}
	requiredTables(flavor, tags);
}

/**
 * Check the bytes against the name they arrived under, and answer with the format.
 *
 * `extension` is whatever the picker gave — `.TTF` as readily as `ttf` — because the two callers
 * are the import path, which has a filename, and the load path, which has the format recorded when
 * that file was first accepted.
 */
export function validateFont(bytes: Buffer, extension: string): ImportedFont["format"] {
	// First, before anything reads a header: the size is the one bound that is not self-reported.
	if (bytes.length > MAX_FONT_SIZE) throw new Error("Font file must not exceed 32 MiB");
	if (bytes.length === 0) invalid("the file is empty");

	const claimed = EXTENSIONS[extension.replace(/^\./u, "").toLowerCase()];
	if (!claimed) invalid(`${extension || "a name with no extension"} is not a font extension this app accepts`);
	const actual = container(bytes);
	if (!actual) invalid("the file does not begin with a font signature");
	if (actual !== claimed) invalid(`the file is ${actual}, not the ${claimed} its name claims`);

	if (claimed === "woff") checkWoff(bytes);
	else if (claimed === "woff2") checkWoff2(bytes);
	else checkSfnt(bytes);
	return claimed;
}
