/* oxlint-disable no-console -- a measuring stick that prints what it measured */
/**
 * 展开/收起那一下，到底画出了什么。
 *
 * 用户录的视频里，收起时卡片先没了、高度慢半拍才收回来，中间空出一大块再突然归位；在一轮
 * 两百多个工具调用的会话里尤其明显。这种「抖」只能按**绘制帧**量：采样会漏掉中间态，
 * `MutationObserver` 又会报一堆根本没画出来的瞬时值。所以这里逐 `rAF` 记高度。
 *
 * 量四件事，因为它们是四种不同的病：
 *   1. 高度序列是否单调——收起过程中回弹一次，就是肉眼看到的那一抖。
 *   2. 帧间隔——超过 32ms 的都是掉帧，掉帧的数量就是「卡」的量纲。
 *   3. 一次点击引发多少次布局测量——`useLayoutEffect` 里同步读 `scrollHeight` 会强制重排，
 *      而页面上挂着几十上百个这样的组件。
 *   4. 页面上活着多少个 ResizeObserver 目标——规模是这件事从「慢一点」变成「卡死」的原因。
 *
 * 不是测试——`node e2e/disclosure-jitter-probe.ts`——跑的是 `out/` 里的产物，所以改完代码
 * 要先 `pnpm build`。加 `--tag=after` 把结果存成另一份，好和基线对照。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { projectIdFor } from "@lyra/core";
import { startApp } from "./app.ts";
import { frameGrabber } from "./record.ts";

const PORT = 9644;
/** 今天那场会话：904 条消息、452 个工具结果——正是视频里那种规模。 */
const SOURCE = join(homedir(), ".lyra/sessions/63ca3825cb82944e/aa5eb131-4b20-4e20-8036-6b39cfd77507.jsonl");
const SESSION_ID = "aa5eb131-4b20-4e20-8036-6b39cfd77507";
const TITLE = "添加文件后布局异常排查";
const TAG = process.argv.find((a) => a.startsWith("--tag="))?.slice(6) ?? "before";
const OUT = join(homedir(), ".lyra/scratch/jitter");

const app = await startApp({
	port: PORT,
	seed: async (home) => {
		const root = join(home, "project");
		await mkdir(root, { recursive: true });
		await writeFile(join(home, "window.json"), JSON.stringify({ x: 0, y: 0, width: 1440, height: 900 }));
		const projectId = projectIdFor(root);
		await mkdir(join(home, "sessions", projectId), { recursive: true });
		const lines = (await readFile(SOURCE, "utf8")).split("\n").filter(Boolean);
		const rewritten = lines.map((line) => {
			const record = JSON.parse(line);
			if (record.type === "meta" && record.meta) {
				record.meta.cwd = root;
				record.meta.projectId = projectId;
			}
			return JSON.stringify(record);
		});
		await writeFile(join(home, "sessions", projectId, `${SESSION_ID}.jsonl`), `${rewritten.join("\n")}\n`);
		await writeFile(
			join(home, "settings.json"),
			JSON.stringify({
				version: 1,
				providers: [],
				mcpServers: [],
				projects: [{ path: root, name: "project", pinned: false, lastOpenedAt: Date.now() }],
				defaultModelId: null,
				permissionMode: "auto",
				thinking: "medium",
				retryAttempts: 3,
				hooks: [],
				scheduledTasks: [],
				disabledPlugins: [],
				pluginRegistries: [],
				skillRegistries: [],
				alwaysAllow: [],
				sync: { enabled: false, port: 4519, token: null },
			}),
		);
	},
});

const wire = await frameGrabber(PORT);
const settle = (ms: number) => new Promise((done) => setTimeout(done, ms));

