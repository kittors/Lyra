/**
 * What the window will and will not open, navigate to, or grant.
 *
 * The interesting assertions are the refusals, and each one names a way a privileged renderer stops
 * being ours: a `file:` URL handed to the OS opener runs whatever that path is associated with; a
 * navigation away from our own page loads a stranger into the window holding the preload; a
 * `<webview>` that keeps the preload hands `window.lyra` to a site.
 *
 * Only the pure half is tested here — `window-security.ts` keeps its decisions as functions over
 * strings precisely so this file needs no Electron. Whether the listeners are actually attached is
 * a question for e2e, and a different kind of mistake.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
	harden,
	isOpenable,
	isOurPage,
	isPermissionGranted,
	isWebviewSourceAllowed,
} from "../electron/security-policy.ts";

test("外链：放行 http、https、mailto", () => {
	for (const url of ["https://example.com/x", "http://192.168.1.9:8080", "mailto:a@b.c", "HTTPS://EXAMPLE.COM"]) {
		assert.equal(isOpenable(url), true, `${url} 应该放行`);
	}
});

test("外链：拒绝一切能变成本地执行的东西", () => {
	const refused = [
		// 交给系统打开一个本地路径，等于让链接决定运行什么。这是这条规则存在的理由。
		"file:///etc/passwd",
		"file:///Applications/Calculator.app",
		"javascript:alert(1)",
		"data:text/html,<script>1</script>",
		// 我们自己的内部协议也不该交给系统去打开。
		"ly-media://f/x",
		"ly-preview://s/p",
		// 别的应用的深链，等于把「打开什么」的决定权交给了链接的作者。
		"vscode://file/etc/passwd",
		"不是一个 URL",
		"",
		"//example.com",
	];
	for (const url of refused) {
		assert.equal(isOpenable(url), false, `${url} 应该被拒`);
	}
});

test("导航：自己的页面与开发服务器算自己人", () => {
	assert.equal(isOurPage("file:///app/index.html"), true);
	assert.equal(isOurPage("ly-preview://s/p/index.html"), true);
	assert.equal(isOurPage("ly-media://f/x"), true);
	assert.equal(isOurPage("http://localhost:5173/index.html", "http://localhost:5173"), true);
});

test("导航：其余一律不是", () => {
	for (const url of [
		"https://example.com",
		"http://localhost:5173/index.html", // 没有开发服务器时，它也只是一个外部地址
		"about:blank",
		"data:text/html,x",
		"",
	]) {
		assert.equal(isOurPage(url, undefined), false, `${url} 不该被当成我们的页面`);
	}
});

test("导航：开发服务器按 origin 比对，不是按前缀", () => {
	const dev = "http://localhost:5173";

	// 这三条是 `startsWith` 会放过而 origin 比对不会的。第二条最要命：
	// 一个敌意站点只要把开发服务器地址放进自己的域名里，前缀就匹配上了。
	assert.equal(isOurPage("http://localhost:51730/x", dev), false, "另一个端口不是同一个源");
	assert.equal(isOurPage("https://localhost:5173.evil.com", dev), false, "域名里带着它不算");
	assert.equal(isOurPage("https://localhost:5173", dev), false, "协议不同就不是同一个源");

	// 同源的各种写法都要认得。
	assert.equal(isOurPage("http://localhost:5173", dev), true);
	assert.equal(isOurPage("http://localhost:5173/index.html?x=1#y", dev), true);
});

test("webview：只允许 http(s)、about:blank 与预览协议", () => {
	for (const src of ["https://example.com", "http://localhost:3000", "about:blank", "ly-preview://s/p/i.html"]) {
		assert.equal(isWebviewSourceAllowed(src), true, `${src} 应该允许`);
	}
	for (const src of ["file:///etc/passwd", "ly-media://f/x", "data:text/html,x", "", "javascript:1", "about:config"]) {
		assert.equal(isWebviewSourceAllowed(src), false, `${src} 应该被拒`);
	}
});

test("webview：无论标签怎么写，客人都拿不到主人的钥匙", () => {
	const asked = {
		preload: "/path/to/preload.js",
		nodeIntegration: true,
		contextIsolation: false,
		sandbox: false,
		webSecurity: false,
	};
	harden(asked);

	assert.equal(asked.preload, undefined, "preload 必须被剥掉——它就是 window.lyra");
	assert.equal(asked.nodeIntegration, false);
	assert.equal(asked.contextIsolation, true);
	assert.equal(asked.sandbox, true);
});

test("权限：自己的页面只拿到两项", () => {
	const ours = "file:///app/index.html";
	assert.equal(isPermissionGranted(ours, "fullscreen"), true);
	assert.equal(isPermissionGranted(ours, "clipboard-sanitized-write"), true);

	// 自己的页面也不需要这些：要用摄像头会走 IPC，而不是问浏览器要。
	for (const permission of ["media", "geolocation", "notifications", "midi", "openExternal", "clipboard-read"]) {
		assert.equal(isPermissionGranted(ours, permission), false, `自己的页面也不该拿到 ${permission}`);
	}
});

test("权限：客人页面一项都没有", () => {
	for (const permission of ["fullscreen", "clipboard-sanitized-write", "media", "notifications", "geolocation"]) {
		assert.equal(isPermissionGranted("https://example.com", permission), false, `客人不该拿到 ${permission}`);
		assert.equal(isPermissionGranted("", permission), false, "没有 URL 时一律拒绝");
	}
});
