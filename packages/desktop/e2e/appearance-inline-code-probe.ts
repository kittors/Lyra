/**
 * 行内代码的配色、界面字重、恢复默认那颗按钮——在真窗口里量画出来的结果。
 *
 * `node --experimental-strip-types e2e/appearance-inline-code-probe.ts`
 *
 * 三件事凑在一个探针里，是因为它们共用一个开销很大的前提：一个装好了会话、进得去设置页的窗口。
 * 分成三个文件就是三次启动、三个窗口抢焦点。
 *
 * 量的都是 `getComputedStyle` 的结果，不是设置里写进去的值——设置写对了而屏幕上没变，正是这次
 * 要防的那种「代码在、功能不在」。所以：
 *
 *   配色   `.prose-dw code` 真实画出来的底色和字色，三种来源各量一次
 *   字重   `body` 的字重，以及一个 `font-semibold` 的标题——后者是重点：Tailwind 那几个字重是
 *          写死的 500/600，不接过来的话调基准只会拉大层级而不是搬走层级
 *   主题   按一下整页恢复默认，看「系统」那张卡片是不是被选中的那张
 *
 * 启动时的设置直接写成「自定义 + 描边 + 字重 500」，所以第一次测量就回答了「设置能不能变成画面」；
 * 之后两档改由点击那排分段控件驱动，回答「界面能不能改设置」。两个方向都得验，一个方向对另一个
 * 方向不成立——这两条接线是分开的。
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const dir = process.argv[2] ?? "/tmp/lyra-inline-code";
const project = join(dir, "proj");

/** 自定义那一档给的颜色。挑得刺眼，是为了「没生效」和「生效了」不可能看混。 */
const CUSTOM_BG = "#FFE8CC";
const CUSTOM_FG = "#B34700";
const CUSTOM_BG_RGB = "rgb(255, 232, 204)";
const CUSTOM_FG_RGB = "rgb(179, 71, 0)";

/**
 * 基准字重，故意既不是默认值也不是 400。
 *
 * 默认现在是 500，用 500 来测就测不出东西了：设置压根没接上，量到的也会是 500。要让「这个数从
 * 设置走到了屏幕上」这句话有内容，它就得是屏幕上不会自己出现的那个数。往细里挑而不是往粗里，
 * 是因为 PingFang 只到 600：基准 500 时 `font-semibold` 该算到 700，而字体那边给不出 700，
 * 量 computed 值看不出来，量渲染又不是这条探针的事。300 下面两档都在字体有的范围里。
 */
const WEIGHT = 300;

async function seed(home: string): Promise<void> {
	await mkdir(project, { recursive: true });
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1320, height: 900, x: 0, y: 0 }));
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
			sync: { enabled: false, port: 4533, token: null },
			appearance: {
				theme: "light",
				codeLightTheme: "solarized-light",
				codeDarkTheme: "github-dark",
				uiFontWeight: WEIGHT,
				inlineCode: "custom",
				inlineCodeLightBg: CUSTOM_BG,
				inlineCodeLightFg: CUSTOM_FG,
				inlineCodeBorder: true,
			},
		}),
	);

	const projectId = createHash("sha256").update(project).digest("hex").slice(0, 16);
	await mkdir(join(home, "sessions", projectId), { recursive: true });
	const meta = {
		id: "inline",
		title: "行内代码",
		cwd: project,
		projectId,
		projectName: "proj",
		createdAt: 1,
		updatedAt: 2,
		modelId: "none",
		messageCount: 2,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		seq: 3,
	};
	/*
	 * 一句带两块行内代码的话，外加一个围栏块。
	 *
	 * 围栏块在这儿是当对照用的：它里面那枚 `<code>` 必须*不*跟着行内代码的配色走，否则调一次
	 * 行内代码会把每个代码块里的字都染一遍。`seq` 从 1 起——写 0 的 meta 会被静默读掉。
	 */
	const reply = [
		"已推送到 `origin/main`，最新提交 `f36a74b`。",
		"",
		/*
		 * 一个 h4，为的是守住「标题得比正文重」。
		 *
		 * 它和 h3 是同一个字号，两者之间只有一档字重；而它的字重曾经是写死的 500——基准一提到 500，
		 * 这个标题就和它脚下的正文一样重，标题这一级凭空消失。写死的数旁边只要有个会动的数，它迟早
		 * 会撞上，所以这里量的是「它比正文重多少」。
		 */
		"#### 小标题",
		"",
		"底下这一段是正文。",
		"",
		"```bash",
		"git log --oneline -1",
		"```",
	].join("\n");
	const lines = [
		JSON.stringify({ seq: 1, ts: 1, type: "meta", meta }),
		JSON.stringify({
			seq: 2,
			ts: 2,
			type: "message",
			message: { role: "user", content: [{ type: "text", text: "推了吗" }], timestamp: 2 },
		}),
		JSON.stringify({
			seq: 3,
			ts: 3,
			type: "message",
			message: { role: "assistant", content: [{ type: "text", text: reply }], timestamp: 3 },
		}),
	];
	await writeFile(join(home, "sessions", projectId, "inline.jsonl"), `${lines.join("\n")}\n`);
	await writeFile(join(home, "sessions", "index.json"), JSON.stringify([meta], null, 2));
}

