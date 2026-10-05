/**
 * Are fenced code blocks actually highlighted, and do they actually follow 代码外观?
 *
 * `node --experimental-strip-types e2e/markdown-code-probe.ts [dir]`
 *
 * The complaint this exists for was specific: an nginx config in an assistant reply came back as
 * one flat colour. The cause was `asLanguage` failing to unwrap a `StreamLanguage`, which silently
 * dropped every grammar that arrives that way — nginx, bash, yaml, dockerfile, ini, toml — while
 * leaving the ones with a `LanguageSupport` wrapper working, so the feature looked present.
 *
 * A rendered `.md` file goes through the same `Markdown` component as a reply, so this measures
 * that path. The measurement is the number of *distinct colours* in the block: a grammar that
 * failed to load produces exactly one, and no amount of correct-looking markup changes that.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const dir = process.argv[2] ?? "/tmp/lyra-mdcode";
const project = join(dir, "proj");

/** One block per grammar that was broken, plus two that were not, as a control. */
const DOC = `# 代码块

\`\`\`nginx
# 反向代理
server {
    listen 80;
    server_name example.com;
    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
    }
}
\`\`\`

\`\`\`bash
# 构建并推送
set -euo pipefail
for name in api web; do
  docker build -t "registry/\${name}:latest" "./\${name}"
done
\`\`\`

\`\`\`yaml
# 部署
services:
  api:
    image: registry/api:latest
    ports: ["8080:8080"]
\`\`\`

\`\`\`dockerfile
# 构建阶段
FROM node:24-alpine AS build
ENV NODE_ENV=production
WORKDIR /app
RUN npm ci --omit=dev
CMD ["node", "server.js"]
\`\`\`

\`\`\`vue
<template>
  <div :class="{ active: on }" @click="on = !on">{{ label }}</div>
</template>
<script setup lang="ts">
const on = ref(false)
const label = computed(() => (on.value ? "开" : "关"))
</script>
\`\`\`

\`\`\`ts
export function add(a: number, b: number): number {
  // 控制组：这个语法从来没坏过
  return a + b;
}
\`\`\`

\`\`\`toml
[package]
name = "demo"
version = "0.1.0"
\`\`\`
`;

async function seed(home: string): Promise<void> {
	await mkdir(project, { recursive: true });
	await writeFile(join(project, "blocks.md"), DOC);
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1240, height: 900, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: [{ id: "e2e", name: "proj", path: project, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: null,
			permissionMode: "auto",
			thinking: "medium",
			retryAttempts: 3,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4523, token: null },
			appearance: { theme: "dark", codeFontSize: 12, codeFontWeight: 400, codeLetterSpacing: 0 },
		}),
	);
}

const app = await startApp({ port: 9477, seed });
const settle = (ms = 700) => new Promise((resolve) => setTimeout(resolve, ms));

let failures = 0;
function check(label: string, passed: boolean, evidence: string): void {
	if (!passed) failures++;
	process.stdout.write(`${passed ? "✓" : "✗"} ${label}\n    ${evidence}\n`);
}

