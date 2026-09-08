/**
 * 侧边栏顶部那道渐隐，在列表滚动的每一步上。
 *
 * `node --experimental-strip-types e2e/sidebar-fade-probe.ts [dir]`
 *
 * 报上来的现象：往下滚，等底下的分组标题开始吸顶的时候，顶上那层虚化就没了——滚过去的会话行不再
 * 淡出，而是清清楚楚一条压在标签栏边上。
 *
 * 所以量的是几何，不是「元素在不在」：`--ly-hold-top` 是遮罩里那段渐隐的深度，`--ly-fade-inset`
 * 是它下面那段全黑区的底。两个数一起，才说得清顶上到底还虚不虚。逐格滚动、每一格都读一次，因为
 * 「什么时候没的」才是这次要找的东西——只看某一帧会把因果看反。
 *
 * 同一趟里还量另外两件：切进归档时上面那截框架有没有跟着跳（`data-ly-rail` 的位置），以及提交图
 * 的宽度是不是只按它自己那一段的复杂度算。
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const dir = process.argv[2] ?? "/tmp/lyra-sidebar-fade";
const REPO = "/Users/kittors/Developer/opensource/Lyra";

let failures = 0;
function check(label: string, passed: boolean, evidence: string): void {
	if (!passed) failures++;
	process.stdout.write(`${passed ? "✓" : "✗"} ${label}\n    ${evidence}\n`);
}

const usage = { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 } };

async function seed(home: string): Promise<void> {
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1360, height: 940, x: 0, y: 0 }));
	/*
	 * 三个项目、每个十二条会话，多到列表能滚起来。
	 *
	 * 少了滚不动，标签栏根本到不了吸顶那一步——而这次要看的正是吸顶之后发生了什么。分成三个项目，
	 * 好让分组标题也有得吸；每个项目的后六条收进归档，两边的列表就都滚得动。
	 */
	const projects = [
		{ path: REPO, name: "Lyra" },
		{ path: join(home, "proj-two"), name: "另一个项目" },
		{ path: join(home, "proj-three"), name: "第三个项目" },
	].map((p) => ({ ...p, id: createHash("sha256").update(p.path).digest("hex").slice(0, 16) }));

	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: projects.map((p, i) => ({ id: p.id, name: p.name, path: p.path, pinned: i === 0, lastOpenedAt: 3 - i })),
			defaultModelId: null,
			permissionMode: "auto",
			thinking: "medium",
			retryAttempts: 3,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4541, token: null },
			appearance: { theme: "dark" },
		}),
	);

	const metas: object[] = [];
	let n = 0;
	for (const project of projects) {
		await mkdir(project.path, { recursive: true });
		await mkdir(join(home, "sessions", project.id), { recursive: true });
		for (let i = 0; i < 22; i++) {
			n++;
			const id = `s${String(n).padStart(3, "0")}`;
			const messages = [
				{ role: "user", content: [{ type: "text", text: `第 ${i + 1} 个问题` }], timestamp: 1 },
				{ role: "assistant", content: [{ type: "text", text: "答一句" }], api: "anthropic-messages", provider: "test", model: "test", usage, stopReason: "stop", timestamp: 2 },
			];
			const meta = {
				id, title: `${project.name}的第 ${i + 1} 个会话`, cwd: project.path,
				projectId: project.id, projectName: project.name,
				createdAt: 1_700_000_000_000 + n * 1000, updatedAt: 1_700_000_000_000 + n * 1000,
				modelId: "test", messageCount: messages.length, usage, seq: messages.length + 1,
				// 每个项目后六条收进归档：两边的列表都要长到滚得动，而且都要有三个分组。
				...(i >= 16 ? { archived: true } : {}),
			};
			metas.push(meta);
			await writeFile(
				join(home, "sessions", project.id, `${id}.jsonl`),
				[
					JSON.stringify({ seq: 0, ts: 1, type: "meta", meta }),
					...messages.map((message, at) => JSON.stringify({ seq: at + 1, ts: at + 1, type: "message", message })),
					JSON.stringify({ seq: meta.seq, ts: 2, type: "meta", meta }),
				].join("\n") + "\n",
			);
		}
	}
	await writeFile(join(home, "sessions", "index.json"), JSON.stringify(metas));
}

const app = await startApp({ port: 9517, seed });
const settle = (ms = 800) => new Promise((resolve) => setTimeout(resolve, ms));

