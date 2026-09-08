import assert from "node:assert/strict";
import { test } from "node:test";
import { browserAddressLike, browserOmnibox, browserSearchCustom, browserUrl, parseBrowserCommand } from "../shared/browser.ts";

test("browser IPC validates untyped commands and does not allow privileged navigation", () => {
	for (const url of ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,hi", "devtools://inspect"]) assert.throws(() => browserUrl(url));
	assert.equal(browserUrl("localhost:3000"), "https://localhost:3000/");
	assert.equal(browserUrl("about:blank"), "about:blank");
	for (const command of [null, {}, {type:"close"}, {type:"open",url:"https://example.com",sessionId:5}, {type:"zoom",id:"tab",factor:NaN}, {type:"zoom",id:"tab",factor:4}, {type:"viewport",id:"tab",viewport:{width:400.5,height:800}}]) assert.throws(() => parseBrowserCommand(command));
	assert.deepEqual(parseBrowserCommand({type:"viewport",id:"tab",viewport:{width:390,height:844}}), {type:"viewport",id:"tab",viewport:{width:390,height:844}});
});

test("the address bar tells an address from a query", () => {
	// Addresses: schemes, hosts with a real last label, ports, literal IPs, paths and queries.
	for (const text of ["example.com", "https://example.com/a?b=1", "mail.google.com", "example.com/搜索", "localhost", "localhost:3000", "127.0.0.1:8080", "192.168.1.1", "[::1]:8080", "例子.中国", "about:blank", "ly-preview://s/p/index.html"]) assert.equal(browserAddressLike(text), true, text);
	// Queries: anything with a space, a bare word, numbers that only look like hosts, and — the
	// one that matters — a scheme with no `//`, which must never navigate.
	for (const text of ["天气", "rust 教程", "什么是 tRPC", "3.14", "1.5.0", "hello world", "example.com 打不开", "javascript:alert(1)", "data:text/html,hi", "mailto:a@b.com", "a.b", "", "   "]) assert.equal(browserAddressLike(text), false, text);
});

test("a query goes to the configured engine, and a broken custom template falls back", () => {
	assert.deepEqual(browserOmnibox(" example.com "), { kind: "open", url: "https://example.com/", query: "example.com" });
	assert.equal(browserOmnibox("今天 天气").url, "https://www.bing.com/search?q=%E4%BB%8A%E5%A4%A9%20%E5%A4%A9%E6%B0%94");
	assert.equal(browserOmnibox("rust", { searchEngine: "google" }).url, "https://www.google.com/search?q=rust");
	assert.equal(browserOmnibox("rust", { searchEngine: "baidu" }).url, "https://www.baidu.com/s?ie=utf-8&wd=rust");
	assert.equal(browserOmnibox("rust", { searchEngine: "custom", searchUrl: "https://s.example.com/find?q=%s&hl=zh" }).url, "https://s.example.com/find?q=rust&hl=zh");
	// A custom engine with nowhere to put the query would otherwise search for the template itself.
	for (const searchUrl of [undefined, "", "https://s.example.com/find"]) assert.equal(browserOmnibox("rust", { searchEngine: "custom", searchUrl }).url, "https://www.bing.com/search?q=rust");
	// `&`, `#` and `?` have to survive as part of the query rather than becoming URL structure.
	assert.equal(browserOmnibox("a&b#c?d").url, "https://www.bing.com/search?q=a%26b%23c%3Fd");
	// The address bar refuses what the browser refuses, instead of quietly searching for it.
	assert.throws(() => browserOmnibox("file:///etc/passwd"));
	for (const template of ["https://s.example.com/find", "javascript:alert(%s)", "not a url %s"]) assert.throws(() => browserSearchCustom(template), undefined, template);
	assert.equal(browserSearchCustom(" https://s.example.com/find?q=%s "), "https://s.example.com/find?q=%s");
});
