/**
 * Copying on a phone, where the page is served over plain HTTP.
 *
 * A page that is not a secure context has no `navigator.clipboard`, so every copy button threw and
 * did nothing; and the phone's bridge answered the contract's `clipboard.write` / `read` under other
 * names, so those fell through to a stub. `lendClipboard` fills both from the native side's text
 * clipboard — and only where they are missing.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { lendClipboard, type ClipboardScope } from "../src/mobile/clipboard.ts";

function nativeClipboard() {
	const written: string[] = [];
	return {
		written,
		clipboard: {
			writeText: async (text: string) => {
				written.push(text);
			},
			readText: async () => "from the phone",
		} as Record<string, unknown>,
	};
}

test("a page without navigator.clipboard gets one that writes to the phone", async () => {
	const native = nativeClipboard();
	const nav: { clipboard?: { writeText(text: string): Promise<void>; readText(): Promise<string> } } = {};
	const scope = { navigator: nav, lyra: { clipboard: native.clipboard } } as unknown as ClipboardScope;

	assert.deepEqual(lendClipboard(scope), { navigator: true, bridge: true });
	await nav.clipboard?.writeText("复制这一条");
	assert.deepEqual(native.written, ["复制这一条"]);
	assert.equal(await nav.clipboard?.readText(), "from the phone");
});

test("the contract's names are answered too, for the field menu and the file panel", async () => {
	const native = nativeClipboard();
	const scope = { navigator: { clipboard: {} }, lyra: { clipboard: native.clipboard } } as unknown as ClipboardScope;
	lendClipboard(scope);
	const bridge = native.clipboard as { write(text: string): Promise<void>; read(): Promise<string> };
	await bridge.write("/Users/maya/Projects/aurora-notes");
	assert.deepEqual(native.written, ["/Users/maya/Projects/aurora-notes"]);
	assert.equal(await bridge.read(), "from the phone");
});

test("a page that has the real clipboard keeps it", () => {
	const real = { writeText: async () => {} };
	const native = nativeClipboard();
	const nav = { clipboard: real };
	const lent = lendClipboard({ navigator: nav, lyra: { clipboard: native.clipboard } } as unknown as ClipboardScope);
	assert.equal(lent.navigator, false);
	assert.equal(nav.clipboard, real);
});

test("names the bridge already defines are not replaced", () => {
	const native = nativeClipboard();
	const own = async () => {};
	native.clipboard.write = own;
	native.clipboard.read = async () => "own";
	const lent = lendClipboard({ navigator: { clipboard: {} }, lyra: { clipboard: native.clipboard } } as unknown as ClipboardScope);
	assert.equal(lent.bridge, false);
	assert.equal(native.clipboard.write, own);
});

test("the stub the bridge answers every other name with does not count as defining one", () => {
	/*
	 * The phone's bridge wraps each group in a proxy that hands back a callable stub for any name it
	 * does not have. A lookup therefore always finds `write`; only asking whether the object has it
	 * tells the truth. This is the shape that made copying silently do nothing.
	 */
	const native = nativeClipboard();
	const stub = () => Promise.resolve(null);
	const floored = new Proxy(native.clipboard, { get: (target, name) => (name in target ? target[name as string] : stub) });
	lendClipboard({ navigator: { clipboard: {} }, lyra: { clipboard: floored } } as unknown as ClipboardScope);
	assert.notEqual(floored.write, stub, "write 应当被补上，而不是留着那个什么都不做的替身");
});

test("without a native clipboard nothing is lent", () => {
	const nav: { clipboard?: unknown } = {};
	assert.deepEqual(lendClipboard({ navigator: nav } as ClipboardScope), { navigator: false, bridge: false });
	assert.equal(nav.clipboard, undefined);
});