try {
	await mkdir(OUT, { recursive: true });
	await settle(2500);

	// 点开那个会话。
	const row = await wire.evaluate<{ x: number; y: number } | null>(
		`(() => {
			const title = ${JSON.stringify(TITLE)};
			const all = [...document.querySelectorAll('*')].filter((e) => (e.textContent || '').trim() === title);
			const el = all[all.length - 1];
			if (!el) return null;
			const hit = el.closest('button, [role="button"], a, li') || el;
			const r = hit.getBoundingClientRect();
			if (r.width === 0) return null;
			return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
		})()`,
	);
	if (!row) throw new Error("没找到会话行——没有会话就没有可展开的东西，后面的数字会全是假的");
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
		await wire.send("Input.dispatchMouseEvent", { type, x: row.x, y: row.y, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) });
	}
	await settle(3000);

	const countScale = () =>
		wire.evaluate<{ freeze: number; turns: number; runs: number }>(
			`({
				freeze: document.querySelectorAll('.ly-freeze').length,
				turns: document.querySelectorAll('[data-ly-turn-process]').length,
				runs: document.querySelectorAll('[data-ly-run]').length,
			})`,
		);

	/*
	 * 装一个计数器，数这一次点击引发了多少次强制重排。
	 *
	 * `scrollHeight` 的 getter 被包起来——每读一次，浏览器就得把待处理的样式和布局全算完。
	 * 这正是 `useLayoutEffect` 里那句 `measure()` 做的事，而它每次渲染都跑一遍。
	 */
	await wire.evaluate<boolean>(
		`(() => {
			if (window.__reflow) return true;
			window.__reflow = { reads: 0 };
			const proto = Element.prototype;
			const original = Object.getOwnPropertyDescriptor(proto, 'scrollHeight');
			Object.defineProperty(proto, 'scrollHeight', {
				configurable: true,
				get() { window.__reflow.reads++; return original.get.call(this); },
			});
			return true;
		})()`,
	);

	/*
	 * 锁定一个工具组，展开和收起都点它——不是每次重新找。
	 *
	 * 第一版每次按「视口里第一个」重找，展开之后布局全变了，于是收起量的是另一个元素，
	 * 得出「0 → 477」这种自相矛盾的数字。要对照的是同一个东西的两次状态。
	 */
	const lockOn = async () =>
		wire.evaluate<boolean>(
			`(() => {
				/*
				 * 躺在 inert 容器里的按钮点不动。
				 *
				 * 收起的过程行用 \`inert\` 把整块内容排除在交互之外，而里面的工具组照样有尺寸、
				 * 有 rect——于是探针「点」了它，什么也没发生，然后report「一点不抖」。
				 * 真实鼠标点不中的东西，量出来的一定是假数据。
				 */
				/*
				 * 工具组的头是 \`[data-ly-run]\` 的**直接**子元素。
				 *
				 * 不加 \`>\` 会先撞上组里那些单卡片（「Read …」），它们同样带 aria-expanded，
				 * 但身边没有 \`.ly-freeze\`——于是 box 是 null，逐帧回调第一帧就抛错，
				 * 样本空着回来，看上去像「什么都没发生」。
				 */
				const head = [...document.querySelectorAll('[data-ly-run] > button[aria-expanded]')]
					.find((b) => {
						const r = b.getBoundingClientRect();
						if (r.y < 120 || r.y > innerHeight - 300 || r.width === 0) return false;
						if (b.closest('[inert]')) return false;
						if (!b.parentElement.querySelector(':scope > .ly-freeze')) return false;
						// 真的是最上面那个元素吗——被浮层盖住也一样点不到。
						const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
						return Boolean(top && b.contains(top));
					});
				if (!head) return false;
				window.__head = head;
				window.__box = head.parentElement.querySelector(':scope > .ly-freeze');
				/*
				 * 「下面那块内容」——空白就长在这里。
				 *
				 * 折叠容器自己的高度可以收得很规矩，而后面的兄弟节点慢半拍才上来，中间空出的那一块
				 * 正是视频里看到的。只量容器高度是看不见它的。
				 */
				let next = head.parentElement.nextElementSibling;
				while (next && next.getBoundingClientRect().height === 0) next = next.nextElementSibling;
				window.__below = next;
				return true;
			})()`,
		);

	/** 点一次锁定的那个头，逐帧记它和它下方内容的位置。 */
	const measure = async (what: "expand" | "collapse") => {
		const spot = await wire.evaluate<{ x: number; y: number } | null>(
			`(() => {
				const r = window.__head.getBoundingClientRect();
				return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
			})()`,
		);
		if (!spot) throw new Error("视口里没有可点的工具组");

		// 开始逐帧记录，然后点。
		await wire.evaluate<boolean>(
			`(() => {
				window.__reflow.reads = 0;
				window.__s = [];
				const box = window.__box, below = window.__below;
				const t0 = performance.now();
				const tick = () => {
					window.__s.push([
						Math.round(performance.now() - t0),
						box.offsetHeight,
						below ? Math.round(below.getBoundingClientRect().top) : 0,
					]);
					if (performance.now() - t0 < 1600) requestAnimationFrame(tick);
				};
				requestAnimationFrame(tick);
				return true;
			})()`,
		);
		for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
			await wire.send("Input.dispatchMouseEvent", { type, x: spot.x, y: spot.y, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) });
		}
		await settle(2000);

		const data = await wire.evaluate<{ samples: [number, number, number][]; reads: number; expanded: string | null }>(
			`({ samples: window.__s, reads: window.__reflow.reads, expanded: window.__head.getAttribute('aria-expanded') })`,
		);
		// 点了没有？`aria-expanded` 是这个组件对外唯一的说法，它没翻面就是没点着。
		console.log(`  （${what}：点击后 aria-expanded=${data.expanded}）`);

		const s = data.samples;
		// 空样本不是「没有抖动」，是这一轮什么也没量到——当成 0 用会把结论完全说反。
		if (!s || s.length < 5) throw new Error(`${what}：只收到 ${s?.length ?? 0} 个采样，逐帧记录没跑起来`);
		const gaps = s.slice(1).map((p, i) => p[0] - s[i][0]);
		const dropped = gaps.filter((g) => g > 32).length;
		const worstGap = Math.max(...gaps, 0);
		const heights = s.map((p) => p[1]);
		const from = heights[0];
		const to = heights[heights.length - 1];

		/*
		 * 下方内容的位移：空白就是在这里出现的。
		 *
		 * 容器收得平滑，而后面的东西原地不动几帧再猛地跳上来——那几帧里屏幕上就是一块空的。
		 * 量的是「最大的一次跳」和「一动不动的帧数」。
		 */
		const below = s.map((p) => p[2]);
		const belowSteps = below.slice(1).map((v, i) => v - below[i]);
		const belowJump = Math.max(...belowSteps.map(Math.abs), 0);
		const belowMoved = belowSteps.filter((v) => v !== 0).length;
		const belowDir = Math.sign(below[below.length - 1] - below[0]);
		const belowReversals = belowSteps.filter((v) => v !== 0 && Math.sign(v) !== belowDir).length;

		/*
		 * 回弹：高度朝着和整体相反的方向走了一步。
		 *
		 * 收起时应当一路变小。中间涨回去哪怕一帧，就是视频里那一下——不是「慢」，是「抖」。
		 */
		const dir = Math.sign(to - from);
		let reversals = 0;
		let worstReversal = 0;
		for (let i = 1; i < heights.length; i++) {
			const step = heights[i] - heights[i - 1];
			if (step !== 0 && Math.sign(step) !== dir) {
				reversals++;
				worstReversal = Math.max(worstReversal, Math.abs(step));
			}
		}
		// 动画停在哪一帧：连续 5 帧不变就算稳了。
		let settledAt = s[s.length - 1][0];
		for (let i = heights.length - 6; i >= 0; i--) {
			if (heights[i] !== heights[heights.length - 1]) { settledAt = s[i + 1][0]; break; }
		}

		return {
			what, from, to, frames: s.length, dropped, worstGap, reversals, worstReversal, settledAt,
			reads: data.reads, belowJump, belowMoved, belowReversals, samples: s,
		};
	};

	/*
	 * 先把转录撑到视频里那个体量。
	 *
	 * 默认只挂最近 60 条，页面上拢共三十来个折叠容器——而被抱怨的是「一轮两百多个工具调用」
	 * 全摊开的样子。在小转录上量出来的流畅，说明不了大转录上的卡。
	 */
	for (let i = 0; i < 6; i++) {
		const more = await wire.evaluate<boolean>(
			`(() => {
				const b = [...document.querySelectorAll('button')].find((x) => /显示更早|Show \\d+ earlier/.test(x.textContent || ''));
				if (!b) return false;
				b.click();
				return true;
			})()`,
		);
		if (!more) break;
		await settle(500);
	}

	/*
	 * 再把过程行摊开，工具组才点得到。
	 *
	 * 「调用工具 226 个」那一行收起时，底下整块是 inert 的；视频里被点来点去的工具组正躺在
	 * 里面。不先打开它，下面就没有可测的对象。
	 */
	const opened = await wire.evaluate<number>(
		`(() => {
			let n = 0;
			for (const head of document.querySelectorAll('[data-ly-turn-process] button[aria-expanded="false"]')) { head.click(); n++; }
			return n;
		})()`,
	);
	await settle(1200);
	/*
	 * 规模要在摊开之后数。
	 *
	 * 收起时页面上只有那么几个折叠容器，而视频里抱怨的正是「一轮两百多个工具调用」全摊开的样子。
	 * 在收起状态下量规模，等于避开了要复现的场景。
	 */
	const scale = await countScale();
	console.log(`摊开过程行 ${opened} 个 → 规模：折叠容器 ${scale.freeze} 个（过程行 ${scale.turns}，工具组 ${scale.runs}）`);

	if (!(await lockOn())) throw new Error("视口里没有可点的工具组——没有可展开的东西，后面的数字全是假的");
	/*
	 * 先把锁到的东西说出来。
	 *
	 * 上一版全程量到 0，看着像「一点不抖」，实际是根本没点着。一个自称测量的东西，必须先证明
	 * 它测的对象真的在那儿、真的会动。
	 */
	const locked = await wire.evaluate<{ text: string; expanded: string | null; boxH: number; rect: [number, number, number, number]; hasBelow: boolean }>(
		`(() => {
			const h = window.__head, r = h.getBoundingClientRect();
			return {
				text: (h.textContent || '').trim().slice(0, 40),
				expanded: h.getAttribute('aria-expanded'),
				boxH: window.__box ? window.__box.offsetHeight : -1,
				rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
				hasBelow: Boolean(window.__below),
			};
		})()`,
	);
	console.log(`锁定：「${locked.text}」 aria-expanded=${locked.expanded} 折叠容器高=${locked.boxH} rect=${locked.rect.join(",")} 下方内容=${locked.hasBelow ? "有" : "无"}`);
	const expand = await measure("expand");
	await settle(600);
	const collapse = await measure("collapse");

	const report = { tag: TAG, scale, expand: { ...expand, samples: undefined }, collapse: { ...collapse, samples: undefined } };
	for (const r of [expand, collapse]) {
		console.log(`\n=== ${r.what === "expand" ? "展开" : "收起"} ===`);
		console.log(`  高度 ${r.from} → ${r.to}，${r.frames} 帧，稳定于 ${r.settledAt}ms`);
		console.log(`  掉帧（>32ms）${r.dropped} 次，最长一帧 ${r.worstGap}ms`);
		console.log(`  回弹 ${r.reversals} 次，最大一次 ${r.worstReversal}px  ${r.reversals > 0 ? "← 这就是抖" : "✅"}`);
		console.log(`  下方内容：动了 ${r.belowMoved}/${r.frames} 帧，最大一跳 ${r.belowJump}px，回弹 ${r.belowReversals} 次 ${r.belowJump > 40 ? "← 空白就是这么来的" : ""}`);
		console.log(`  这一次点击引发 scrollHeight 强制重排 ${r.reads} 次`);
	}

	await writeFile(join(OUT, `${TAG}.json`), JSON.stringify({ ...report, expandSamples: expand.samples, collapseSamples: collapse.samples }, null, 1));
	console.log(`\n明细 → ${join(OUT, `${TAG}.json`)}`);
} finally {
	wire.close();
	await app.stop();
}
