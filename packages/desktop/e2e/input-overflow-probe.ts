/* oxlint-disable no-console -- probe CLI that prints what the real window drew */
/**
 * 输入框装不下字的时候，长什么样。
 *
 * 量的是「画出来的结果」而不是「写进去的值」：`--ly-field-fade-top` 写成 24px 不等于屏幕上就有
 * 渐隐——遮罩可能被另一条 `mask-image` 整个替换掉，变量也可能因为不可继承而根本没传到画字的那
 * 一层。所以这里读的是 `getComputedStyle(...).maskImage`：它是 `calc()` 求值**之后**的字符串，
 * 里面的长度就是遮罩真正用的那几个数。一个都不为零，才说明这一层确实在化开。
 *
 * 截图另存，因为遮罩这件事只能看。
 *
 * 用法：先 `pnpm --filter @lyra/desktop build`，再
 * `node --experimental-strip-types packages/desktop/e2e/input-overflow-probe.ts [标签] [输出目录]`
 */

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { startApp, type RunningApp } from "./app.ts";
import { seedFromReal } from "./session-switch-perf.ts";

const LABEL = process.argv[2] ?? "before";
const OUT_DIR = process.argv[3] ?? join(homedir(), "Desktop", "Lyra输入框样式测试");
const PORT = 9787;

/** 够长到必然溢出，又每行一样宽，量右端才有意义。 */
const FILLER = Array.from({ length: 24 }, () => "123123123123123123123123123123123123123123123").join("\n");

let app: RunningApp;
const checks: { ok: boolean; what: string; saw: unknown }[] = [];
const check = (what: string, ok: boolean, saw: unknown) => {
	checks.push({ ok, what, saw });
	console.log(`   ${ok ? "✅" : "❌"} ${what}  ——  ${JSON.stringify(saw)}`);
};

const evaluate = <T>(expression: string): Promise<T> => app.evaluate<T>(expression);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(expression: string, ms = 30000): Promise<void> {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await evaluate<boolean>(`Boolean(${expression})`)) return;
		await pause(250);
	}
	throw new Error(`等不到：${expression}`);
}

