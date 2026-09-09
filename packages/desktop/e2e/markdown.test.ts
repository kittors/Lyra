/**
 * How a Markdown file is drawn, in the app that will actually ship it.
 *
 * The parsing has unit tests next door — those say which characters are a container and which are a
 * sentence. What they cannot reach is everything between a token and a pixel: whether `ly-media:`
 * is registered, whether the preload forwards it, whether a `<p align="center">` survives React,
 * and whether three badges written one per line end up on one line or three.
 *
 * Every assertion here is a measurement off the real DOM, because the three regressions this file
 * exists for — a dropped alignment, a stacked badge row, an unresolved relative path — all type-
 * check perfectly and all show up only as a picture that looks wrong.
 */

import assert from "node:assert/strict";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { startApp, type RunningApp } from "./app.ts";

let app: RunningApp;

const LOGO = join(fileURLToPath(import.meta.url), "..", "..", "..", "..", "assets", "lyra.png");

/**
 * A document shaped like a README's opening, which is where all of this goes wrong.
 *
 * A centred logo with a declared width, a badge row written one link per line, a centred title, and
 * a bullet list inside the same centred box — that last one because `text-align` inherits and a
 * centred bullet list is the thing a naive fix produces.
 */
const DOC = `<p align="center">
  <img src="assets/pic.png" alt="Logo" width="120">
</p>

<p align="center">
  <a href="https://example.com/one"><img src="assets/pic.png" alt="one" width="30"></a>
  <a href="https://example.com/two"><img src="assets/pic.png" alt="two" width="30"></a>
  <a href="https://example.com/three"><img src="assets/pic.png" alt="three" width="30"></a>
</p>

<h1 align="center">居中的标题</h1>

<div align="center">
  居中的一句话。

- 第一项
- 第二项

</div>

## 普通标题

左边的一段话。

![相对路径](assets/pic.png)

段落里有 <kbd>Esc</kbd> 和 Vec<T> 以及 a < b。
`;

async function seed(home: string): Promise<void> {
	const root = join(home, "project");
	await mkdir(join(root, "assets"), { recursive: true });
	await copyFile(LOGO, join(root, "assets", "pic.png"));
	await writeFile(join(root, "doc.md"), DOC);

	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 900, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: [{ id: "e2e", name: "project", path: root, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: null,
			permissionMode: "auto",
			thinking: "medium",
			retryAttempts: 3,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4517, token: null },
		}),
	);
}

before(async () => {
	app = await startApp({ port: 9732, seed });

	// Open the files pane, then the document — the same two gestures a person makes.
	await app.evaluate(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		document.querySelector('button[aria-label="面板"]').click();
		await wait(200);
		[...document.querySelectorAll('[role="menuitem"]')].find((b) => b.innerText.trim().startsWith("文件"))?.click();
		await wait(900);
		const row = [...document.querySelectorAll("[role=treeitem]")].find((r) => r.getAttribute("data-path").endsWith("doc.md"));
		row?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
		await wait(1500);
		return true;
	})()`);
});

after(async () => {
	await app?.stop();
});

/** Everything drawn inside the rendered document, measured. */
function images<T>(): Promise<T> {
	return app.evaluate<T>(`(() => {
		const doc = document.querySelector(".prose-dw");
		return [...doc.querySelectorAll("img")].map((img) => {
			const box = img.getBoundingClientRect();
			return {
				alt: img.alt,
				scheme: img.src.split(":")[0],
				loaded: img.complete && img.naturalWidth > 0,
				width: Math.round(box.width),
				top: Math.round(box.top),
			};
		});
	})()`);
}

test("a relative src resolves against the file's own folder, and the picture draws", async () => {
	const drawn = await images<{ alt: string; scheme: string; loaded: boolean; width: number }[]>();

	assert.ok(drawn.length >= 5, `expected the logo, three badges and the markdown image, got ${drawn.length}`);
	// The private scheme, not http — the page's `img-src` never had to open up for this.
	assert.deepEqual([...new Set(drawn.map((image) => image.scheme))], ["ly-media"]);
	// `complete && naturalWidth > 0` is the browser saying it decoded actual bytes.
	assert.ok(
		drawn.every((image) => image.loaded),
		`some pictures did not decode: ${JSON.stringify(drawn.filter((i) => !i.loaded))}`,
	);
});

test("the width an author declared is honoured, as a maximum", async () => {
	const drawn = await images<{ alt: string; width: number }[]>();
	const logo = drawn.find((image) => image.alt === "Logo");

	// 440px of source, told to be 120. Without the attribute it fills the pane; with it read as a
	// fixed width rather than a cap it would overflow a narrower one.
	assert.equal(logo?.width, 120);
	assert.equal(drawn.find((image) => image.alt === "one")?.width, 30);

	// No width declared: bounded by the pane, not by the 440px source.
	const plain = drawn.find((image) => image.alt === "相对路径");
	assert.ok(plain && plain.width > 120, `an undeclared width should fill the column, got ${plain?.width}`);
});

test("badges written one per line are one row, not three", async () => {
	const drawn = await images<{ alt: string; top: number }[]>();
	const badges = drawn.filter((image) => ["one", "two", "three"].includes(image.alt));

	assert.equal(badges.length, 3);
	// Same top to the pixel: HTML collapses the newlines between them to spaces. Read as Markdown
	// they are line breaks, and this is three rows.
	assert.equal(new Set(badges.map((badge) => badge.top)).size, 1, `badges are on ${JSON.stringify(badges)}`);
});

test("align=center survives, on a container and on a heading", async () => {
	const alignment = await app.evaluate<{ logo: string; heading: string; plain: string }>(`(() => {
		const doc = document.querySelector(".prose-dw");
		const boxes = [...doc.querySelectorAll(".ly-md-html")];
		const heading = [...doc.querySelectorAll("h1")].find((h) => h.textContent.includes("居中的标题"));
		const plain = [...doc.querySelectorAll("p")].find((p) => p.textContent.includes("左边的一段话"));
		return {
			logo: getComputedStyle(boxes[0]).textAlign,
			heading: getComputedStyle(heading).textAlign,
			plain: getComputedStyle(plain).textAlign,
		};
	})()`);

	assert.equal(alignment.logo, "center");
	assert.equal(alignment.heading, "center");
	// And nothing leaked: prose outside the box is still set the way the document is.
	assert.equal(alignment.plain, "start");
});

test("a centred box does not centre a list inside it", async () => {
	const list = await app.evaluate<{ align: string; items: number }>(`(() => {
		const ul = document.querySelector(".prose-dw .ly-md-html ul");
		return { align: getComputedStyle(ul).textAlign, items: ul.querySelectorAll("li").length };
	})()`);

	assert.equal(list.items, 2);
	// Centred bullets hang off a marker that stays on the left; the box centres prose, not lists.
	assert.equal(list.align, "left");
});

test("what looks like a tag but is not one is still left alone", async () => {
	const text = await app.evaluate<string>(`(() => {
		const p = [...document.querySelectorAll(".prose-dw p")].find((el) => el.textContent.includes("段落里有"));
		return p.textContent;
	})()`);

	// `Vec<T>` and `a < b` are the reason the HTML reader has a list of names rather than a rule
	// about angle brackets. Pulling containers up to block level must not have widened that.
	assert.match(text, /Vec<T>/);
	assert.match(text, /a < b/);
	assert.match(text, /Esc/);
});
