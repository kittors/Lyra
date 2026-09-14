import { brotliCompressSync, deflateSync } from "node:zlib";
import type { ImportedFont } from "../../shared/custom-fonts.ts";

/** Minimal containers deliberately do not claim to exercise the browser's outline sanitizer. */
function tables(otf: boolean): Array<{ tag: string; bytes: Buffer }> {
	const head = Buffer.alloc(54);
	head.writeUInt32BE(0x00010000, 0);
	head.writeUInt32BE(0x5f0f3cf5, 12);
	head.writeUInt16BE(1000, 18);
	const maxp = Buffer.alloc(otf ? 6 : 32);
	maxp.writeUInt32BE(otf ? 0x00005000 : 0x00010000, 0);
	maxp.writeUInt16BE(1, 4);
	const cmap = Buffer.alloc(36);
	cmap.writeUInt16BE(1, 2);
	cmap.writeUInt16BE(3, 4);
	cmap.writeUInt16BE(1, 6);
	cmap.writeUInt32BE(12, 8);
	cmap.writeUInt16BE(4, 12);
	cmap.writeUInt16BE(24, 14);
	cmap.writeUInt16BE(2, 18);
	cmap.writeUInt16BE(2, 20);
	cmap.writeUInt16BE(0xffff, 26);
	cmap.writeUInt16BE(0xffff, 30);
	cmap.writeUInt16BE(1, 32);
	const outline = otf
		? [{ tag: "CFF ", bytes: Buffer.from([1, 0, 4, 1]) }]
		: [{ tag: "glyf", bytes: Buffer.alloc(10) }, { tag: "loca", bytes: Buffer.from([0, 0, 0, 5]) }];
	return [...outline, { tag: "cmap", bytes: cmap }, { tag: "head", bytes: head }, { tag: "maxp", bytes: maxp }]
		.sort((left, right) => left.tag.localeCompare(right.tag));
}

function pad(size: number): number {
	return Math.ceil(size / 4) * 4;
}

export function fontFixture(format: ImportedFont["format"]): Buffer {
	const entries = tables(format === "otf");
	const flavor = format === "otf" ? 0x4f54544f : 0x00010000;
	const sfntSize = 12 + entries.length * 16 + entries.reduce((sum, table) => sum + pad(table.bytes.length), 0);
	if (format === "ttf" || format === "otf") {
		const bytes = Buffer.alloc(sfntSize);
		bytes.writeUInt32BE(flavor, 0);
		bytes.writeUInt16BE(entries.length, 4);
		let offset = 12 + entries.length * 16;
		entries.forEach((table, index) => {
			const entry = 12 + index * 16;
			bytes.write(table.tag, entry, "ascii");
			bytes.writeUInt32BE(offset, entry + 8);
			bytes.writeUInt32BE(table.bytes.length, entry + 12);
			table.bytes.copy(bytes, offset);
			offset += pad(table.bytes.length);
		});
		return bytes;
	}
	if (format === "woff") {
		const stored = entries.map((table) => {
			const compressed = deflateSync(table.bytes);
			return compressed.length < table.bytes.length ? compressed : table.bytes;
		});
		const bytes = Buffer.alloc(44 + entries.length * 20 + stored.reduce((sum, table) => sum + pad(table.length), 0));
		bytes.write("wOFF", 0, "ascii");
		bytes.writeUInt32BE(flavor, 4);
		bytes.writeUInt32BE(bytes.length, 8);
		bytes.writeUInt16BE(entries.length, 12);
		bytes.writeUInt32BE(sfntSize, 16);
		let offset = 44 + entries.length * 20;
		entries.forEach((table, index) => {
			const entry = 44 + index * 20;
			bytes.write(table.tag, entry, "ascii");
			bytes.writeUInt32BE(offset, entry + 4);
			bytes.writeUInt32BE(stored[index].length, entry + 8);
			bytes.writeUInt32BE(table.bytes.length, entry + 12);
			stored[index].copy(bytes, offset);
			offset += pad(stored[index].length);
		});
		return bytes;
	}
	const indices: Record<string, number> = { cmap: 0, head: 1, maxp: 4, glyf: 0xca, loca: 0xcb };
	const directory = Buffer.from(entries.flatMap((table) => [indices[table.tag], table.bytes.length]));
	const compressed = brotliCompressSync(Buffer.concat(entries.map((table) => table.bytes)));
	const bytes = Buffer.alloc(48 + directory.length + compressed.length);
	bytes.write("wOF2", 0, "ascii");
	bytes.writeUInt32BE(flavor, 4);
	bytes.writeUInt32BE(bytes.length, 8);
	bytes.writeUInt16BE(entries.length, 12);
	bytes.writeUInt32BE(sfntSize, 16);
	bytes.writeUInt32BE(compressed.length, 20);
	directory.copy(bytes, 48);
	compressed.copy(bytes, 48 + directory.length);
	return bytes;
}