/** 真鼠标。`.click()` 打不开会话行，也打不开工具条上的好几颗。 */
async function clickAt(selector: string): Promise<boolean> {
	const at = await evaluate<{ x: number; y: number } | null>(`(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		if (!el) return null;
		const r = el.getBoundingClientRect();
		if (r.width < 1 || r.height < 1) return null;
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
	if (!at) return false;
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"] as const) {
		await app.send("Input.dispatchMouseEvent", {
			type,
			...at,
			...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }),
		});
	}
	return true;
}

/** 受控组件要走原型上的 setter，直接改 value 的话 React 收不到。 */
function typeInto(selector: string, text: string): string {
	return `(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		if (!el) return false;
		const tag = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement : window.HTMLInputElement;
		const setter = Object.getOwnPropertyDescriptor(tag.prototype, "value").set;
		setter.call(el, ${JSON.stringify(text)});
		el.dispatchEvent(new Event("input", { bubbles: true }));
		return true;
	})()`;
}

interface Reading {
	pad: string;
	scrollable: number;
	at: number;
	/** 两头各化开多深。0 表示这一头没有东西被藏起来，本来就不该化。 */
	fadeTop: number;
	fadeBottom: number;
	/**
	 * 遮罩里出现过的最长的那一段。
	 *
	 * 这是「变量真的进了遮罩」的凭证：`maskImage` 的 computed 值是 `calc()` 求值**之后**的，
	 * 上面那两个变量若因为不可继承、或者被另一条 `mask-image` 整条换掉而没生效，这里读到的要
	 * 么是 0，要么干脆是 `none`——两个变量写得再对也救不回来。
	 */
	maskMax: number;
	masked: boolean;
	hasThumb: boolean;
	thumbGap: number | null;
	mirror: { fadeTop: number; fadeBottom: number; maskMax: number; masked: boolean } | null;
}

/**
 * 滚到某个位置，然后读遮罩。
 *
 * `at` 是 0（顶）到 1（底）。顶和底各读一次是有意的：顶上不该有上渐隐（上面没东西了），底下不
 * 该有下渐隐——一个两头永远都化开的框，是把「还有更多」这句话说成了背景噪音。
 */
function inspect(selector: string, at: number): string {
	return `(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		if (!el) return null;
		const hidden = el.scrollHeight - el.clientHeight;
		el.scrollTop = hidden * ${at};
		el.dispatchEvent(new Event("scroll"));
		const read = (node) => {
			const s = getComputedStyle(node);
			const mask = s.maskImage && s.maskImage !== "none" ? s.maskImage : (s.webkitMaskImage || "none");
			const lengths = mask === "none" ? [] : [...mask.matchAll(/([0-9.]+)px/g)].map((m) => parseFloat(m[1]));
			return {
				fadeTop: parseFloat(s.getPropertyValue("--ly-field-fade-top")) || 0,
				fadeBottom: parseFloat(s.getPropertyValue("--ly-field-fade-bottom")) || 0,
				maskMax: lengths.length ? Math.max(...lengths) : 0,
				masked: mask !== "none"
			};
		};
		const cs = getComputedStyle(el);
		const host = el.closest(".ly-scroll-host");
		const thumb = host ? host.querySelector(".ly-thumb") : null;
		const mirrorLayer = host ? host.querySelector("[data-command-mirror]") : null;
		const mirror = mirrorLayer ? mirrorLayer.closest(".ly-field-fade") : null;
		const box = el.getBoundingClientRect();
		return {
			pad: cs.padding,
			scrollable: Math.round(hidden),
			at: Math.round(el.scrollTop),
			...read(el),
			hasThumb: Boolean(thumb),
			thumbGap: thumb ? Math.round(thumb.getBoundingClientRect().left - (box.right - parseFloat(cs.paddingRight))) : null,
			mirror: mirror ? read(mirror) : null
		};
	})()`;
}

async function shot(name: string): Promise<void> {
	const picture = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await mkdir(OUT_DIR, { recursive: true });
	await writeFile(join(OUT_DIR, `${LABEL}-${name}.png`), Buffer.from(picture.data, "base64"));
	console.log(`   📷 ${LABEL}-${name}.png`);
}

/**
 * 只拍那个框，放大两倍。
 *
 * 渐隐是几十个像素里的一段 alpha 渐变，整窗截图缩到文档里之后，它和「字本来就淡」分不出来。
 * 想看清楚只能把那块切出来单看。
 */
async function closeUp(selector: string, name: string, pad = 16): Promise<void> {
	const box = await evaluate<{ x: number; y: number; width: number; height: number } | null>(`(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		if (!el) return null;
		const r = (el.closest(".ly-composer, .ly-textarea-shell, [data-ly-commit-field]") ?? el).getBoundingClientRect();
		return { x: r.left, y: r.top, width: r.width, height: r.height };
	})()`);
	if (!box) return;
	const picture = await app.send<{ data: string }>("Page.captureScreenshot", {
		format: "png",
		captureBeyondViewport: false,
		clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: box.height + pad * 2, scale: 2 },
	});
	await mkdir(OUT_DIR, { recursive: true });
	await writeFile(join(OUT_DIR, `${LABEL}-${name}.png`), Buffer.from(picture.data, "base64"));
	console.log(`   🔍 ${LABEL}-${name}.png`);
}

/** 滑块只在悬停时现形，所以拍之前把指针放进框里。 */
async function hover(selector: string): Promise<void> {
	const at = await evaluate<{ x: number; y: number } | null>(`(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { x: Math.round(r.right - 20), y: Math.round(r.top + r.height / 2) };
	})()`);
	if (at) await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
	await pause(400);
}

async function main(): Promise<void> {
	app = await startApp({ port: PORT, seed: seedFromReal });
	try {
		await evaluate("document.fonts.ready");
		await until(`document.querySelectorAll('[data-ly-row]').length > 0`, 40000);
		await clickAt("[data-ly-row]");
		await until(`document.querySelector(".ly-composer textarea")`, 20000);
		await pause(1200);

		const MAIN = "[data-dock-pane='conversation'] textarea.ly-composer-text";
		console.log("\n【一】主输入框，塞到溢出");
		await evaluate(typeInto(MAIN, FILLER));
		await pause(900);

		const middle = await evaluate<Reading | null>(inspect(MAIN, 0.5));
		check(
			"滚到中间：两头都化开，而且那个深度确实进了遮罩",
			(middle?.fadeTop ?? 0) > 4 &&
				(middle?.fadeBottom ?? 0) > 4 &&
				middle?.masked === true &&
				Math.abs((middle?.maskMax ?? 0) - Math.max(middle?.fadeTop ?? 0, middle?.fadeBottom ?? 0)) < 1,
			middle,
		);
		check("滚到中间：滑块在，且不压住字", middle?.hasThumb === true && (middle?.thumbGap ?? -1) >= 4, {
			hasThumb: middle?.hasThumb,
			thumbGap: middle?.thumbGap,
		});
		await hover(MAIN);
		await shot("01-主输入框-滚到中间");
		await closeUp(MAIN, "01特写-主输入框-滚到中间");

		const top = await evaluate<Reading | null>(inspect(MAIN, 0));
		check("回到顶端：上面不再化开，下面还化开", top?.fadeTop === 0 && (top?.fadeBottom ?? 0) > 4, {
			fadeTop: top?.fadeTop,
			fadeBottom: top?.fadeBottom,
		});
		await pause(300);
		await shot("02-主输入框-回到顶端");

		const bottom = await evaluate<Reading | null>(inspect(MAIN, 1));
		check("到了底：下面不再化开，上面还化开", bottom?.fadeBottom === 0 && (bottom?.fadeTop ?? 0) > 4, {
			fadeTop: bottom?.fadeTop,
			fadeBottom: bottom?.fadeBottom,
		});
		await pause(300);
		await shot("03-主输入框-到了底");

		/*
		 * 带附件标记的那一版：字有两层，镜像层必须和 textarea 化开得一模一样。
		 * 一个 `/` 就够让镜像层挂上去——命令是三种装饰里最容易造的一种。
		 */
		console.log("\n【二】铺了镜像层的时候，两层化开得一样吗");
		await evaluate(typeInto(MAIN, `/compact ${FILLER}`));
		await pause(900);
		const mirrored = await evaluate<Reading | null>(inspect(MAIN, 0.5));
		check(
			"镜像层挂上了，而且和 textarea 化开得一模一样",
			Boolean(mirrored?.mirror) &&
				mirrored?.mirror?.masked === true &&
				mirrored?.mirror?.fadeTop === mirrored?.fadeTop &&
				mirrored?.mirror?.fadeBottom === mirrored?.fadeBottom &&
				(mirrored?.mirror?.maskMax ?? 0) > 4,
			{ field: { top: mirrored?.fadeTop, bottom: mirrored?.fadeBottom, maskMax: mirrored?.maskMax }, mirror: mirrored?.mirror },
		);
		await hover(MAIN);
		await shot("04-主输入框-带命令装饰");
		await evaluate(typeInto(MAIN, ""));

		console.log("\n【三】提交弹窗，塞到溢出");
		const gitPanel = await evaluate<boolean>(`(() => {
			const b = [...document.querySelectorAll('button')].find((el) => /^Git\\s/.test(el.getAttribute('aria-label') || ''));
			if (!b) return false;
			b.click();
			return true;
		})()`);
		check("打开 Git 面板", gitPanel, gitPanel);
		await until(`document.querySelector('[data-dock-pane="review"]')`, 20000);
		await pause(2500);

		/*
		 * 认 span 里的那颗按钮，不认带 `data-ly-sync` 的外层。
		 *
		 * 那一整行也带 `data-ly-sync`（写的是 remoteState），碰巧同名时 `querySelector` 会先拿到
		 * 它——点一个 flex 容器的正中，落在分支名上，什么也不会发生。
		 */
		const opened = await clickAt('[data-ly-sync="push"] button, button[data-ly-sync="push"]');
		check("点开提交入口", opened, opened);
		await until(`document.querySelector('[data-ly-commit-message]')`, 15000).catch(() => {
			check("提交弹窗出现", false, "等不到 [data-ly-commit-message]");
		});
		await pause(900);

		if (await evaluate<boolean>(`Boolean(document.querySelector('[data-ly-commit-message]'))`)) {
			await evaluate(typeInto("[data-ly-commit-message]", FILLER));
			await pause(900);
			const commit = await evaluate<Reading | null>(inspect("[data-ly-commit-message]", 0.5));
			check(
				"提交信息框：两头化开、有滑块",
				(commit?.fadeTop ?? 0) > 4 && (commit?.fadeBottom ?? 0) > 4 && commit?.masked === true && commit?.hasThumb === true,
				commit,
			);
			await hover("[data-ly-commit-message]");
			await shot("05-提交弹窗-滚到中间");
			await closeUp("[data-ly-commit-message]", "05特写-提交弹窗-滚到中间");
			await evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
			await pause(600);
		}

		/*
		 * 设置页里那个自定义指令框，是九个散装 textarea 里改动最大的一个：从
		 * `rounded-xl border bg-card-hover/20 p-3` 换成了 `TextArea`。验的是三件事——新外壳画出来
		 * 了、内衬是那两个共享变量给的、滚起来也有滑块和渐隐。
		 */
		console.log("\n【四】设置页里的多行框，换成统一那一个之后");
		const settings = await evaluate<string>(`(async () => {
			const wait = (ms) => new Promise((r) => setTimeout(r, ms));
			const inSettings = () => [...document.querySelectorAll("button")].some((b) => (b.textContent || "").includes("返回工作区"));
			if (!inSettings()) {
				document.querySelector(".ly-sidebar-foot button")?.click();
				await wait(1400);
			}
			if (!inSettings()) return "设置没打开";
			const nav = [...document.querySelectorAll("nav button")].find((b) => (b.textContent || "").trim() === "个性化");
			if (!nav) return "找不到个性化";
			nav.click();
			await wait(1600);
			return "已打开";
		})()`);
		check("打开设置 → 个性化", settings === "已打开", settings);

		const CUSTOM = ".ly-textarea-shell textarea.ly-textarea";
		if (await evaluate<boolean>(`Boolean(document.querySelector(${JSON.stringify(CUSTOM)}))`)) {
			const shell = await evaluate<{ radius: string; border: string; hasShell: boolean }>(`(() => {
				const el = document.querySelector(${JSON.stringify(CUSTOM)});
				const s = getComputedStyle(el.closest(".ly-textarea-shell"));
				return { radius: s.borderRadius, border: s.borderTopWidth, hasShell: true };
			})()`);
			check("外壳画出来了：一圈描边 + 14px 圆角", shell.hasShell && shell.radius === "14px" && shell.border === "1px", shell);

			await evaluate(typeInto(CUSTOM, FILLER));
			await pause(900);
			const custom = await evaluate<Reading | null>(inspect(CUSTOM, 0.5));
			check(
				"内衬取的是主输入框那两个变量，滚起来也有滑块和渐隐",
				custom?.pad === "12px 16px" && (custom?.fadeTop ?? 0) > 4 && (custom?.fadeBottom ?? 0) > 4 && custom?.hasThumb === true,
				custom,
			);
			await hover(CUSTOM);
			await shot("06-设置页-自定义指令");
			await closeUp(CUSTOM, "06特写-设置页-自定义指令");
		} else {
			check("设置页里找得到统一后的多行框", false, "没有 .ly-textarea-shell textarea.ly-textarea");
		}

		/*
		 * 规则草稿那个框：底是代码主题的，字色必须跟着一起走。
		 *
		 * 到不了那张卡片（要一条真的提过规则建议的会话），但要验的事只跟样式表有关——现造一对
		 * 节点挂进真页面，让浏览器自己算。这比断言 CSS 文本强一层：它回答的是「算出来是多少」。
		 */
		console.log("\n【五】代码底色的那个框，字色跟着底走吗");
		const inked = await evaluate<{ shell: string; field: string; card: string }>(`(() => {
			const make = (cls) => {
				const shell = document.createElement("div");
				shell.className = cls;
				const field = document.createElement("textarea");
				field.className = "ly-textarea";
				shell.append(field);
				document.body.append(shell);
				const out = { shell: getComputedStyle(shell).color, field: getComputedStyle(field).color };
				shell.remove();
				return out;
			};
			const excerpt = make("ly-textarea-shell ly-rule-excerpt");
			const plain = make("ly-textarea-shell");
			return { shell: excerpt.shell, field: excerpt.field, card: plain.field };
		})()`);
		check(
			"外壳换了底色，里面那层的字色跟着换——不会出现深底配深字",
			inked.field === inked.shell,
			inked,
		);
	} catch (error) {
		check("探针跑完了", false, String(error));
		throw error;
	} finally {
		await mkdir(OUT_DIR, { recursive: true });
		const pass = checks.filter((c) => c.ok).length;
		await writeFile(
			join(OUT_DIR, `${LABEL}-量到的值_${pass}of${checks.length}.json`),
			JSON.stringify({ checks }, null, 2),
		);
		await app?.stop();
		console.log(`\n${pass}/${checks.length} 通过 → ${OUT_DIR}`);
		if (checks.some((c) => !c.ok)) process.exitCode = 1;
	}
}

await main();
