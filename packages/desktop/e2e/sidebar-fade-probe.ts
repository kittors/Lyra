/**
 * 侧边栏顶部那道渐隐，在列表滚动的每一步上。
 *
 * `node --experimental-strip-types e2e/sidebar-fade-probe.ts [dir]`
 *
 * 报上来的现象：往下滚，顶上一层虚化都没有——滚过去的会话行不淡出，清清楚楚一条压在标签栏边上。
 *
 * 量的是**画出来的结果**，不是写给遮罩的那些数。这一条是这支探针第一版栽过的跟头：它把几个自定义
 * 属性量了个遍，每一个看着都对，于是一路全绿，而侧边栏顶上一点虚化都没有。那些属性是输入，它们
 * 各自对、合起来仍然可以把整段渐变压进同一个位置——从实到透明用了 0px。所以真正要问的是
 * `MASK_PROBE` 里那个数：算完的遮罩沿 y 轴逐像素插值，半透明的那条带子到底有多厚。
 *
 * 逐格滚动、每格读一次，且每格都等过渡停稳。「什么时候变的」只有这样才看得见，而停稳之后的形状
 * 才是各个吸顶状态该长的样子——渐入的那 220ms 另有一条单独量。三份列表（项目、聊天、归档）各走
 * 一趟：吸顶的行数不一样，而顶上有没有虚化跟列表里装的是什么无关。
 *
 * 同一趟里还量另外两件：切进归档时上面那截框架有没有跟着跳（`data-ly-rail` 的位置），以及归档里
 * 点一行会不会把它取出归档。
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";
import { MASK_PROBE } from "./mask.ts";

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
	/** 保护区从哪开始。0 是常态（贴着顶边），只有某一行正在进来时才不是。 */
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
	/** 保护区下面那段渐隐允许的深度。这一个才是「顶上虚不虚」的开关。 */
	holdGap: number;
	/**
	 * 顶上真正半透明的那条带子有多厚，单位 px。
	 *
	 * 前面那些全是**输入**——写给遮罩的自定义属性。它们各自都对，合起来仍然可以什么都不虚化：
	 * 一个 0 的 `--ly-hold-gap` 会把那一整段渐变的每一个 stop 压到同一个位置上，遮罩照样成立，
	 * 只是从实变透明只用了 0px。所以这里问的是**输出**：把浏览器算完的 `mask-image` 取回来，
	 * 沿着 y 轴逐像素插值，数有多少像素落在「既不全实也不全透」之间。硬切是 0，正常是三十几。
	 *
	 * 之前那一版探针量全了输入、漏了这一个数，于是它一路全绿，而侧边栏顶上一点虚化都没有。
	 */
	softSpan: number;
	/** 同样的问法，问底下那一头——「上下滚动都得有虚化」的下半句。 */
	bottomSpan: number;
	/** 还能不能往下滚。滚到底了底部本来就不该有虚化，那一格不算数。 */
	more: boolean;
	/**
	 * `Scroller` 此刻要的深度，也是判断厚度够不够的那把尺子本身。
	 *
	 * 不写死 36：`scrollFade` 在矮面板上给的是高度的五分之一，一个窗口拉得很扁的侧边栏本来就该
	 * 化得浅一些。真正要问的从来不是「有没有 33px」，而是「要多少给了多少」——顶上那份软化是不是
	 * 全额铺出去了，不管它被几段保护区切开。
	 */
	fadeTop: number;
	fadeBottom: number;
}

/**
 * 一条渐变从透明铺到实，两头各有一小截落在判定阈值之外。
 *
 * 量的是 alpha 落在 (0.02, 0.98) 的那一段，而曲线两端是慢慢贴上去的，所以实测厚度总比要的深度
 * 略小——满深 36px 稳定量到 33px。0.8 是给这段损耗留的余量，比 33/36 还宽一点。
 */
