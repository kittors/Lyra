/* oxlint-disable no-console -- a probe CLI whose entire output is what it printed */

/**
 * 全局按钮改成图标 + tooltip，走一遍并录下来。
 *
 * 也是验证本身：每一步先把鼠标真的移上去、等 tooltip 浮出来，再断言它确实浮出来了、确实带着
 * 原来那句话。视频里看到的和绿色的那一行是同一份证据——一个「跑过了但视频里没有」的演示，比没
 * 有演示更糟。
 *
 * 最后一段特意留给确认对话框，而它现在走的是相反的路：那两颗按钮又把字写了回去。图标 + tooltip
 * 这笔交易在工具栏里划算——周围一排东西替每颗按钮说明它属于哪一类；对话框底下那两颗没有这个
 * 周围，它们是这次操作的结论本身。所以这支演示的前三段和第四段结论相反，这是有意的。
 *
 * 帧是 JPEG，手势一步一步走。`Page.captureScreenshot` 的时间几乎全花在压缩上，PNG 在这个尺寸
 * 下一帧要几百毫秒——之前有一版把三分钟录成了 140 帧，放出来是一叠幻灯片。
 *
 * 跑：node --experimental-strip-types e2e/icon-buttons-demo.ts
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const PORT = 9481;
const OUT = join(import.meta.dirname, "..", "..", "..", "test-results", "icon-buttons-demo");
const FRAMES = join(OUT, "frames");
const WINDOW = { width: 1440, height: 900 };

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const app = await startApp({
	port: PORT,
	seed: async (home) => {
		const root = join(home, "project");
		await mkdir(root, { recursive: true });
		await writeFile(join(home, "window.json"), JSON.stringify({ ...WINDOW, x: 0, y: 0 }));
		await writeFile(
			join(home, "settings.json"),
			JSON.stringify({
				version: 1,
				/*
				 * 放一个供应商进去，模型设置页才有东西可删。
				 *
				 * 删除是这支演示的最后一站——确认对话框只有在真的要毁掉什么的时候才出现，而空的
				 * profile 里没有任何东西可毁。
				 */
				providers: [
					{
						id: "demo",
						name: "Demo Provider",
						api: "openai-responses",
						baseUrl: "https://example.invalid/v1",
						apiKey: "sk-demo",
						enabled: true,
						models: [
						{
							id: "demo/one",
							providerId: "demo",
							modelId: "demo-model",
							name: "Demo Model",
							contextWindow: 128_000,
							maxOutputTokens: 8_192,
							supportsThinking: false,
							supportsImages: false,
							supportsTools: true,
						},
					],
					},
				],
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
				// 开着，同步页才画得出那几颗按钮——关掉的时候整页只有一个开关。
				sync: { enabled: true, port: 4519, token: "demo-token-0000" },
				appearance: { theme: "dark" },
			}),
		);
	},
});

let frame = 0;
let recorder: ReturnType<typeof setInterval> | null = null;
const stamps: number[] = [];

const capture = async (path: string, format: "png" | "jpeg" = "png") => {
	const shot = await app.send<{ data: string }>(
		"Page.captureScreenshot",
		format === "jpeg" ? { format, quality: 62 } : { format },
	);
	await writeFile(path, Buffer.from(shot.data, "base64"));
};

const record = () => {
	let busy = false;
	recorder = setInterval(() => {
		if (busy) return;
		busy = true;
		const at = Date.now();
		capture(join(FRAMES, `${String(frame++).padStart(5, "0")}.jpg`), "jpeg")
			.then(() => void stamps.push(at))
			.catch(() => {})
			.finally(() => {
				busy = false;
			});
	}, 40);
};

const stop = () => {
	if (recorder) clearInterval(recorder);
	recorder = null;
};

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
	console.log(`${ok ? "  ✔" : "  ✖"} ${what}`);
	if (!ok) failures.push(what);
};

const click = async (x: number, y: number) => {
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
};

const moveTo = (x: number, y: number) =>
	app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", clickCount: 0 });

