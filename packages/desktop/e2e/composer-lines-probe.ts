/**
 * 「输入框默认高度」这一行：拖起来跟不跟手，读数断不断行，预览像不像真的那个输入框。
 *
 * `node --experimental-strip-types e2e/composer-lines-probe.ts [dir]`
 *
 * 四件事，逐帧量而不是抽样量——中间那些没画出来的状态才是「卡」的本体：
 *
 *   - **跟手**。每一帧把滑条往前推一格，同一帧读回 DOM 里的 `value`。受控 input 的值要等设置
 *     存完盘再从 store 回来，中间 React 会按旧 props 把 DOM 复位一次，于是屏幕上是「拖一点、
 *     弹回去、再跳过来」。`lag` 数的就是这种回弹帧。
 *   - **冻结**。`applyAppearance` 每次都挂 `data-theme-switching`，那条 CSS 把全应用的
 *     transition 全部 `none !important`。拖动时它反复挂上又摘掉，所有过渡跟着通断。
 *   - **过渡**。预览高度取过多少个不同的值：只有台阶数那么多，就是在跳；多出中间值，才是在动。
 *   - **长相**。读数有没有折行；预览有没有真输入框那两层阴影；它底下的颜色跟真框脚下的一样不一样。
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const dir = process.argv[2] ?? "/tmp/lyra-composer-lines";
const project = join(dir, "proj");

async function seed(home: string): Promise<void> {
	await mkdir(project, { recursive: true });
	await writeFile(join(project, "readme.md"), "# 项目\n");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1400, height: 950, x: 0, y: 0 }));
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
			appearance: { theme: "dark", composerLines: 1 },
			personalization: { customInstructions: "", enableMemory: true, sidebarMotto: "" },
		}),
	);
}

const app = await startApp({ port: 9716, seed });
const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));

const shot = async (name: string) => {
	const result = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(dir, `${name}.png`), Buffer.from(result.data, "base64"));
};

/*
 * 「在不在设置页」要问看得见的那个按钮。
 *
 * 离开设置页之后它并没有被卸下，只是不再画出来——于是「页面上有没有『返回工作区』」这个问法
 * 在工作区里也成立。第一次跑对了，回过一趟工作区再问就答错：这里报「已打开」，而屏幕上还是
 * 工作区，后面量到的全是一个隐藏节点的尺寸，高度清一色是 0。认 `offsetParent`。
 */
const openSettings = (page: string) =>
	app.evaluate<string>(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		const shown = (el) => Boolean(el && el.offsetParent && el.getBoundingClientRect().height > 0);
		const inSettings = () => [...document.querySelectorAll("button")].some((b) => (b.textContent || "").includes("返回工作区") && shown(b));
		if (!inSettings()) {
			document.querySelector(".ly-sidebar-foot button")?.click();
			await wait(1200);
		}
		if (!inSettings()) return "设置没打开";
		const nav = [...document.querySelectorAll("nav button")].find((b) => (b.textContent || "").trim() === ${JSON.stringify(page)} && shown(b));
		if (!nav) return "找不到入口：" + ${JSON.stringify(page)};
		nav.click();
		await wait(1400);
		return "已打开";
	})()`);

/** 把「输入框默认高度」交给后面每一段脚本；只认画出来的那一个，理由同 `openSettings`。 */
const REACH = `
	const range = [...document.querySelectorAll("input[type=range]")].find((r) => r.getAttribute("aria-label") === "输入框默认高度" && r.offsetParent);
	const row = range?.closest("[data-settings-row]")?.parentElement;
	const preview = row?.querySelector(".ly-composer-text");