const SPAN_OF_DEPTH = 0.8;


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
	const sweep = (): Promise<Frame[]> =>
		app.evaluate<Frame[]>(
			'(async () => {' +
				MASK_PROBE +
				'const view = document.querySelector(".ly-sidebar-fill .ly-scroll-view");' +
				'const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));' +
				/*
				 * 读之前等到不动为止。
				 *
				 * 每格只等一帧量到的是「虚化正在长出来」的中途——`--ly-fade-top` 有 220ms 的过渡，
				 * 列表刚离开顶部的那几格全落在里面，量出来 0、18.5、27.5、31 一路往上。那是对的行为，
				 * 不是要找的东西：这一趟问的是各个吸顶状态下**停稳之后**的形状。渐入本身另有一条量。
				 */
				'const settled = async () => {' +
					'let last = NaN;' +
					'for (let i = 0; i < 40; i++) {' +
						'await frame();' +
						'const now = parseFloat(getComputedStyle(view).getPropertyValue("--ly-fade-top")) || 0;' +
						'if (now === last) return;' +
						'last = now;' +
					'}' +
				'};' +
				'const out = [];' +
				'for (let top = 0; top <= 260; top += 12) {' +
					'view.scrollTop = top;' +
					'await settled();' +
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
						'nextHold: parseFloat(getComputedStyle(view).getPropertyValue("--ly-hold-next")) || 0,' +
						'nextFade: parseFloat(getComputedStyle(view).getPropertyValue("--ly-hold-next-fade")) || 0,' +
						'holdGap: parseFloat(getComputedStyle(view).getPropertyValue("--ly-hold-gap")) || 0,' +
						'softSpan: softSpan(view),' +
						'bottomSpan: bottomSpan(view),' +
						'more: view.scrollTop < view.scrollHeight - view.clientHeight - 1,' +
						'fadeTop: parseFloat(getComputedStyle(view).getPropertyValue("--ly-fade-top")) || 0,' +
						'fadeBottom: parseFloat(getComputedStyle(view).getPropertyValue("--ly-fade-bottom")) || 0,' +
					'});' +
				'}' +
				'view.scrollTop = 0;' +
				'await frame();' +
				'return out;' +
			'})()',
		);

	/**
	 * 一趟扫描该满足的三件事，对每个列表都问一遍。
	 *
	 * 抽出来是因为「所有场景」不是一句话——项目、聊天、归档是三份不同的列表，吸顶的行数不一样，
	 * 而顶上有没有虚化跟列表里装的是什么无关。三份都得走一遍同一套尺子。
	 */
	function judge(label: string, frames: Frame[]): void {
		process.stdout.write(`\n  【${label}】滚动位置  fade-inset  hold-gap  顶部虚化  底部虚化  按住  标签栏上沿\n`);
		for (const f of frames) {
			process.stdout.write(
				`  ${String(f.scrollTop).padStart(16)}  ${f.fadeInset.toFixed(1).padStart(10)}  ${f.holdGap.toFixed(1).padStart(8)}` +
				`  ${f.softSpan.toFixed(1).padStart(8)}  ${f.bottomSpan.toFixed(1).padStart(8)}  ${String(f.stuck).padStart(4)}` +
				`  ${f.stripTop.toFixed(1).padStart(10)}\n`,
			);
		}

		/*
		 * 用户报的就是这一条：往下滚，顶上没有虚化。
		 *
		 * 上面那些数是写给遮罩的输入，这一条问的是画出来的结果。只要列表已经滚离顶部，顶上就该有
		 * 一条实实在在的半透明带——`FADE_TOP` 是 36px，算上两头的判定阈值，二十几像素是底线。
		 */
		const scrolled = frames.filter((f) => f.scrollTop > 0);
		const hard = scrolled.filter((f) => f.softSpan < f.fadeTop * SPAN_OF_DEPTH);
		check(
			`${label}：只要滚离顶部，顶上就有一条实实在在的虚化带`,
			scrolled.length > 0 && hard.length === 0,
			hard.length === 0
				? `滚动中的 ${scrolled.length} 格，要 ${scrolled[0].fadeTop.toFixed(0)}px、实得 ` +
					`${Math.min(...scrolled.map((f) => f.softSpan)).toFixed(1)}–${Math.max(...scrolled.map((f) => f.softSpan)).toFixed(1)}px`
				: `${hard.length}/${scrolled.length} 格没铺满：` +
					hard.slice(0, 6).map((f) => `${f.scrollTop}px 处要 ${f.fadeTop}px 只有 ${f.softSpan.toFixed(1)}px(gap=${f.holdGap})`).join("，"),
		);

		// 「上下滚动」的下半句。底下没有吸顶的行，这一头本来就该一直是满深的。
		const below = frames.filter((f) => f.more);
		const flatBottom = below.filter((f) => f.bottomSpan < f.fadeBottom * SPAN_OF_DEPTH);
		check(
			`${label}：底下还有东西的时候，下沿也是化开的`,
			below.length > 0 && flatBottom.length === 0,
			flatBottom.length === 0
				? `还能往下滚的 ${below.length} 格，要 ${below[0].fadeBottom.toFixed(0)}px、实得 ` +
					`${Math.min(...below.map((f) => f.bottomSpan)).toFixed(1)}–${Math.max(...below.map((f) => f.bottomSpan)).toFixed(1)}px`
				: `${flatBottom.length} 格底下是硬的：${flatBottom.slice(0, 6).map((f) => `${f.scrollTop}px 处要 ${f.fadeBottom}px 只有 ${f.bottomSpan.toFixed(1)}px`).join("，")}`,
		);

		/*
		 * 而且它得**连着**变，不能一格有一格没有。
		 *
		 * 深度会随吸顶的行动，这是对的；跳变才是病——滚一格闪一下，比一直没有还难看。这一条量的是
		 * 相邻两格之间的差：12px 一格的滚动量，厚度的变化不该超过它。
		 */
		const jumps = scrolled
			.map((f, i) => ({ f, prev: scrolled[i - 1] }))
			.filter(({ f, prev }) => prev && Math.abs(f.softSpan - prev.softSpan) > 12);
		check(
			`${label}：虚化的厚度是连着变的，没有某一格突然闪掉`,
			jumps.length === 0,
			jumps.length === 0
				? `相邻格之间最大变化 ${Math.max(0, ...scrolled.slice(1).map((f, i) => Math.abs(f.softSpan - scrolled[i].softSpan))).toFixed(1)}px`
				: jumps.map(({ f, prev }) => `${prev.scrollTop}→${f.scrollTop}px：${prev.softSpan.toFixed(1)}→${f.softSpan.toFixed(1)}`).join("，"),
		);
	}

	const frames = await sweep();
	judge("项目", frames);

	/*
	 * 列表刚离开顶部的那一下：虚化是长出来的，不是闪出来的。
	 *
	 * 上面每一格都等停稳了才读，所以那一趟看不见这 220ms。而这 220ms 正是这次改动最容易弄坏的
	 * 地方——过渡挂在 `--ly-fade-top` 上，侧边栏的遮罩只通过 `.ly-fade-y` 里那几条派生式间接读到
	 * 它。从前那几个长度是 JavaScript 每帧算好写进去的，等于把过渡的某一帧钉死成常量，虚化「啪」
	 * 地出现。所以这里逐帧录一遍：厚度要一路往上，不能中间掉下去，也不能第一帧就到位。
	 */
	const growth = await app.evaluate<number[]>(
		'(async () => {' +
			MASK_PROBE +
			'const view = document.querySelector(".ly-sidebar-fill .ly-scroll-view");' +
			'const frame = () => new Promise((r) => requestAnimationFrame(r));' +
			'view.scrollTop = 0;' +
			'for (let i = 0; i < 30; i++) await frame();' +
			'view.scrollTop = 24;' +
			'const out = [];' +
			'for (let i = 0; i < 26; i++) { await frame(); out.push(softSpan(view)); }' +
			'view.scrollTop = 0;' +
			'await frame();' +
			'return out;' +
		'})()',
	);
	const backwards = growth.filter((v, i) => i > 0 && v < growth[i - 1] - 0.6);
	check(
		"虚化是一帧一帧长出来的，不是一下子出现的",
		growth.length > 0 && growth[0] < 12 && Math.max(...growth) > 24 && backwards.length === 0,
		`逐帧厚度 ${growth.map((v) => v.toFixed(0)).join("→")}` + (backwards.length ? `；有 ${backwards.length} 帧往回缩` : ""),
	);

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
	 * 另一半列表，同一把尺子。
	 *
	 * 「聊天」是平铺的一条长列表，吸顶的只有标签栏，没有分组标题——保护区永远只有一片。而「只有一片」
	 * 恰恰是出问题的那个分支：算出来的空隙是零，整段渐变被压进同一个位置。项目那一侧至少还有几帧
	 * 碰巧是两片，这一侧一帧都没有，所以它才是这次最该看的列表。
	 */
	await app.evaluate(
		'(() => { document.querySelector(\'.ly-sidebar-fill [data-ly-tab="chats"]\')?.click(); })()',
	);
	await settle(900);
	judge("聊天", await sweep());
	// 换回来：底下几条量的是「项目」那一侧切进归档时的表现，借走的状态要还回去。
	await app.evaluate(
		'(() => { document.querySelector(\'.ly-sidebar-fill [data-ly-tab="projects"]\')?.click(); })()',
	);
	await settle(900);

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

	// 第三份列表，同一把尺子。归档是另一套分组，吸顶的行数跟前两份都不一样。
	judge("归档", await sweep());

	/*
	 * 最后一个场景：窗口拉到很扁。
	 *
	 * `scrollFade` 在矮面板上给的不是 36px，是高度的五分之一——一条只有一百多像素的列表，顶上化
	 * 掉三十六个像素就吃掉了小半屏，所以它本来就该浅一些。这是这次改动唯一可能跟 `Scroller` 脱节
	 * 的地方：那几个长度从前是 JavaScript 拿常量 36 算好写进去的，扁窗口上比该有的深，而且没人
	 * 会发现——顶上有虚化，只是多了点。现在它们都是从 `var(--ly-fade-top)` 派生的，所以这一趟问
	 * 的是「要多少给了多少」，判据本身也跟着那个数走（见 `SPAN_OF_DEPTH`）。
	 */
	await app.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 330, deviceScaleFactor: 1, mobile: false });
	await settle(1200);
	judge("扁窗口", await sweep());
	await app.send("Emulation.clearDeviceMetricsOverride");
	await settle(1200);

	/*
	 * 同一件事，直接问：把要的深度改掉，铺出来的跟着变吗。
	 *
	 * 上面那趟扁窗口没能把 `scrollFade` 逼到 36px 以下——侧边栏的滚动区再扁也还有一百八十多像素。
	 * 而「跟不跟得上」才是这次改动的地基：那几个长度全部从 `var(--ly-fade-top)` 派生，为的就是它
	 * 动画的时候虚化跟着长、它变浅的时候虚化跟着浅。所以这里绕开窗口尺寸，直接把那个数按住几个
	 * 值，看铺出来的厚度是不是每次都跟着走。
	 *
	 * 这条要是断了，界面上未必看得出来——顶上照样有虚化，只是深浅不再是 `Scroller` 说了算。那正是
	 * 修好之前的样子。
	 */
	const follows = await app.evaluate<{ depth: number; gap: number; span: number }[]>(
		'(async () => {' +
			MASK_PROBE +
			'const view = document.querySelector(".ly-sidebar-fill .ly-scroll-view");' +
			'const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));' +
			'view.scrollTop = 160;' +
			'for (let i = 0; i < 24; i++) await frame();' +
			'const out = [];' +
			'for (const depth of [10, 18, 28, 36]) {' +
				'view.style.setProperty("--ly-fade-top", depth + "px");' +
				// 过渡 220ms，等够了再读——不然读到的是它正在走的某一帧。
				'for (let i = 0; i < 24; i++) await frame();' +
				'out.push({' +
					'depth,' +
					'gap: parseFloat(getComputedStyle(view).getPropertyValue("--ly-hold-gap")) || 0,' +
					'span: softSpan(view),' +
				'});' +
			'}' +
			'view.style.removeProperty("--ly-fade-top");' +
			'view.scrollTop = 0;' +
			'for (let i = 0; i < 24; i++) await frame();' +
			'return out;' +
		'})()',
	);
	const lagging = follows.filter((f) => Math.abs(f.gap - f.depth) > 0.5 || f.span < f.depth * SPAN_OF_DEPTH || f.span > f.depth + 4);
	check(
		"要多深就铺多深：改掉 Scroller 要的深度，虚化跟着变",
		follows.length > 0 && lagging.length === 0,
		follows.map((f) => `要 ${f.depth} → gap ${f.gap.toFixed(1)} 实得 ${f.span.toFixed(1)}`).join("；"),
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