try {
	await mkdir(dir, { recursive: true });
	await settle(2200);

	await app.evaluate(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		document.querySelector('button[aria-label="面板"]')?.click();
		await wait(250);
		[...document.querySelectorAll('[role="menuitem"]')].find((b) => b.innerText.trim().startsWith("文件"))?.click();
		await wait(1000);
		const row = [...document.querySelectorAll("[role=treeitem]")].find((r) => r.getAttribute("data-path")?.endsWith("blocks.md"));
		row?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
		await wait(2000);
		return true;
	})()`);
	await settle(2500);

	/**
	 * Every block, described by what it is actually painted as.
	 *
	 * `colours` is the load-bearing number. A block whose grammar never loaded still renders — the
	 * text is there, the background is there — it simply has one colour throughout. Counting the
	 * distinct computed colours of its spans is the only measurement that tells the two apart.
	 */
	type Block = { lang: string; colours: number; spans: number; size: string; weight: string; tracking: string; family: string; palette: string; head: string };
	const blocks = await app.evaluate<Block[]>(`(() => {
		return [...document.querySelectorAll(".prose-dw pre code")].map((code) => {
			const spans = [...code.querySelectorAll("span")];
			const colours = new Set(spans.map((s) => getComputedStyle(s).color));
			const own = getComputedStyle(code);
			return {
				lang: code.parentElement?.getAttribute("data-lang") ?? code.getAttribute("data-lang") ?? (code.className || code.parentElement?.className || "?").slice(0, 20),
				colours: colours.size,
				spans: spans.length,
				size: own.fontSize,
				weight: own.fontWeight,
				tracking: own.letterSpacing,
				family: own.fontFamily.split(",")[0],
				palette: [...colours].map((c) => c.replace(/\\s/g, "")).join(" "),
				head: (code.textContent ?? "").trim().split("\\n")[0].slice(0, 22),
			};
		});
	})()`);

	process.stdout.write(`找到 ${blocks.length} 个代码块\n`);
	for (const block of blocks) {
		process.stdout.write(
			`  ${block.head.padEnd(24)} 颜色 ${String(block.colours).padStart(2)} 种 / ${String(block.spans).padStart(3)} span   ${block.palette}\n`,
		);
	}
	process.stdout.write("\n");

	check("每种语言都渲染出了代码块", blocks.length >= 7, `${blocks.length} 个`);
	const flat = blocks.filter((b) => b.colours <= 1);
	check(
		"没有一个代码块是单色的（单色就是语法没加载）",
		flat.length === 0,
		flat.length === 0 ? "全部都有多种 token 颜色" : `单色的：${flat.map((b) => b.lang).join("、")}`,
	);
	/*
	 * Three colours, because two is what a block with no comments legitimately produces.
	 *
	 * Every sample above contains a comment, which is the strongest single signal that a grammar
	 * loaded: comment colour is distinct in every theme, and a block that failed to parse renders
	 * its comments as ordinary text. So three is "keyword, value, comment" — the floor for a
	 * grammar that is genuinely working rather than merely present.
	 */
	const weak = blocks.filter((b) => b.colours < 3);
	check(
		"每个代码块至少分出 3 种 token 颜色",
		weak.length === 0,
		weak.length === 0 ? "都 ≥3 种" : weak.map((b) => `${b.lang}=${b.colours}`).join("、"),
	);

	/* ---------- 代码外观 reaches the blocks too ---------- */

	const before = blocks[0];
	await app.evaluate(`(() => {
		document.querySelector("[data-ly-open-settings]")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		return true;
	})()`);
	await settle(1100);
	await app.evaluate(`(() => {
		[...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "外观")?.click();
		return true;
	})()`);
	await settle(900);
	const setNumber = async (label: string, value: number) =>
		app.evaluate<boolean>(`(() => {
			const input = document.querySelector('input[aria-label=${JSON.stringify(label)}]');
			if (!input) return false;
			Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(String(value))});
			input.dispatchEvent(new Event("input", { bubbles: true }));
			return true;
		})()`);
	await setNumber("代码字体大小", 18);
	await settle(400);
	await setNumber("字重", 600);
	await settle(400);
	await setNumber("字距", 0.06);
	await settle(1200);
	await app.evaluate(`(() => {
		[...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "返回工作区")?.click();
		return true;
	})()`);
	await settle(2200);

	const after = await app.evaluate<Block[]>(`(() => {
		const code = document.querySelector(".prose-dw pre code");
		if (!code) return [];
		const own = getComputedStyle(code);
		return [{ lang: "first", colours: 0, spans: 0, size: own.fontSize, weight: own.fontWeight, tracking: own.letterSpacing, family: own.fontFamily.split(",")[0] }];
	})()`);

	const shot = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(dir, "blocks.png"), Buffer.from(shot.data, "base64"));

	if (before && after[0]) {
		check("代码块的字号跟着设置走", before.size !== after[0].size, `${before.size} → ${after[0].size}`);
		check("代码块的字重跟着设置走", before.weight !== after[0].weight, `${before.weight} → ${after[0].weight}`);
		check("代码块的字间距跟着设置走", before.tracking !== after[0].tracking, `${before.tracking} → ${after[0].tracking}`);
	} else {
		check("改设置后代码块还在", false, `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
	}

	process.stdout.write(`\n截图：${join(dir, "blocks.png")}\n`);
} finally {
	await app.stop();
}

process.exit(failures === 0 ? 0 : 1);
