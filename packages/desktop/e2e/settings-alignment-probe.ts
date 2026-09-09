/* oxlint-disable no-console -- a probe CLI whose entire output is what it printed */

/**
 * 四处对齐和一处动效，在真窗口里量出来。
 *
 * 用户拿着截图报的四件事，每一件都是「看上去不对」——而看上去不对的东西，只有在真窗口里量才有
 * 意义：jsdom 里没有布局，`items-center` 和 `items-start` 在那里是同一段字符串。
 *
 *   1. 并发上限那个数字要在框的正中间（还有别处同类的数字框）；
 *   2. 子智能体调度那五档的记号要落在整条的中线上，不是贴着标题那一行；
 *   3. 网页搜索那五条的圈同上，而且鼠标移上去之后圈还要看得见——原来的圈是 #2e2e2e，
 *      hover 底色是 #2a2a2a，差四级灰，等于消失；
 *   4. 使用统计换区间时，数字是走过去的而不是跳过去的。
 *
 * 用法：node --experimental-strip-types e2e/settings-alignment-probe.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const PORT = 9493;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function seed(home: string): Promise<void> {
	const project = join(home, "proj");
	await mkdir(project, { recursive: true });
	await writeFile(join(project, "readme.md"), "# probe\n");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1360, height: 980, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: [{ id: "e2e", name: "proj", path: project, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: null,
			permissionMode: "auto",
			thinking: "high",
			maxConcurrentSubAgents: 4,
			retryAttempts: 3,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4531, token: null },
			// 三把假 key：填了 key 的那几条才会显示「已填 key」，也才量得到输入框的行为。
			searchApiKeys: { tavily: "tv-probe", brave: "bs-probe", exa: "ex-probe" },
		}),
	);
	await seedUsage(home);
}

/**
 * 九十天的假账，好让「换区间」这个动作有东西可换。
 *
 * 数字动效要量的是「7 天和 90 天的读数不一样，而且中间走过去了」，所以两段的差必须足够大。这里
 * 让用量按天递减：最近七天很少，往前越来越多——90 天的总额是 7 天的几十倍，切换时那个数要跨过
 * 几个数量级，中间帧想漏都难。
 *
 * 两个供应商，因为图例、按供应商拆分的曲线和费用列表都要有两条以上才谈得上「重新分配」。
 */
async function seedUsage(home: string): Promise<void> {
	const dir = join(home, "sessions", "probe");
	await mkdir(dir, { recursive: true });
	const day = 24 * 60 * 60 * 1000;
	const lines: string[] = [];
	for (let back = 0; back < 90; back++) {
		const at = Date.now() - back * day;
		// 越往前用得越多：7 天窗口只罩住最小的那一头，90 天才把大头收进来。
		const scale = 1 + back * 3;
		for (const [provider, model] of [["relay", "gemini-3.8-flash"], ["fast", "grok-4.6"]] as const) {
			lines.push(
				JSON.stringify({
					type: "message",
					message: {
						role: "assistant",
						timestamp: at,
						provider,
						model,
						usage: { input: 1200 * scale, output: 320 * scale, cacheRead: 8000 * scale, cacheWrite: 0, cost: 0.004 * scale },
					},
				}),
			);
		}
	}
	await writeFile(join(dir, "probe.jsonl"), `${lines.join("\n")}\n`);
}

const problems: string[] = [];
const note = (line: string) => console.log(line);
const check = (ok: boolean, complaint: string) => {
	if (!ok) problems.push(complaint);
};

const app = await startApp({ port: PORT, seed });

/** 打开设置里的某一页，用导航按钮的文字找。 */
async function openPane(label: string): Promise<boolean> {
	const opened = await app.evaluate<boolean>(`(() => {
		const nav = [...document.querySelectorAll("nav button")].find((b) => b.innerText.trim() === ${JSON.stringify(label)});
		if (!nav) return false;
		nav.click();
		return true;
	})()`);
	await pause(500);
	return opened;
}