const app = await startApp({ port: 9487, seed });
const settle = (ms = 700) => new Promise((resolve) => setTimeout(resolve, ms));

let failures = 0;
function check(label: string, passed: boolean, evidence: string): void {
	if (!passed) failures++;
	process.stdout.write(`  ${passed ? "✓" : "✗"} ${label}\n      ${evidence}\n`);
}

type Paint = {
	/** 句子里那一块：底色、字色、描边。 */
	bg: string;
	fg: string;
	ring: string;
	/** 围栏块里那一枚，必须不跟着走。 */
	blockCodeBg: string;
	blockCodeRing: string;
	/** 界面字重：正文一个、标题一个（当场挂类的，和页面上真有的）。 */
	bodyWeight: string;
	headingWeight: string;
	realHeadingWeight: string;
	/** 回答里的 h4 和它脚下那段正文——两者之间那一档字重是 h4 唯一的层级。 */
	h4Weight: string;
	paraWeight: string;
	found: boolean;
};

const readPaint = `(() => {
	/*
	 * 从 code 往上 closest("pre") 判断，而不是靠选择器分辨。页面上有两种壳，写死路径会量错人。
	 */
	const codes = [...document.querySelectorAll(".prose-dw code")];
	const inline = codes.find((el) => !el.closest("pre"));
	const inBlock = codes.find((el) => el.closest("pre"));
	const paint = (el, prop) => (el ? getComputedStyle(el)[prop] : "无");
	/*
	 * 字重量两处，互相佐证。
	 *
	 * 页面上真有的那个 \`.font-semibold\`（会话页不一定有，设置页一定有），和一个当场挂上这个类的
	 * 空 span。后者回答的是「这一页上 font-semibold 解析成几」——也就是 \`--font-weight-semibold\`
	 * 那条 clamp 到底算没算出数；直接读变量读到的是 clamp 的原文，不是结果。
	 */
	const probe = document.createElement("span");
	probe.className = "font-semibold";
	document.body.appendChild(probe);
	const synthetic = getComputedStyle(probe).fontWeight;
	probe.remove();
	const real = document.querySelector(".font-semibold");
	const h4 = document.querySelector(".prose-dw h4");
	const para = document.querySelector(".prose-dw p");
	return {
		h4Weight: paint(h4, "fontWeight"),
		paraWeight: paint(para, "fontWeight"),
		bg: paint(inline, "backgroundColor"),
		fg: paint(inline, "color"),
		ring: paint(inline, "boxShadow"),
		blockCodeBg: paint(inBlock, "backgroundColor"),
		blockCodeRing: paint(inBlock, "boxShadow"),
		bodyWeight: getComputedStyle(document.body).fontWeight,
		headingWeight: synthetic,
		realHeadingWeight: paint(real, "fontWeight"),
		found: Boolean(inline),
	};
})()`;

/**
 * 用真实鼠标点开那条会话。
 *
 * `.click()` 和手搓的 `MouseEvent` 都打不开会话行——这一条栽过，所以走 CDP 派真的按下和抬起。
 */
async function openSession(): Promise<boolean> {
	const at = await app.evaluate<{ x: number; y: number } | null>(`(() => {
		const row = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("行内代码"));
		if (!row) return null;
		const box = row.getBoundingClientRect();
		return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
	})()`);
	if (!at) return false;
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
	for (const type of ["mousePressed", "mouseReleased"]) {
		await app.send("Input.dispatchMouseEvent", { type, ...at, button: "left", clickCount: 1 });
	}
	await settle(1700);
	return true;
}