/** 把鼠标从现在这儿走到那儿，中间经过几步——tooltip 只认 pointermove。 */
const glideTo = async (to: { x: number; y: number }, from = { x: 8, y: 8 }) => {
	for (let step = 1; step <= 6; step++) {
		await moveTo(Math.round(from.x + ((to.x - from.x) * step) / 6), Math.round(from.y + ((to.y - from.y) * step) / 6));
		await pause(45);
	}
};

/**
 * 屏幕上某个东西的中心，好把指针真送过去——必要时先把它滚进视野。
 *
 * 不滚的话坐标照样算得出来，只是落在窗口外面：指针挪过去什么也没碰到，tooltip 不出现，而断言
 * 报的是「这颗按钮不会说话」。同步页和智能体页的那两颗就是这么假红的。
 */
const centreOf = async (script: string) => {
	const found = await app.evaluate<boolean>(`(() => {
		const el = ${script};
		if (!el) return false;
		const r = el.getBoundingClientRect();
		if (r.top < 60 || r.bottom > window.innerHeight - 20) el.scrollIntoView({ block: "center" });
		return true;
	})()`);
	if (!found) return null;
	// 滚动是平滑的，等它停下来再量。
	await pause(700);
	return app.evaluate<{ x: number; y: number } | null>(`(() => {
		const el = ${script};
		if (!el) return null;
		const r = el.getBoundingClientRect();
		if (r.width === 0 || r.bottom < 0 || r.top > window.innerHeight) return null;
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
};

/**
 * 正浮着的那条 tooltip 说了什么。
 *
 * 「正浮着」要一个一个条件地排掉：退场的那条带 `data-leaving`，它的动画还没播完、文字还是上
 * 一句；另外还有 `opacity` 已经归零但元素尚在的一瞬。不排掉的话，量到的是上一页的残影——第一
 * 版里连着三页都报「恢复默认」，三条断言全绿，而绿的是同一句话。
 */
const tooltipText = () =>
	app.evaluate<string>(`(() => {
		for (const tip of document.querySelectorAll('.ly-tooltip, [role="tooltip"]')) {
			if (tip.hasAttribute('data-leaving')) continue;
			const style = getComputedStyle(tip);
			if (style.opacity === '0' || style.display === 'none' || style.visibility === 'hidden') continue;
			if (tip.getBoundingClientRect().width === 0) continue;
			return (tip.textContent || '').trim();
		}
		return '';
	})()`);

/**
 * 走到某个设置分区。
 *
 * 只在设置页自己的导航里找。全局找的话，「插件」在两个地方都叫这个名字——侧边栏那个跳的是插件
 * 市场，整扇设置页就此关掉，后面几段全在另一个视图里扑空。
 */
const goSection = (label: string) =>
	app.evaluate<boolean>(`(async () => {
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		/*
		 * 全局找，但绕开侧边栏。
		 *
		 * 「插件」在两个地方都叫这个名字：侧边栏那个跳的是插件市场，整扇设置页就此关掉，后面几
		 * 段全在另一个视图里扑空。而设置导航本身不好按容器认——它在不同宽度下换过外壳——所以反
		 * 过来排掉那个会认的：.ly-sidebar。
		 */
		const item = [...document.querySelectorAll('button, a')].find(
			(b) => (b.textContent || '').trim() === ${JSON.stringify(label)} && !b.closest('.ly-sidebar, .ly-sidebar-foot'),
		);
		if (!item) return false;
		item.click();
		await wait(900);
		return true;
	})()`);

/**
 * 悬停一颗图标按钮，等它说话，把说的记下来。
 *
 * `find` 拿到的是一段在页面里跑的表达式，而不是选择器——这些按钮没有一个能靠 class 认出来，能
 * 认出它们的是「有图标、没有字、带着 data-ly-tip」这件事本身，而那正是这次改动的形状。
 */
const hoverIcon = async (where: string, find: string) => {
	const spot = await centreOf(find);
	if (!spot) {
		check(false, `${where}：没找到要演示的那颗按钮`);
		return;
	}
	await glideTo(spot);
	await pause(1_100);
	let said = await tooltipText();
	/*
	 * 一次不出来就再走一趟。
	 *
	 * tooltip 认的是 pointermove，而指针有时已经停在目标上了——上一段结束时停的地方恰好就是这
	 * 里，或者滚动把这颗按钮送到了指针底下。那种情况下没有任何一次移动发生过，悬停等于没发生。
	 * 先挪开再走回来，是唯一能保证真有一次「移上去」的办法。
	 */
	if (!said) {
		await moveTo(8, 8);
		await pause(250);
		await glideTo(spot);
		await pause(1_200);
		said = await tooltipText();
	}
	console.log(`   ${where.padEnd(12)} tooltip：「${said}」`);
	check(said.length > 0, `${where}：图标按钮悬停后说出了自己是谁`);
	await capture(join(OUT, `${where.replace(/[^\w-]/g, "_")}.png`));
	await moveTo(8, 8);
	/*
	 * 等它真的散掉，而不是等一个差不多的时长。
	 *
	 * tooltip 退场有动画，走得比指针慢；上一版只等了 250ms，下一页量到的还是上一页那句话——
	 * 「智能体-添加」的 tooltip 报成了「恢复默认」，两次演示看起来都绿，其实第二次量的是残影。
	 */
	for (let i = 0; i < 20 && (await tooltipText()); i++) await pause(100);
};

/**
 * 这一页上所有「只有图标、没有字、带着 tooltip」的按钮，按它们说的话列出来。
 *
 * 既是选演示对象的依据，也是诊断：第一版按「第一颗」选，每页都选中了顶栏那颗「隐藏设置导航」
 * ——它在每一页上都排第一，于是四段演示录了同一颗按钮。
 */
const iconButtonsOn = () =>
	app.evaluate<string[]>(`(() => [...document.querySelectorAll('button[data-ly-tip]')]
		.filter((el) => el.querySelector('svg') && !(el.innerText || '').trim() && el.getBoundingClientRect().width > 0)
		.map((el) => el.getAttribute('data-ly-tip') || ''))()`);

/** 页面主体里、tooltip 里带某个词的那颗图标按钮——绕开每页都有的那几颗外壳按钮。 */
const iconButtonSaying = (word: string) =>
	`[...document.querySelectorAll('button[data-ly-tip]')].find((el) =>
		el.querySelector('svg') && !(el.innerText || '').trim() &&
		el.getBoundingClientRect().width > 0 &&
		(el.getAttribute('data-ly-tip') || '').includes(${JSON.stringify(word)}))`;

try {
	await rm(FRAMES, { recursive: true, force: true });
	await mkdir(FRAMES, { recursive: true });
	await mkdir(OUT, { recursive: true });
	await pause(3_000);
	await app.evaluate(`(async () => {
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		const row = document.querySelector('[data-project-row], [data-ly-project]');
		if (row) { row.click(); await wait(1200); }
		return true;
	})()`);
	await pause(1_200);
	record();

	console.log("\n[1] 进设置");
	await app.evaluate(`(async () => {
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		const gear = document.querySelector('.ly-sidebar-foot button');
		if (gear) { gear.click(); await wait(1400); }
		return true;
	})()`);
	await pause(1_400);

	/** 走到一页，报出它有哪些图标按钮，再悬停其中一颗。 */
	const visit = async (section: string, want: string) => {
		console.log(`\n— ${section}`);
		if (!(await goSection(section))) {
			check(false, `${section}：没找到入口`);
			return;
		}
		await pause(900);
		const tips = await iconButtonsOn();
		console.log(`   图标按钮 ${tips.length} 颗：${tips.slice(0, 8).join(" / ")}${tips.length > 8 ? " …" : ""}`);
		await hoverIcon(`${section}-${want}`, iconButtonSaying(want));
	};

	/*
	 * 两页，不是六页。
	 *
	 * 每多走一页就多一次「这一页的哪颗按钮」的猜测，而这支探针要证的事跟页数无关：一颗图标按钮
	 * 悬停时说得出自己是谁。走遍全应用是另一支探针的事（`text-buttons-probe`，22 屏），那边按
	 * 结构判定，不需要认出具体哪一颗。
	 */
	console.log("\n[2] 逐页悬停，看它们各自说什么");
	await visit("关于", "检查更新");
	await visit("代码格式化", "恢复");

	// ── 下拉触发器：留字，箭头转身 ────────────────────────────────────────────────────────────
	console.log("\n[3] 下拉触发器：字在左，箭头跟着开合转身");
	await goSection("模型设置");
	await pause(1_200);
	/*
	 * 任意一颗留着字的下拉触发器，不指定是哪一颗。
	 *
	 * 指名道姓地找过三轮，每轮都因为「那一页此刻恰好没画出它」而扑空——供应商卡片要展开才有
	 * API 格式那一栏，插件页的「添加」在另一条导航后面。而这一段要证的事跟是哪一颗无关：开菜单
	 * 的按钮留着字，它的箭头跟着开合转身。页面上任意一颗都能证。
	 */
	const findDropdown = `[...document.querySelectorAll('button[aria-haspopup], button[aria-expanded]')].find((el) => {
		const r = el.getBoundingClientRect();
		return el.querySelector('svg') && (el.innerText || '').trim() && r.width > 0 && r.top > 0 && r.bottom < window.innerHeight;
	})`;
	const dropdown = await centreOf(findDropdown);
	if (!dropdown) {
		check(false, "没找到一颗留着字的下拉触发器");
	} else {
		const shape = () =>
			app.evaluate<{ text: string; turn: string }>(`(() => {
				const el = ${findDropdown};
				const svg = el && el.querySelector('svg');
				return { text: el ? (el.innerText || '').trim() : '', turn: svg ? getComputedStyle(svg).transform : 'none' };
			})()`);

		await glideTo(dropdown);
		await pause(500);
		const shut = await shape();
		console.log(`   收起：文字「${shut.text}」，箭头 ${shut.turn}`);
		check(shut.text.length > 0, `开菜单的那颗留着字（「${shut.text}」）`);

		/*
		 * 转身要看得见中间那一段。
		 *
		 * 只比开合两头的话，「滑过去」和「跳过去」量出来一模一样——两头都是 0° 和 180°。中间那
		 * 几帧才是过渡本身，所以点下去之后立刻逐帧取，看有没有出现既不是 0° 也不是 180° 的角度。
		 */
		await click(dropdown.x, dropdown.y);
		const seen: string[] = [];
		for (let i = 0; i < 12; i++) {
			seen.push((await shape()).turn);
			await pause(25);
		}
		await pause(400);
		const open = await shape();
		console.log(`   展开：箭头 ${open.turn}`);
		const halfway = seen.filter((t) => t !== shut.turn && t !== open.turn && t !== "none");
		console.log(`   中间态 ${halfway.length} 帧：${[...new Set(halfway)].slice(0, 3).join(" | ") || "（一帧都没有）"}`);
		check(open.turn !== shut.turn, `箭头确实转了（${shut.turn} → ${open.turn}）`);
		check(halfway.length > 0, `转身是滑过去的，量到 ${halfway.length} 帧中间态`);
		await capture(join(OUT, "下拉-展开.png"));

		// 按 Esc 收回去，别把一张菜单留在后面几段的画面里。
		await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", windowsVirtualKeyCode: 27 });
		await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", windowsVirtualKeyCode: 27 });
		await pause(600);
	}

	console.log("\n[4] 确认对话框：动词写在按钮上");
	// 已经在模型设置页上了——上一段就是在这儿开的下拉。
	console.log(`   这一页的图标按钮：${(await iconButtonsOn()).slice(-12).join(" / ")}`);
	/*
	 * 删除那颗按钮，靠 tooltip 认出来。
	 *
	 * 这一页的图标按钮有六七颗，位置随供应商卡片的展开状态变；能唯一认出删除的是它自己说的那
	 * 句话，而那句话现在就写在 `data-ly-tip` 上——这也正是这次改动留下的东西。
	 */
	const remove = await centreOf(
		`[...document.querySelectorAll('button[data-ly-tip]')].find((el) => /删除|移除/.test(el.getAttribute('data-ly-tip') || ''))`,
	);
	if (!remove) {
		check(false, "模型设置页没找到删除按钮");
	} else {
		await glideTo(remove);
		await pause(900);
		await capture(join(OUT, "确认框-悬停删除.png"));
		await click(remove.x, remove.y);
		await pause(1_200);

		const dialog = await app.evaluate<{ title: string; buttons: { words: string; glyph: boolean }[] } | null>(`(() => {
			const box = document.querySelector('[data-ly-modal], [role="dialog"]');
			if (!box) return null;
			return {
				title: (box.querySelector('[data-dialog-title], h2') || {}).textContent || '',
				buttons: [...box.querySelectorAll('button')].map((b) => ({
					words: (b.innerText || '').trim(),
					glyph: Boolean(b.querySelector('svg')) && !(b.innerText || '').trim(),
				})),
			};
		})()`);
		console.log("   ", JSON.stringify(dialog));
		check(Boolean(dialog), "确认对话框弹出来了");
		/*
		 * 读的是画出来的字，不是 `aria-label`——这一段要证的正是「不用把鼠标停上去也读得出来」。
		 * `innerText` 只算渲染出来的文本，一个藏在 tooltip 里的动词在这里是空字符串。
		 */
		check(
			Boolean(dialog) && dialog!.buttons.length >= 2 && dialog!.buttons.every((b) => !b.glyph && b.words.length > 0),
			`对话框里两颗按钮都把动词写在了脸上（${dialog?.buttons.map((b) => b.words).join(" / ") ?? "?"}）`,
		);
		check(Boolean(dialog?.title?.trim()), `代价写在标题上（「${dialog?.title?.trim() ?? ""}」）`);
		await capture(join(OUT, "确认框-展开.png"));

		// 移到那颗执行按钮上，把它的悬停态也录进去——字是常驻的，这里等的只是底色。
		const confirmSpot = await centreOf(
			`[...document.querySelectorAll('[data-ly-modal] button, [role="dialog"] button')].at(-1)`,
		);
		if (confirmSpot) {
			await glideTo(confirmSpot, remove);
			await pause(900);
			await capture(join(OUT, "确认框-悬停执行.png"));
		}

		// 按取消退出，不真删——演示不该把自己的固件改掉。
		const cancelSpot = await centreOf(
			`[...document.querySelectorAll('[data-ly-modal] button, [role="dialog"] button')][0]`,
		);
		if (cancelSpot) {
			await glideTo(cancelSpot, confirmSpot ?? remove);
			await pause(700);
			await click(cancelSpot.x, cancelSpot.y);
			await pause(900);
		}
	}

	await moveTo(8, 8);
	await pause(600);

	stop();
	const spans = stamps.slice(1).map((at, i) => at - stamps[i]);
	const mean = spans.length ? Math.round(spans.reduce((a, b) => a + b, 0) / spans.length) : 0;
	await writeFile(join(OUT, "frames.json"), JSON.stringify({ stamps }));
	console.log(`\n帧 ${frame} 张，平均间隔 ${mean}ms（约 ${mean ? (1000 / mean).toFixed(1) : "?"} fps）`);
	console.log(`截图与帧写到 ${OUT}`);
	console.log(failures.length === 0 ? "\n全部通过" : `\n${failures.length} 条没过：\n- ${failures.join("\n- ")}`);
} catch (error) {
	console.error("\n探针自己出错了:", error);
	failures.push(String(error));
} finally {
	stop();
	await app.stop();
}

if (failures.length > 0) process.exitCode = 1;
