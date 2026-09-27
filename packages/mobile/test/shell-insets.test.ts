/**
 * The phone's chrome, handed to the page.
 *
 * The WebView runs edge to edge; the page keeps its controls clear of the notch and the home
 * indicator using numbers this side measures. Two things have to be right: which numbers (the home
 * indicator is behind the keyboard while it is up), and that the script lands whenever it runs —
 * including before the document has an element to put them on.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

import { insetScript, pageInsets } from "../src/shell-insets.ts";

const PORTRAIT = { top: 62, right: 0, bottom: 34, left: 0 };

test("portrait: the status bar and the home indicator are passed through", () => {
	assert.deepEqual(pageInsets(PORTRAIT, false), PORTRAIT);
});

test("with the keyboard up the home indicator is behind it, so nothing is reserved for it", () => {
	assert.deepEqual(pageInsets(PORTRAIT, true), { ...PORTRAIT, bottom: 0 });
});

test("landscape keeps the notch's side and the shorter home indicator", () => {
	const landscape = { top: 0, right: 62, bottom: 21, left: 62 };
	assert.deepEqual(pageInsets(landscape, false), landscape);
});

test("fractions are kept to two places, and nothing negative gets through", () => {
	assert.deepEqual(pageInsets({ top: 47.333333, right: -1, bottom: 20.004, left: 0 }, false), {
		top: 47.33,
		right: 0,
		bottom: 20,
		left: 0,
	});
});

/** A document stub that records what the script wrote. */
function fakeDocument(withRoot: boolean) {
	const properties = new Map<string, string>();
	const attributes = new Map<string, string>();
	const listeners: (() => void)[] = [];
	const root = {
		style: { setProperty: (name: string, value: string) => properties.set(name, value) },
		setAttribute: (name: string, value: string) => attributes.set(name, value),
	};
	const document = {
		documentElement: withRoot ? root : null,
		addEventListener: (_type: string, listener: () => void) => listeners.push(listener),
	};
	return { document, root, properties, attributes, listeners };
}

test("the script writes all four sides and marks the numbers as the shell's", () => {
	const page = fakeDocument(true);
	runInNewContext(insetScript({ top: 62, right: 0, bottom: 34, left: 0 }), { document: page.document });
	assert.equal(page.properties.get("--ly-native-top"), "62px");
	assert.equal(page.properties.get("--ly-native-bottom"), "34px");
	assert.equal(page.properties.get("--ly-native-left"), "0px");
	assert.equal(page.properties.get("--ly-native-right"), "0px");
	assert.equal(page.attributes.get("data-lyra-shell"), "native");
});

test("injected before the document exists, it waits for it instead of being lost", () => {
	const page = fakeDocument(false);
	runInNewContext(insetScript(PORTRAIT), { document: page.document });
	assert.equal(page.properties.size, 0);
	assert.equal(page.listeners.length, 1, "等文档出现");
	page.document.documentElement = page.root;
	page.listeners[0]();
	assert.equal(page.properties.get("--ly-native-top"), "62px");
});