`;

interface Frame {
	t: number;
	gap: number;
	want: number;
	dom: number;
	knob: number;
	h: number;
	frozen: boolean;
}

try {
	await mkdir(dir, { recursive: true });
	await settle(2600);
	process.stdout.write(`\n${await openSettings("外观")}\n`);
	await settle(900);

	await app.evaluate(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		${REACH}
		range?.closest("[data-settings-row]")?.scrollIntoView({ block: "center" });
		await wait(800);
		return true;
	})()`);

	/*
	 * 一帧推一格，1 → 10，然后再录 80 帧看它停在哪。
	 *
	 * 走原生 setter 加 input 事件，因为合成的鼠标事件不被信任，原生滑条根本不会改值。走的这条
	 * 路径和真手指拖动对 React 而言是同一条：onChange 拿到新值，DOM 的值随后由受控逻辑决定。
	 *
	 * **`change` 只在最后一格发一次**，因为真的拖动就是这样：途中一格一个 `input`，松手才有一个
	 * `change`。每帧都补一个 `change` 等于每帧都松一次手，量出来的是一个没人会做的动作——第一版
	 * 这么写，于是九十帧里十三帧超过 24ms，而那全是它自己叫出来的落盘。
	 */
	const run = await app.evaluate<{ ok: boolean; frames: Frame[] }>(`(async () => {
		${REACH}
		if (!range) return { ok: false, frames: [] };
		const knob = range.parentElement?.querySelector(".ly-knob");
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
		const frames = [];
		let want = Number(range.value);
		const t0 = performance.now();
		let last = t0;
		await new Promise((done) => {
			const step = () => {
				const now = performance.now();
				if (want < 10) {
					want += 1;
					setter.call(range, String(want));
					range.dispatchEvent(new Event("input", { bubbles: true }));
					/* 到头了，松手。 */
					if (want === 10) range.dispatchEvent(new Event("change", { bubbles: true }));
				}
				frames.push({
					t: Math.round(now - t0),
					gap: Math.round(now - last),
					want,
					dom: Number(range.value),
					knob: knob ? Math.round(knob.getBoundingClientRect().left) : -1,
					h: preview ? Math.round(preview.getBoundingClientRect().height) : -1,
					frozen: document.documentElement.hasAttribute("data-theme-switching"),
				});
				last = now;
				if (frames.length < 90) requestAnimationFrame(step);
				else done(null);
			};
			requestAnimationFrame(step);
		});
		return { ok: true, frames };
	})()`);

	if (!run.ok) throw new Error("没找到「输入框默认高度」的滑条");

	const frames = run.frames;
	const dragging = frames.filter((f) => f.want < 10 || f.t < 200);
	const lag = dragging.filter((f) => f.dom !== f.want).length;
	const frozen = frames.filter((f) => f.frozen).length;
	const long = frames.filter((f, i) => i > 0 && f.gap > 24).length;
	const heights = [...new Set(frames.map((f) => f.h))].sort((a, b) => a - b);
	const settled = frames.at(-1)!;

	process.stdout.write(`\n拖动：1 → 10，共 ${frames.length} 帧\n`);
	process.stdout.write(`  值回弹的帧      ${lag} / ${dragging.length}\n`);
	process.stdout.write(`  过渡被冻结的帧  ${frozen} / ${frames.length}\n`);
	process.stdout.write(`  超过 24ms 的帧  ${long}\n`);
	process.stdout.write(`  预览高度取值    ${heights.length} 个：${heights.join(" ")}\n`);
	process.stdout.write(`  停在            value=${settled.dom} 高 ${settled.h}px\n`);
	process.stdout.write(`  前 14 帧        ${frames.slice(0, 14).map((f) => `${f.want}/${f.dom}${f.frozen ? "*" : ""}`).join(" ")}\n`);

	await settle(1200);

	/*
	 * 一次设定，不是拖。
	 *
	 * `settings-align-probe` 就是这么设的，它还要接着回工作区确认真输入框也变了——也就是确认这
	 * 个值**存下去了**。拖动路径归拖动路径，这条单独验：改成松手才落盘之后，一次性的设值也必须
	 * 照样落到磁盘上。
	 */
	const once = await app.evaluate<{ before: number; after: number; saved: number }>(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		${REACH}
		const height = () => (preview ? Math.round(preview.getBoundingClientRect().height) : -1);
		const before = height();
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
		setter.call(range, "5");
		range.dispatchEvent(new Event("input", { bubbles: true }));
		range.dispatchEvent(new Event("change", { bubbles: true }));
		await wait(1200);
		const readout = range.closest(".flex")?.querySelector("span");
		return { before, after: height(), saved: Number.parseInt((readout?.textContent || "").trim(), 10) };
	})()`);
	process.stdout.write(`\n一次设到 5 行\n  预览 ${once.before}px → ${once.after}px，读数 ${once.saved} 行\n`);

	/* ── 长相：读数折不折行，预览像不像真框。深浅两套各量一遍。 ── */
	interface Look {
		label: string;
		labelH: number;
		lineH: number;
		wrapped: boolean;
		shadow: string;
		bg: string;
		behind: string;
		border: string;
		transition: string;
	}
	interface Real {
		ok: boolean;
		shadow: string;
		behind: string;
		border: string;
		/** 真输入框此刻有几行高——设置有没有真的存下去，只有它说了算。 */
		lines: number;
	}

	/** 一个元素脚下最近的那层实色——真框自己是透明的，它的「底色」在祖先里。 */
	const PAINT = `
		const paint = (el, fromSelf) => {
			let node = fromSelf ? el : el.parentElement;
			while (node) {
				const c = getComputedStyle(node).backgroundColor;
				if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") return c;
				node = node.parentElement;
			}
			return "(none)";
		};
	`;

	const lookAtPreview = () =>
		app.evaluate<Look>(`(() => {
			${REACH}
			${PAINT}
			const readout = range?.closest(".flex")?.querySelector("span");
			const style = readout ? getComputedStyle(readout) : null;
			const box = preview?.parentElement;
			const boxStyle = box ? getComputedStyle(box) : null;
			return {
				label: (readout?.textContent || "").trim(),
				labelH: readout ? Math.round(readout.getBoundingClientRect().height) : -1,
				lineH: style ? Math.round(Number.parseFloat(style.fontSize) * 1.5) : -1,
				wrapped: readout ? readout.getBoundingClientRect().height > Number.parseFloat(style.fontSize) * 1.9 : false,
				shadow: boxStyle ? boxStyle.boxShadow : "(no box)",
				bg: boxStyle ? boxStyle.backgroundColor : "(no box)",
				behind: box ? paint(box, true) : "(no box)",
				border: boxStyle ? boxStyle.borderColor : "(no box)",
				transition: preview ? getComputedStyle(preview).transitionProperty : "(no preview)",
			};
		})()`);

	/**
	 * 回工作区量真框。
	 *
	 * 顺带量它有几行高——那是「这个值真的存下去了」唯一的证据。设置页里的预览由草稿驱动，滑到
	 * 哪就画到哪，存没存盘它一概不知道；真输入框的高度走的是 `--ly-composer-lines`，只有写进
	 * 设置才会变。少了这一问，一个「预览会动、磁盘不动」的改法可以一路绿着交出去。
	 */
	const lookAtReal = () =>
		app.evaluate<Real>(`(async () => {
			const wait = (ms) => new Promise((r) => setTimeout(r, ms));
			${PAINT}
			[...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("返回工作区"))?.click();
			await wait(1800);
			/* 从 textarea 出发，不然会摸到设置页里那个同样叫 ly-composer 的预览。 */
			const field = document.querySelector("textarea.ly-composer-text");
			const box = field?.closest(".ly-composer");
			if (!box) return { ok: false, shadow: "", behind: "", border: "", lines: -1 };
			const line = Number.parseFloat(getComputedStyle(field).fontSize) * 1.625;
			const s = getComputedStyle(box);
			return {
				ok: true,
				shadow: s.boxShadow,
				behind: paint(box, false),
				border: s.borderColor,
				lines: Math.round(((field.getBoundingClientRect().height - 24) / line) * 10) / 10,
			};
		})()`);

	const report = (theme: string, look: Look, real: Real, wantLines: number) => {
		const same = (a: string, b: string) => (a === b ? "＝" : "≠");
		process.stdout.write(`\n${theme}\n`);
		process.stdout.write(`  读数            ${JSON.stringify(look.label)} 高 ${look.labelH}px（单行约 ${look.lineH}px）${look.wrapped ? " ← 折行了" : ""}\n`);
		process.stdout.write(`  预览的过渡      ${look.transition}\n`);
		process.stdout.write(`  真框存下来几行  ${real.lines} 行${Math.abs(real.lines - wantLines) < 0.3 ? "" : ` ← 该是 ${wantLines} 行，没存进去`}\n`);
		process.stdout.write(`  阴影  预览 ${look.shadow}\n`);
		process.stdout.write(`     ${same(look.shadow, real.shadow)}  真框 ${real.shadow}\n`);
		process.stdout.write(`  底色  预览 ${look.behind}\n`);
		process.stdout.write(`     ${same(look.behind, real.behind)}  真框 ${real.behind}\n`);
		process.stdout.write(`  边框  预览 ${look.border}\n`);
		process.stdout.write(`     ${same(look.border, real.border)}  真框 ${real.border}\n`);
	};

	const darkLook = await lookAtPreview();
	await shot("appearance-dark");
	const darkReal = await lookAtReal();
	await shot("composer-dark");
	report("深色", darkLook, darkReal, 5);

	/*
	 * ── 换成浅色，同样两处再量一遍 ──
	 *
	 * 顺带守住反面：`beginRepaint` 现在只在颜色变了的时候按住过渡，那就得确认**颜色真的变了的
	 * 时候它还按**。这一下换的正是主题——`data-theme-switching` 必须挂上又摘掉。少了这一问，
	 * 「拖行数时不再冻结」这条好消息可以由「它从此再也不冻结」冒充，而后者会把切深浅色重新变
	 * 回两拨颜色分头到达的样子。
	 */
	process.stdout.write(`\n${await openSettings("外观")}`);
	const themeSwitch = await app.evaluate<{ frozen: boolean }>(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		let frozen = false;
		const obs = new MutationObserver(() => { frozen = true; });
		obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme-switching"] });
		const light = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "浅色");
		light?.click();
		await wait(1400);
		obs.disconnect();
		${REACH}
		range?.closest("[data-settings-row]")?.scrollIntoView({ block: "center" });
		await wait(800);
		return { frozen };
	})()`);
	process.stdout.write(`\n切主题时仍按住过渡  ${themeSwitch.frozen ? "是" : "否 ← 切深浅色会重新变成两拨颜色分头到达"}\n`);

	const lightLook = await lookAtPreview();
	await shot("appearance-light");
	const lightReal = await lookAtReal();
	await shot("composer-light");
	report("浅色", lightLook, lightReal, 5);
} finally {
	await app.stop();
}