/** 进设置页的某一节。已经在设置里的话，直接点那一节。 */
const openSettings = (section: string) =>
	app.evaluate<boolean>(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		const hit = (text) => {
			const el = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
			el?.click();
			return Boolean(el);
		};
		if (!hit(${JSON.stringify(section)})) {
			document.querySelector(".ly-sidebar-foot button")?.click();
			await wait(1300);
			if (!hit(${JSON.stringify(section)})) return false;
		}
		await wait(1000);
		return true;
	})()`);

/** 回工作区。 */
const backToWorkspace = () =>
	app.evaluate(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		[...document.querySelectorAll("button")].find((b) => b.textContent?.includes("返回工作区"))?.click();
		await wait(1400);
	})()`);

/** 点「行内代码」那排分段控件里的一档。 */
const pickInlineMode = (label: string) =>
	app.evaluate<boolean>(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		const card = document.querySelector("[data-ly-code-appearance]");
		if (!card) return false;
		const button = [...card.querySelectorAll("button")].find((b) => b.textContent?.trim() === ${JSON.stringify(label)});
		if (!button) return false;
		button.click();
		await wait(700);
		return true;
	})()`);

try {
	await mkdir(dir, { recursive: true });
	await settle(2600);
	await openSession();
	await settle(900);

	/* ---- 一、设置里写的「自定义」，有没有真的画出来 ---- */
	const custom = await app.evaluate<Paint>(readPaint);
	check("找得到句子里那块行内代码", custom.found, `bg=${custom.bg} fg=${custom.fg}`);
	check("自定义底色画出来了", custom.bg === CUSTOM_BG_RGB, `期望 ${CUSTOM_BG_RGB}，实得 ${custom.bg}`);
	check("自定义字色画出来了", custom.fg === CUSTOM_FG_RGB, `期望 ${CUSTOM_FG_RGB}，实得 ${custom.fg}`);
	check(
		"描边开了就真有一圈",
		custom.ring !== "none" && custom.ring.includes("inset"),
		`box-shadow=${custom.ring}`,
	);
	check(
		"围栏块里那枚 code 不跟着走",
		custom.blockCodeBg !== CUSTOM_BG_RGB && !custom.blockCodeRing.includes("inset"),
		`块内 bg=${custom.blockCodeBg} ring=${custom.blockCodeRing}`,
	);

	/* ---- 二、界面字重：正文跟着走，层级也跟着走 ---- */
	check("正文字重跟着设置", custom.bodyWeight === String(WEIGHT), `body=${custom.bodyWeight}，设的是 ${WEIGHT}`);
	check(
		"font-semibold 跟着基准搬，而不是钉在 600",
		custom.headingWeight === String(WEIGHT + 200),
		`标题=${custom.headingWeight}，期望 ${WEIGHT + 200}（基准 ${WEIGHT} + 两档）`,
	);
	check(
		"回答里的 h4 仍然比它脚下的正文重",
		Number(custom.h4Weight) > Number(custom.paraWeight),
		`h4=${custom.h4Weight}，正文=${custom.paraWeight}（写死 500 的那版在基准 500 下会相等）`,
	);

	/* ---- 三、界面上切档，画面跟不跟 ---- */
	await openSettings("外观");
	const toApp = await pickInlineMode("跟界面");
	check("外观页上点得到「跟界面」", toApp, toApp ? "点了" : "没找到那一档");
	await backToWorkspace();
	await settle(900);
	const app_ = await app.evaluate<Paint>(readPaint);
	check(
		"切回「跟界面」之后不再是自定义那两个色",
		app_.bg !== CUSTOM_BG_RGB && app_.fg !== CUSTOM_FG_RGB,
		`bg=${app_.bg} fg=${app_.fg}`,
	);

	await openSettings("外观");
	const toSyntax = await pickInlineMode("跟代码主题");
	check("外观页上点得到「跟代码主题」", toSyntax, toSyntax ? "点了" : "没找到那一档");
	await backToWorkspace();
	await settle(900);
	const syntax = await app.evaluate<Paint>(readPaint);
	check(
		"「跟代码主题」和「跟界面」不是同一个颜色",
		syntax.bg !== app_.bg,
		`代码主题 bg=${syntax.bg}，跟界面 bg=${app_.bg}`,
	);
	check(
		"「跟代码主题」下底色不是透明的——默认主题 inherit，照搬会等于没有底",
		syntax.bg !== "rgba(0, 0, 0, 0)" && syntax.bg !== "transparent",
		`bg=${syntax.bg}`,
	);

	/* ---- 五、恢复默认给的是「系统」 ---- */
	/* ---- 三点五、在设置页上改底色，字色跟不跟，预览动不动 ---- */
	await openSettings("外观");
	const coupling = await app.evaluate<{
		picked: boolean;
		fgAfterDark: string;
		fgAfterLight: string;
		fgAfterManual: string;
		specimenBefore: string;
		specimenAfter: string;
		specimenNearControls: boolean;
	}>(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		const card = document.querySelector("[data-ly-code-appearance]");
		/*
		 * React 的受控 input 认的是 value 那个原生 setter，不是属性赋值。
		 *
		 * 直接写 \`input.value = x\` 的话 React 的 onChange 根本不响——它比较的是自己记着的那份
		 * 值，而那份值没动过。这条路是 React 测试里的标准做法，也是这里唯一能「像人一样打字」的路。
		 */
		const type = (input, value) => {
			const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
			setter.call(input, value);
			input.dispatchEvent(new Event("input", { bubbles: true }));
		};
		const pick = (text) => {
			const el = [...card.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
			el?.click();
			return Boolean(el);
		};
		const picked = pick("自定义…");
		await wait(900);

		/* 两个色块按出现顺序：先底色后字色，和界面上从上到下一致。 */
		const fields = () => [...card.querySelectorAll('input[aria-label*="底色"], input[aria-label*="字色"]')];
		const bgField = () => fields()[0];
		const fgField = () => fields()[1];
		/* 预览是那枚套着 prose-dw 的盒子——量的是它画出来的颜色，不是设置里存的值。 */
		const specimen = () => {
			const box = card.querySelector(".prose-dw code");
			return box ? getComputedStyle(box).color : "无";
		};

		/*
		 * 先把这一对摆成「字色还是自动的」那个状态。
		 *
		 * seed 里给的是 #FFE8CC 配 #B34700——那是一对手挑的颜色，界面据此判定字色被人动过，于是
		 * 改底色时不去碰它。那是对的行为（下面第三条就在量它），但要测「自动跟随」就得先有一个自动
		 * 的起点：#392105 正是 #FFE8CC 派生出来的那个值。
		 *
		 * 判定写在界面里而不是存一个「是否自动」的字段，所以这里也只能用同一种办法摆出这个状态：
		 * 把字色设回派生值。这一段本身就是那条判定的一次验证。
		 */
		type(bgField(), "#FFE8CC");
		await wait(900);
		type(fgField(), "#392105");
		await wait(900);

		/*
		 * 问设置，不问那个输入框。
		 *
		 * 输入框里的字是 ColorField 自己的草稿，它要等设置存完、广播回来、组件重渲染才会追上——
		 * 探针等 1100ms 读它，读到的是上一个值，而同一时刻预览已经是新颜色了。那不是 bug，是中间态；
		 * 拿中间态当断言只会得到一条时快时慢的红线。存下来的那个值和画出来的那个颜色才是结论。
		 *
		 * （这段注释里一个反引号都不能有：整个函数体是一条模板字符串，注释里的反引号会把它截断。）
		 */
		const savedFg = async () => (await window.lyra.settings.get()).appearance.inlineCodeLightFg ?? "无";

		const specimenBefore = specimen();

		// 底色调成深的：字色该自己翻到浅的那头。
		type(bgField(), "#1A1A1A");
		await wait(1300);
		const fgAfterDark = await savedFg();
		const specimenAfter = specimen();

		// 再调回浅的：字色该自己翻回深的那头。
		type(bgField(), "#FFF1E0");
		await wait(1300);
		const fgAfterLight = await savedFg();

		// 手动指定一个字色之后，底色再怎么动都不许碰它。
		type(fgField(), "#FF0000");
		await wait(1300);
		type(bgField(), "#101010");
		await wait(1300);
		const fgAfterManual = await savedFg();

		/*
		 * 预览得挨着控件，不是在卡片最底下。
		 *
		 * 量的是「它和描边那一行之间，隔着几个元素」——这是「紧贴」在 DOM 上唯一说得清的意思。
		 */
		const boxes = [...card.children];
		const specimenBox = card.querySelector(".prose-dw")?.closest("[class*='rounded-xl']");
		const borderRow = [...card.querySelectorAll("div")].find((d) => d.textContent?.trim().startsWith("描边"));
		const specimenIndex = boxes.findIndex((el) => el.contains(specimenBox));
		const borderIndex = boxes.findIndex((el) => el.contains(borderRow));
		return {
			picked,
			fgAfterDark,
			fgAfterLight,
			fgAfterManual,
			specimenBefore,
			specimenAfter,
			specimenNearControls: specimenIndex >= 0 && borderIndex >= 0 && specimenIndex - borderIndex === 1,
		};
	})()`);

	check("外观页上点得到「自定义…」", coupling.picked, coupling.picked ? "点了" : "没找到那一档");
	check(
		"底色调深，字色自己翻到浅的那头",
		coupling.fgAfterDark.toUpperCase() === "#EDEDED",
		`底色 #1A1A1A 时字色=${coupling.fgAfterDark}（黑底黑字正是这条要防的）`,
	);
	check(
		"底色调回浅的，字色自己翻回深的那头",
		coupling.fgAfterLight.toUpperCase() === "#392105",
		`底色 #FFF1E0 时字色=${coupling.fgAfterLight}，而且带着底色的暖色相`,
	);
	check(
		"手动指定过的字色，底色再动也不碰它",
		coupling.fgAfterManual.toUpperCase() === "#FF0000",
		`手填 #FF0000 再改底色，字色=${coupling.fgAfterManual}`,
	);
	check(
		"预览跟着一起动，不是一张静态图",
		coupling.specimenBefore !== coupling.specimenAfter,
		`改底色前 ${coupling.specimenBefore}，改完 ${coupling.specimenAfter}`,
	);
	check(
		"预览紧挨着描边那一行，不在卡片最底下",
		coupling.specimenNearControls,
		coupling.specimenNearControls ? "就在下一格" : "隔开了——颜色得看着改",
	);

	/* ---- 四、设置页上那个真的 `font-semibold` 标题，复核一遍字重 ---- */
	await openSettings("外观");
	const onSettings = await app.evaluate<Paint>(readPaint);
	check(
		"设置页上真有的那个 semibold 标题，也是基准加两档",
		onSettings.realHeadingWeight === String(WEIGHT + 200),
		`页面上的标题=${onSettings.realHeadingWeight}，当场挂类的=${onSettings.headingWeight}，期望 ${WEIGHT + 200}`,
	);

	/*
	 * 整页那颗按钮上写的是「恢复」，不是「恢复默认」——写「恢复默认」的是代码外观那一节的。
	 *
	 * 探针第一版按「恢复默认」找，于是两颗都指向了同一颗，点完主题当然没动（代码外观那颗本来
	 * 就不该动主题），报出来是一条假红。所以这里按那一行的标题定位，再在同一行里取按钮：行的标题
	 * 是「恢复默认」，按钮上是「恢复」，靠任何一个单独的文字都会点错。
	 */
	const restored = await app.evaluate<{ pressed: string[]; ok: boolean; clicked: string }>(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		/*
		 * 按那三张卡片所在的栅格定位，不按文字。
		 *
		 * 「系统」这个词在这一页上出现两次：主题三选一，和「减少动态效果」那排分段控件——后者默认
		 * 也是「系统」且默认选中。只按文字数的话，主题没回到系统、而动效那排选中了系统，这条照样
		 * 会绿。问的是「主题那三张卡片里哪张亮着」，就得先框住那三张。
		 */
		const grid = document.querySelector(".grid-cols-3");
		const themeCards = grid ? [...grid.querySelectorAll("button[aria-pressed]")] : [];
		// 整页那颗在「偏好设置」卡片里，和主题卡片不在同一张卡上。
		const row = [...document.querySelectorAll("div")].find(
			(d) => d.className.includes("px-4") && d.innerText?.trim().startsWith("恢复默认"),
		);
		const button = row ? [...row.querySelectorAll("button")].pop() : null;
		const clicked = button ? button.innerText.trim() : "没找到";
		button?.click();
		await wait(1600);
		const pressed = themeCards
			.filter((b) => b.getAttribute("aria-pressed") === "true")
			.map((b) => b.innerText.trim());
		return { pressed, ok: pressed.includes("系统"), clicked };
	})()`);
	check(
		"整页恢复默认之后，主题回到「系统」",
		restored.ok,
		`按的是「${restored.clicked}」，主题三张卡片里选中的是 ${JSON.stringify(restored.pressed)}`,
	);

	/* ---- 六、代码托管页不再常驻那段令牌说明 ---- */
	await openSettings("代码托管");
	const forge = await app.evaluate<{ hasNote: boolean; text: string }>(`(() => {
		const text = document.body.innerText;
		return { hasNote: text.includes("令牌加密后存在"), text: text.slice(0, 160) };
	})()`);
	check(
		"账号列表页上不再常驻那段令牌说明",
		!forge.hasNote,
		forge.hasNote ? "还在页面上" : "不在了（它跟着令牌输入框走了）",
	);

	process.stdout.write(failures === 0 ? "\n全部通过\n" : `\n${failures} 条不通过\n`);
} finally {
	await app.stop();
}

process.exit(failures === 0 ? 0 : 1);
