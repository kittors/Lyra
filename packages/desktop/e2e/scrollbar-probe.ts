/**
 * 文件预览的滚动条，量在真窗口里。
 *
 * `node --experimental-strip-types e2e/scrollbar-probe.ts [dir]`
 *
 * 报的问题有三件：滑块长度跟内容对不上、短文件也长出一条横向滚动条、拖不到底也拖不到最右。
 * 三件都只在编辑器实际排完版之后才成立，所以这里量的是 `.cm-scroller` 自己报的数，以及
 * `OverlayScrollbar` 依据那些数画出来的滑块 —— 两边一起读，才分得清是「量错了」还是「画错了」。
 *
 * 两个文件：一个短、行也短（横向本不该有滚动条），一个长、且带一条超长行（两个方向都该能滚到尽头）。
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const dir = process.argv[2] ?? "/tmp/lyra-scrollbar";
const project = join(dir, "proj");

/** 35 行，全是短行 —— 截图里那个 .gitignore 的形状。 */
const SHORT = Array.from({ length: 35 }, (_, i) => `line-${i + 1}`).join("\n");

/**
 * 120 行，超长的那行排在第一行。
 *
 * 位置是要紧的：CodeMirror 只排视口里的行，横向能滚多远由「已经画出来的行里最宽的那条」决定。
 * 长行摆在第 41 行的话，刚打开时它还没画，横向本来就不该有滚动条——那样测不到两条轨道在角落
 * 相遇的情形，而那正是「拖不到底」的现场。
 */
const LONG = Array.from({ length: 120 }, (_, i) =>
	i === 0 ? `const wide = "${"x".repeat(400)}";` : `const n${i} = ${i};`,
).join("\n");

async function seed(home: string): Promise<void> {
	await mkdir(project, { recursive: true });
	await writeFile(join(project, "short.txt"), SHORT);
	await writeFile(join(project, "long.ts"), LONG);
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1400, height: 900, x: 0, y: 0 }));
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
			sync: { enabled: false, port: 4527, token: null },
			appearance: { theme: "dark" },
		}),
	);
}

const app = await startApp({ port: 9712, seed });
const settle = (ms = 700) => new Promise((resolve) => setTimeout(resolve, ms));