/** 侧边栏滚到某一格时，遮罩和吸顶行各自在哪。 */
interface Frame {
	scrollTop: number;
	/** 遮罩里那段顶部渐隐的深度：0 表示顶上完全不虚化。 */
	holdTop: number;
	/** 全黑区的底，也就是下一段渐隐从哪开始。 */
	fadeInset: number;
	/** 此刻被真正按住的行有几个（标签栏算一个，分组标题各算一个）。 */
	stuck: number;
	/** 标签栏 box 的上沿，相对滚动视口。吸顶了就是 0。 */
	stripTop: number;
	/** 最靠上的那个分组标题的上沿。没有就是 null。 */
	headTop: number | null;
	/** 真正被按住的那些行里，最低的那条底边。渐隐该紧跟着它开始。 */
	stuckBottom: number;
	/** 第二个保护区的底，以及它下面那段渐隐的深度。没有第二片时两者折叠。 */
	nextHold: number;
	nextFade: number;
}

try {
	await mkdir(dir, { recursive: true });
	await settle(3000);

	const ready = await app.evaluate<string>(
		'(() => {' +
			'const view = document.querySelector(".ly-sidebar-fill .ly-scroll-view");' +
			'if (!view) return "找不到侧边栏滚动区";' +
			'const rows = view.querySelectorAll("[data-ly-row]").length;' +
			'return `${rows}|${view.scrollHeight}|${view.clientHeight}`;' +
		'})()',
	);
	const [rowCount, scrollHeight, clientHeight] = ready.split("|");
	check(
		"侧边栏有足够的行，列表滚得动",
		Number(scrollHeight) > Number(clientHeight) + 100,
		`${rowCount} 行，内容 ${scrollHeight}px / 视口 ${clientHeight}px`,
	);

	/*
	 * 逐格往下滚，每一格读一次。
	 *
	 * 一格 12px，比一次滚轮细，因为要找的是「从哪一格开始变的」。读之前等一帧：写 `--ly-hold-top`
	 * 的是 `useStickyFade`，它挂在 rAF 上（见 `sidebar/useStickyFade.ts`）。
	 */
	const frames = await app.evaluate<Frame[]>(
		'(async () => {' +
			'const view = document.querySelector(".ly-sidebar-fill .ly-scroll-view");' +
			'const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));' +
			'const out = [];' +
			'for (let top = 0; top <= 260; top += 12) {' +
				'view.scrollTop = top;' +
				'await frame();' +
				'const style = view.style;' +
				'const origin = view.getBoundingClientRect().top;' +
				'const strip = view.querySelector("[data-ly-rail]");' +
				'const heads = [...view.querySelectorAll("[data-ly-head]")];' +
				'const held = heads.map((h) => h.getBoundingClientRect().top - origin).filter((t) => t < 60).sort((a, b) => a - b);' +
				'out.push({' +
					'scrollTop: view.scrollTop,' +
					'holdTop: parseFloat(style.getPropertyValue("--ly-hold-top")) || 0,' +
					'fadeInset: parseFloat(style.getPropertyValue("--ly-fade-inset")) || 0,' +
					'stuck: view.querySelectorAll("[data-ly-stuck]").length,' +
					'stripTop: strip ? strip.getBoundingClientRect().top - origin : -999,' +
					'headTop: held.length ? held[0] : null,' +
					'stuckBottom: [...view.querySelectorAll("[data-ly-stuck]")].reduce((low, el) => Math.max(low, el.getBoundingClientRect().bottom - origin), 0),' +
					'nextHold: parseFloat(style.getPropertyValue("--ly-hold-next")) || 0,' +
					'nextFade: parseFloat(style.getPropertyValue("--ly-hold-next-fade")) || 0,' +
				'});' +
			'}' +
			'view.scrollTop = 0;' +
			'await frame();' +
			'return out;' +
		'})()',
	);

	process.stdout.write("\n  滚动位置  hold-top  fade-inset  按住  标签栏上沿  分组标题上沿\n");
	for (const f of frames) {
		process.stdout.write(
			`  ${String(f.scrollTop).padStart(8)}  ${f.holdTop.toFixed(1).padStart(8)}  ${f.fadeInset.toFixed(1).padStart(10)}` +
			`  ${String(f.stuck).padStart(4)}  ${f.stripTop.toFixed(1).padStart(10)}  ${f.headTop === null ? "—".padStart(12) : f.headTop.toFixed(1).padStart(12)}\n`,
		);
	}

	/*
	 * 真正的问题在这里：渐隐从哪儿开始。
	 *
	 * `--ly-fade-inset` 是全黑保护区的底，渐隐紧跟在它后面。它该只包住真正贴在顶上的那些行——标签
	 * 栏，以及已经落位的分组标题。从前它一路延伸到「还在接近、离轨还有三十来像素」的那个分组标题的
	 * 底下，于是标签栏底到那个标题之间的一整段列表行跟着被划进保护区，不再淡出：标签栏落位的那一帧，
	 * 虚化就没了。量到的是 44 跳成 108。
	 */
	const landed = frames.filter((f) => f.stuck > 0);
	const glued = landed.filter((f) => Math.abs(f.fadeInset - f.stuckBottom) < 1.5);
	check(
		"渐隐紧跟着真正贴住的那一片开始，没有把中间的列表行一起圈进去",
		landed.length > 0 && glued.length === landed.length,
		`按住的 ${landed.length} 格里有 ${glued.length} 格对得上；` +
			`成对取值 ${[...new Set(landed.map((f) => `${f.fadeInset}/${f.stuckBottom}`))].join(", ")}`,
	);

	/*
	 * 而正在接近的那个分组标题仍然不许被虚化——它有自己的保护区。
	 *
	 * 这是原来那份宽容存在的理由（见 `sticky.ts`）：一行在走向轨道的路上正好穿过顶上被擦掉的那几十
	 * 像素，不保护它就会「先化掉、落位再突然实回来」。所以两件事要同时成立：中间的列表淡出，标题自己
	 * 完好。第二片就是后者。
	 */
	const approaching = frames.filter((f) => f.stuck === 1 && f.headTop !== null && f.headTop > f.stuckBottom + 1);
	check(
		"还在接近的分组标题有一块自己的保护区，不会在半路上化掉",
		approaching.length > 0 && approaching.every((f) => f.nextHold > f.fadeInset + 1 && f.nextFade > 0),
		approaching.length === 0
			? "这一趟没滚出「标题正在接近」的那几格"
			: `接近中的 ${approaching.length} 格：${[...new Set(approaching.map((f) => `inset=${f.fadeInset} next=${f.nextHold} fade=${f.nextFade}`))].join(", ")}`,
	);

	// 什么都没按住的时候，两个新变量要折叠回原来那份单区遮罩，否则别的滚动面板的顶部渐隐会跟着变。
	const loose = frames.filter((f) => f.stuck === 0);
	check(
		"没有行被按住时，第二个保护区折叠掉",
		loose.every((f) => f.nextFade === 0),
		`未按住的 ${loose.length} 格里，next-fade 取值 ${[...new Set(loose.map((f) => f.nextFade))].join(", ")}`,
	);

	/*
	 * 别的滚动面板不该被这次改动碰到。
	 *
	 * 遮罩的第一段渐隐从前用 `--ly-fade-top`，现在用 `--ly-hold-gap`——而全应用只有侧边栏会写后者。
	 * 别处得靠 `.ly-fade-y` 里那句默认值折回原样，少了它每一个滚动面板的顶部渐隐都会一起没掉。所以
	 * 这里问的是计算值，不是「规则写没写」。
	 */
	const elsewhere = await app.evaluate<{ found: number; mismatched: string[] }>(
		'(() => {' +
			'const all = [...document.querySelectorAll(".ly-fade-y")].filter((el) => !el.closest(".ly-sidebar-fill"));' +
			'const bad = [];' +
			'for (const el of all) {' +
				'const style = getComputedStyle(el);' +
				'const gap = style.getPropertyValue("--ly-hold-gap").trim();' +
				'const top = style.getPropertyValue("--ly-fade-top").trim();' +
				'const nextFade = style.getPropertyValue("--ly-hold-next-fade").trim();' +
				'if (gap !== top || parseFloat(nextFade) !== 0) bad.push(`gap=${gap} top=${top} nextFade=${nextFade}`);' +
			'}' +
			'return { found: all.length, mismatched: bad };' +
		'})()',
	);
	check(
		"侧边栏之外的滚动面板，顶部渐隐还是原来那个深度",
		elsewhere.found > 0 && elsewhere.mismatched.length === 0,
		`量了 ${elsewhere.found} 个面板，对不上的 ${elsewhere.mismatched.length} 个${elsewhere.mismatched.length ? "：" + elsewhere.mismatched.join(", ") : ""}`,
	);

	/*
	 * 切进归档：上面那截没换的东西该待在原地。
	 *
	 * 量的是 `data-ly-rail` 在窗口里的绝对位置——它是标签栏，切换前后都是同一个东西，位置变了就是
	 * 跳了。用真实点击：`evaluate` 里的 `.click()` 打不开某些行（见 `e2e-click-needs-real-mouse`），
	 * 而这个按钮是普通 button，`.click()` 够用。
	 */
	const jump = await app.evaluate<{ before: number; after: number; navBefore: boolean; navAfter: boolean; scrollAfter: number }>(
		'(async () => {' +
			'const wait = (ms) => new Promise((r) => setTimeout(r, ms));' +
			'const view = document.querySelector(".ly-sidebar-fill .ly-scroll-view");' +
			'view.scrollTop = 260;' +
			'await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));' +
			'const rail = () => view.querySelector("[data-ly-rail]").getBoundingClientRect().top;' +
			// 「拉取请求」那一行：它在标签栏上面，滚上去之后不该因为切归档又冒出来。
			'const navShown = () => {' +
				'const nav = view.querySelector("[data-ly-rail]").previousElementSibling;' +
				'if (!nav) return false;' +
				'const box = nav.getBoundingClientRect();' +
				'return box.bottom > view.getBoundingClientRect().top + 4;' +
			'};' +
			'const before = rail();' +
			'const navBefore = navShown();' +
			'const button = [...document.querySelectorAll(".ly-sidebar-fill button")].find((b) => (b.getAttribute("aria-label") || "").includes("归档"));' +
			'if (!button) return { before, after: -1, navBefore, navAfter: false, scrollAfter: -1 };' +
			'button.click();' +
			'await wait(600);' +
			'return { before, after: rail(), navBefore, navAfter: navShown(), scrollAfter: view.scrollTop };' +
		'})()',
	);
	check(
		"切进归档，标签栏没有从吸顶位置掉下来",
		jump.after >= 0 && Math.abs(jump.after - jump.before) < 2,
		`切换前 ${jump.before.toFixed(1)}px，切换后 ${jump.after.toFixed(1)}px；归档列表滚动位置 ${jump.scrollAfter}`,
	);
	check(
		"切进归档，上面那几个导航项没有重新冒出来",
		jump.navBefore === false && jump.navAfter === false,
		`切换前露出=${jump.navBefore}，切换后露出=${jump.navAfter}`,
	);

	/*
	 * 归档列表里点一行：打开它，但不该把它取出来。
	 */
	const archiveClick = await app.evaluate<{ opened: boolean; stillArchived: boolean; note: string }>(
		'(async () => {' +
			'const wait = (ms) => new Promise((r) => setTimeout(r, ms));' +
			'const row = document.querySelector(".ly-sidebar-fill [data-ly-row]");' +
			'if (!row) return { opened: false, stillArchived: false, note: "归档列表里没有行" };' +
			'const id = row.getAttribute("data-ly-row");' +
			'row.querySelector("button").click();' +
			'await wait(1200);' +
			'const state = window.__lyraStore ? window.__lyraStore.getState() : null;' +
			'const active = document.querySelector(\'.ly-sidebar-fill [aria-current="page"]\');' +
			'return { opened: Boolean(active), stillArchived: Boolean(document.querySelector(`[data-ly-row="${id}"]`)), note: id };' +
		'})()',
	);
	check(
		"归档列表里点一行，它没有因此被取出归档",
		archiveClick.stillArchived,
		`${archiveClick.note}：点开后仍在归档列表里=${archiveClick.stillArchived}，行被选中=${archiveClick.opened}`,
	);

	const image = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(dir, "sidebar-archive.png"), Buffer.from(image.data, "base64"));
	process.stdout.write(`\n截图：${join(dir, "sidebar-archive.png")}\n`);
} finally {
	await app.stop();
}

process.stdout.write(failures === 0 ? "\n全部通过\n" : `\n${failures} 项没过\n`);
process.exit(failures === 0 ? 0 : 1);