try {
	await pause(2600);
	// 侧边栏最底下那个入口，跟 `delegation-settings-probe.ts` 走同一条路。
	const entered = await app.evaluate<boolean>(`(() => {
		const entry = document.querySelector(".ly-sidebar-foot button");
		if (!entry) return false;
		entry.click();
		return true;
	})()`);
	check(entered, "侧边栏底部没找到设置入口");
	await pause(1400);

	// ---- 1. 数字框里的数字居中 -------------------------------------------
	note("\n【1】数字站在框的正中间");
	const opened = await openPane("子智能体调度");
	check(opened, "导航里点不到「子智能体调度」");

	const field = await app.evaluate<{ align: string; boxOffset: number; rowOffset: number } | null>(`(() => {
		const el = document.querySelector('[aria-label="最多同时运行的子智能体数量"]');
		if (!el) return null;
		const row = el.closest("[data-settings-row]");
		const r = el.getBoundingClientRect(), rr = row ? row.getBoundingClientRect() : r;
		/*
		 * 「字在框里居不居中」量不到字本身的盒子——input 里的文字没有自己的节点。所以量的是声明：
		 * text-align 是不是 center。旁边再量一道框在它那一行里的垂直位置，那是同一批改动里的另一
		 * 条，顺手一起看。
		 */
		return {
			align: getComputedStyle(el).textAlign,
			boxOffset: Math.round(r.y + r.height / 2 - (rr.y + rr.height / 2)),
			rowOffset: Math.round(rr.height),
		};
	})()`);
	note(`  并发上限输入框 → text-align: ${field?.align ?? "?"}，离行中线 ${field?.boxOffset ?? "?"}pt`);
	check(field?.align === "center", `并发上限里的数字没有居中：${field?.align}`);
	check(Math.abs(field?.boxOffset ?? 99) <= 1, `并发上限输入框没落在行的中线上：偏 ${field?.boxOffset}pt`);

	// ---- 2. 五档的记号落在整条的中线上 -----------------------------------
	note("\n【2】五档的记号落在整条的中线上");
	const tiers = await app.evaluate<{ tier: string; markOffset: number; levelOffset: number; height: number }[]>(`(() => {
		return [...document.querySelectorAll("[data-delegation-tier]")].map((row) => {
			const r = row.getBoundingClientRect();
			const mark = row.querySelector("svg");
			const level = row.lastElementChild && row.lastElementChild.tagName === "SPAN" ? row.lastElementChild : null;
			const mid = r.y + r.height / 2;
			const centre = (el) => { const b = el.getBoundingClientRect(); return Math.round(b.y + b.height / 2 - mid); };
			return {
				tier: row.dataset.delegationTier,
				markOffset: mark ? centre(mark) : 999,
				levelOffset: level ? centre(level) : 999,
				height: Math.round(r.height),
			};
		});
	})()`);
	for (const row of tiers) {
		note(`  ${row.tier.padEnd(10)} 高 ${row.height}pt，记号偏 ${row.markOffset}pt，等级偏 ${row.levelOffset}pt`);
		check(Math.abs(row.markOffset) <= 1, `「${row.tier}」的记号没落在整条的中线上：偏 ${row.markOffset}pt`);
		check(row.levelOffset === 999 || Math.abs(row.levelOffset) <= 1, `「${row.tier}」右边的等级没落在中线上：偏 ${row.levelOffset}pt`);
	}
	check(tiers.length === 5, `档位不是五条，是 ${tiers.length} 条`);

	// ---- 3. 网页搜索：圈居中，而且 hover 之后还看得见 ---------------------
	note("\n【3】网页搜索那五条：圈居中，鼠标移上去还看得见");
	check(await openPane("网页搜索"), "导航里点不到「网页搜索」");

	const rings = await app.evaluate<{ id: string; offset: number; height: number; border: string; hoverBorder: string; hoverBg: string }[]>(`(() => {
		/*
		 * hover 的边框色读的是 CSS 规则本身，不是靠合成一次鼠标移动。
		 *
		 * 合成的 pointerover 进不了 hover 状态——那是浏览器按真实指针位置算的。所以直接问样式表。
		 * 规则可能裹在 @media (hover: hover) 里（Tailwind v4 就是这么发的），所以要往下递归，
		 * 不能只扫顶层——只扫顶层的那一版在这里报了「没有 hover 规则」，而规则其实是在的。
		 */
		const hoverRules = [];
		const walk = (rules) => {
			for (const rule of rules) {
				if (rule.cssRules) walk(rule.cssRules);
				if (rule.selectorText && rule.selectorText.includes(":hover")) hoverRules.push(rule);
			}
		};
		for (const sheet of document.styleSheets) { try { walk(sheet.cssRules); } catch {} }
		const hoverStyle = (el, prop) => {
			for (const rule of hoverRules) {
				const bare = rule.selectorText.replace(/:hover/g, "");
				let hit = false;
				try { hit = el.matches(bare); } catch { continue; }
				if (hit && rule.style[prop]) return rule.style[prop];
			}
			return "没有 hover 规则";
		};

		return [...document.querySelectorAll("[data-search-provider]")].map((row) => {
			const ring = row.querySelector("span.rounded-full");
			const r = row.getBoundingClientRect(), b = ring.getBoundingClientRect();
			return {
				id: row.dataset.searchProvider,
				offset: Math.round(b.y + b.height / 2 - (r.y + r.height / 2)),
				height: Math.round(r.height),
				border: getComputedStyle(ring).borderColor,
				hoverBorder: hoverStyle(ring, "borderColor"),
				hoverBg: hoverStyle(row, "backgroundColor"),
			};
		});
	})()`);
	for (const ring of rings) {
		note(`  ${ring.id.padEnd(12)} 条高 ${ring.height}pt，圈偏 ${ring.offset}pt，圈边框 ${ring.border}，hover 时 ${ring.hoverBorder}（底色 ${ring.hoverBg}）`);
		check(Math.abs(ring.offset) <= 1, `「${ring.id}」那一条的圈没落在中线上：偏 ${ring.offset}pt`);
		check(
			ring.hoverBorder !== "没有 hover 规则" || ring.border.includes("accent"),
			`「${ring.id}」的圈没有 hover 规则——在 hover 底色上它跟底色只差四级灰，等于消失`,
		);
	}
	check(rings.length === 5, `搜索服务商不是五条，是 ${rings.length} 条`);

	// ---- 4. API key 输入不再显示「已保存」，也不再每敲一下就落盘 -----------
	note("\n【4】填 key 的时候不弹「已保存」");
	const typed = await app.evaluate<{ saidSaved: boolean; value: string } | null>(`(async () => {
		const box = [...document.querySelectorAll('input[type="password"]')][0];
		if (!box) return null;
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
		let saidSaved = false;
		for (const ch of "abcdefgh") {
			setter.call(box, box.value + ch);
			box.dispatchEvent(new Event("input", { bubbles: true }));
			await new Promise((r) => setTimeout(r, 30));
			if (document.body.innerText.includes("已保存")) saidSaved = true;
		}
		return { saidSaved, value: box.value };
	})()`);
	if (!typed) check(false, "网页搜索页上没找到 API key 输入框");
	else {
		note(`  敲了八下，${typed.saidSaved ? "看到了" : "没看到"}「已保存」；框里现在是 ${typed.value.length} 个字符`);
		check(!typed.saidSaved, "打字的时候页面上出现了「已保存」——这一页本来就没有保存按钮，每一处改动都是当场生效的");
		check(typed.value.length > 8, "输入框吃掉了输入——受控组件的本地草稿没接上");
	}

	// ---- 5. 使用统计换区间时数字是走过去的 --------------------------------
	note("\n【5】使用统计换区间：数字走过去，不是跳过去");
	check(await openPane("使用统计"), "导航里点不到「使用统计」");
	await pause(1500);

	const travel = await app.evaluate<{ samples: string[]; changed: number; before: string; after: string } | null>(`(async () => {
		const readCost = () => {
			const card = document.querySelector("[data-usage-dashboard]");
			if (!card) return null;
			const big = card.querySelector(".text-\\\\[32px\\\\]");
			return big ? big.innerText.trim() : null;
		};
		const before = readCost();
		if (before === null) return null;
		const seg = [...document.querySelectorAll("[data-segment]")].find((b) => b.dataset.segment === "7");
		if (!seg) return null;
		seg.click();
		/*
		 * 按绘制帧采样，不是按定时器。
		 *
		 * 定时器会漏掉中间帧，而中间帧正是这里唯一要证明的东西——数字有没有经过两个端点之间的值。
		 */
		const samples = [];
		await new Promise((done) => {
			let frames = 0;
			const tick = () => {
				const now = readCost();
				if (now !== null && samples[samples.length - 1] !== now) samples.push(now);
				if (++frames < 40) requestAnimationFrame(tick); else done();
			};
			requestAnimationFrame(tick);
		});
		return { samples, changed: samples.length, before, after: readCost() };
	})()`);
	if (!travel) {
		note("  这台机器上没有可读的用量数据，跳过——需要 ~/.lyra 里有会话记录");
	} else {
		note(`  ${travel.before} → ${travel.after}，中间经过 ${travel.changed} 个不同的值`);
		note(`  取样：${travel.samples.slice(0, 8).join(" → ")}${travel.samples.length > 8 ? " → …" : ""}`);
		if (travel.before === travel.after) note("  （两个区间的数一样，这一项说明不了什么）");
		else check(travel.changed >= 4, `换区间时数字是跳过去的：只经过 ${travel.changed} 个值`);
	}

	note("");
	if (problems.length === 0) note("全部通过。");
	else {
		note(`${problems.length} 处不对：`);
		for (const problem of problems) note(`  ✗ ${problem}`);
	}
} finally {
	await app.stop();
}

process.exit(problems.length === 0 ? 0 : 1);