const open = (name: string) =>
	app.evaluate<boolean>(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		if (!document.querySelector("[data-ly-tree]")) {
			document.querySelector('button[aria-label="面板"]')?.click();
			await wait(250);
			[...document.querySelectorAll('[role="menuitem"]')].find((b) => b.innerText.trim().startsWith("文件"))?.click();
			await wait(1200);
		}
		const row = [...document.querySelectorAll("[role=treeitem]")].find((r) => r.getAttribute("data-path")?.endsWith(${JSON.stringify(name)}));
		row?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
		await wait(1800);
		return Boolean(row);
	})()`);

type Shot = {
	found: boolean;
	/** `.cm-scroller` 自己报的几何。 */
	clientW: number;
	clientH: number;
	scrollW: number;
	scrollH: number;
	scrollTop: number;
	scrollLeft: number;
	/** 内部的三块，用来解释 scrollW/scrollH 是被谁撑大的。 */
	contentW: number;
	contentH: number;
	contentPadBottom: string;
	guttersW: number;
	scrollerDisplay: string;
	/** 画出来的滑块。 */
	vThumb: { top: number; height: number } | null;
	vTrack: { top: number; height: number } | null;
	hThumb: { left: number; width: number } | null;
	hTrack: { left: number; width: number } | null;
	/** 期望的滑块长度，按 `OverlayScrollbar` 的公式重算一遍。 */
	vExpected: number;
	hExpected: number;
};

const READ = `(() => {
	const el = document.querySelector(".cm-scroller");
	if (!el) return { found: false };
	const content = el.querySelector(".cm-content");
	const gutters = el.querySelector(".cm-gutters");
	const host = el.closest(".ly-scroll-host");
	const tracks = host ? [...host.children].filter((n) => n !== el.closest(".ly-cm")) : [];
	const box = (n) => {
		if (!n) return null;
		const r = n.getBoundingClientRect();
		return { top: Math.round(r.top), height: Math.round(r.height), left: Math.round(r.left), width: Math.round(r.width) };
	};
	const vTrackEl = tracks.find((n) => n.className.includes("w-[10px]"));
	const hTrackEl = tracks.find((n) => n.className.includes("h-[10px]"));
	const size = (len, total) => (total - len > 1 ? Math.max(28, (len / total) * len) : 0);
	return {
		found: true,
		clientW: el.clientWidth,
		clientH: el.clientHeight,
		scrollW: el.scrollWidth,
		scrollH: el.scrollHeight,
		scrollTop: Math.round(el.scrollTop),
		scrollLeft: Math.round(el.scrollLeft),
		contentW: content ? Math.round(content.getBoundingClientRect().width) : -1,
		contentH: content ? Math.round(content.getBoundingClientRect().height) : -1,
		contentPadBottom: content ? getComputedStyle(content).paddingBottom : "无",
		guttersW: gutters ? Math.round(gutters.getBoundingClientRect().width) : -1,
		scrollerDisplay: getComputedStyle(el).display,
		vTrack: box(vTrackEl),
		vThumb: box(vTrackEl?.firstElementChild),
		hTrack: box(hTrackEl),
		hThumb: box(hTrackEl?.firstElementChild),
		vExpected: Math.round(size(el.clientHeight, el.scrollHeight)),
		hExpected: Math.round(size(el.clientWidth, el.scrollWidth)),
	};
})()`;

/** 推到尽头，看它停在哪 —— 「滚不到底」是这里量出来的。 */
const PUSH_END = `(async () => {
	const wait = (ms) => new Promise((r) => setTimeout(r, ms));
	const el = document.querySelector(".cm-scroller");
	if (!el) return { found: false };
	el.scrollTop = 1e9;
	el.scrollLeft = 1e9;
	await wait(500);
	const lines = [...el.querySelectorAll(".cm-line")];
	const last = lines[lines.length - 1];
	const lastRect = last ? last.getBoundingClientRect() : null;
	const viewRect = el.getBoundingClientRect();
	return {
		found: true,
		scrollTop: Math.round(el.scrollTop),
		scrollLeft: Math.round(el.scrollLeft),
		maxTop: Math.round(el.scrollHeight - el.clientHeight),
		maxLeft: Math.round(el.scrollWidth - el.clientWidth),
		lastLineText: last ? last.textContent.slice(0, 24) : "无",
		lastLineBottom: lastRect ? Math.round(lastRect.bottom) : -1,
		viewBottom: Math.round(viewRect.bottom),
	};
})()`;

function report(label: string, shot: Shot): void {
	if (!shot.found) {
		process.stdout.write(`  ${label}: 没找到 .cm-scroller\n`);
		return;
	}
	const vOk = shot.vThumb && Math.abs(shot.vThumb.height - shot.vExpected) <= 2;
	const hOverflow = shot.scrollW - shot.clientW > 1;
	/*
	 * 滑块在轨道上的位置，不只是它多长。
	 *
	 * 上一版只对了长度就放行，于是漏掉了真正扎眼的那个：内容滚到最后一行，滑块还贴在顶端。
	 * 位置按滚动进度反算——滑到哪一格，滑块就该在轨道的哪一格上。
	 */
	const seat = (
		thumb: { top: number; height: number } | { left: number; width: number } | null,
		track: { top: number; height: number } | { left: number; width: number } | null,
		at: number,
		max: number,
		start: (b: { top: number; left: number }) => number,
		len: (b: { height: number; width: number }) => number,
	) => {
		if (!thumb || !track || max <= 0) return "—";
		const travel = len(track as never) - len(thumb as never);
		const want = travel * (at / max);
		const got = start(thumb as never) - start(track as never);
		return `${Math.round(got)}/${Math.round(travel)} 应在 ${Math.round(want)} ${Math.abs(got - want) <= 2 ? "✓" : "✗ 位置不对"}`;
	};
	process.stdout.write(
		`  ${label}\n` +
			`      视口 ${shot.clientW}x${shot.clientH}  内容 ${shot.scrollW}x${shot.scrollH}` +
			`  (超出 横 ${shot.scrollW - shot.clientW} / 纵 ${shot.scrollH - shot.clientH})\n` +
			`      .cm-content ${shot.contentW}x${shot.contentH} padding-bottom=${shot.contentPadBottom}` +
			`  gutters ${shot.guttersW}px  scroller display=${shot.scrollerDisplay}\n` +
			`      竖滑块 高=${shot.vThumb?.height ?? "无"} 期望=${shot.vExpected} ${vOk ? "✓" : "✗"}` +
			`  轨道高=${shot.vTrack?.height ?? "无"}  位置 ${seat(shot.vThumb, shot.vTrack, shot.scrollTop, shot.scrollH - shot.clientH, (b) => b.top, (b) => b.height)}\n` +
			`      横滑块 宽=${shot.hThumb?.width ?? "无"} 期望=${shot.hExpected}` +
			`  轨道宽=${shot.hTrack?.width ?? "无"}  位置 ${seat(shot.hThumb, shot.hTrack, shot.scrollLeft, shot.scrollW - shot.clientW, (b) => b.left, (b) => b.width)}` +
			`  横向该有滚动条吗: ${hOverflow ? "有溢出" : "没有溢出"}\n`,
	);
}

try {
	await mkdir(dir, { recursive: true });
	await settle(2600);

	for (const name of ["short.txt", "long.ts"]) {
		const opened = await open(name);
		if (!opened) {
			process.stdout.write(`  打不开 ${name}\n`);
			continue;
		}
		await settle(1500);
		process.stdout.write(`\n${name}\n`);
		report("初始", await app.evaluate<Shot>(READ));

		const end = await app.evaluate<{
			found: boolean;
			scrollTop: number;
			scrollLeft: number;
			maxTop: number;
			maxLeft: number;
			lastLineText: string;
			lastLineBottom: number;
			viewBottom: number;
		}>(PUSH_END);
		if (end.found) {
			process.stdout.write(
				`      推到尽头: scrollTop=${end.scrollTop}/${end.maxTop}  scrollLeft=${end.scrollLeft}/${end.maxLeft}\n` +
					`      最后一行 ${JSON.stringify(end.lastLineText)} 底边=${end.lastLineBottom} 视口底=${end.viewBottom}` +
					` ${end.lastLineBottom <= end.viewBottom && end.lastLineBottom > 0 ? "✓ 看得见" : "✗ 被切掉"}\n`,
			);
		}
		report("到底后", await app.evaluate<Shot>(READ));
	}

	/*
	 * 拖到底，用滑块拖，不是给 scrollTop 赋值。
	 *
	 * 报的是「拖不到底」，而给 `scrollTop` 赋一个大数永远能到底——那条路径根本不经过滑块。这里
	 * 走真事件：在滑块上按下，把鼠标甩到远超轨道长度的地方，松开。滑块自己算得对、又没被另一条
	 * 轨道接走鼠标，才停得到尽头。
	 */
	for (const [label, orientation] of [["竖", "vertical"], ["横", "horizontal"]] as const) {
		const dragged = await app.evaluate<{ ok: boolean; at: number; max: number }>(`(async () => {
			const wait = (ms) => new Promise((r) => setTimeout(r, ms));
			const el = document.querySelector(".cm-scroller");
			const host = el?.closest(".ly-scroll-host");
			if (!el || !host) return { ok: false, at: -1, max: -1 };
			const vertical = ${JSON.stringify(orientation)} === "vertical";
			const track = [...host.children].find((n) => typeof n.className === "string" && n.className.includes(vertical ? "w-[10px]" : "h-[10px]"));
			const thumb = track?.firstElementChild;
			if (!thumb) return { ok: false, at: -2, max: -2 };
			if (vertical) el.scrollTop = 0; else el.scrollLeft = 0;
			await wait(200);
			const r = thumb.getBoundingClientRect();
			thumb.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
			await wait(60);
			// 甩到远处：只要滑块算得对，行程走完就该停在尽头。
			window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: r.left + (vertical ? 0 : 4000), clientY: r.top + (vertical ? 4000 : 0) }));
			await wait(200);
			window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
			await wait(200);
			return {
				ok: true,
				at: Math.round(vertical ? el.scrollTop : el.scrollLeft),
				max: Math.round(vertical ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth),
			};
		})()`);
		process.stdout.write(
			`      拖${label}滑块到底: ${dragged.at}/${dragged.max}` +
				` ${dragged.ok && dragged.max > 0 && dragged.max - dragged.at <= 1 ? "✓ 到位" : "✗ 没到"}\n`,
		);
	}

	/* 两条轨道在右下角谁压着谁 —— 「拖不到底」多半是这里。 */
	const corner = await app.evaluate<{ vBottom: number; hTop: number; hRight: number; vLeft: number; topmost: string }>(
		`(() => {
			// 编辑器那一个，不是页面上第一个：输入框自己也是 .ly-scroll-host，而它只有竖的一条。
			const host = document.querySelector(".cm-scroller")?.closest(".ly-scroll-host");
			const tracks = host ? [...host.children].filter((n) => typeof n.className === "string" && n.className.includes("absolute")) : [];
			const v = tracks.find((n) => n.className.includes("w-[10px]"));
			const h = tracks.find((n) => n.className.includes("h-[10px]"));
			if (!v || !h) return { vBottom: -1, hTop: -1, hRight: -1, vLeft: -1, topmost: "缺一条轨道" };
			const vr = v.getBoundingClientRect();
			const hr = h.getBoundingClientRect();
			const hit = document.elementFromPoint(vr.left + 5, hr.top + 5);
			return {
				vBottom: Math.round(vr.bottom),
				hTop: Math.round(hr.top),
				hRight: Math.round(hr.right),
				vLeft: Math.round(vr.left),
				topmost: hit ? hit.className.toString().slice(0, 60) : "无",
			};
		})()`,
	);
	process.stdout.write(
		`\n右下角\n      竖轨道底=${corner.vBottom}  横轨道顶=${corner.hTop}` +
			`  重叠 ${Math.max(0, corner.vBottom - corner.hTop)}px\n` +
			`      竖轨道左=${corner.vLeft}  横轨道右=${corner.hRight}\n` +
			`      重叠处最上层的是: ${corner.topmost}\n`,
	);
} finally {
	await app.stop();
}
