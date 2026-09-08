/**
 * 切到英文之后，窗口里还剩多少中文。
 *
 * `node --experimental-strip-types e2e/language-switch-probe.ts [dir]`
 *
 * 这条探针存在的理由，是 i18n 有两条取词的路：组件里的 `useI18n().t`，和模块里的 `translate()`。
 * 前者订阅 context，语言一变必然重画；后者不订阅——它读的是 `activeLocale` 那个模块级变量，只有
 * 在组件因为别的原因重画时才会重新取一次。清理硬编码时用了大量 `translate()`（面板名、侧边栏
 * 分组、气泡文案本来就是模块级的表，别无选择），所以「切了语言但那一处没跟着变」是这套做法唯一
 * 可能骗人的地方，而单测里看不见：`translate` 在测试环境永远返回简体中文，怎么写都是绿的。
 *
 * 量法不是挑几个点，而是把整扇窗都扫一遍：所有画出来的文字、所有 `aria-label`、所有
 * `data-ly-tip`，中文态记一份，切到英文再记一份，然后数英文态里还剩几处中文。逐个面板打开着扫，
 * 因为没挂上的组件不会有 DOM，也就无从判断。
 *
 * 会漏掉的东西写在这里，免得把这条探针的绿当成全窗口的保证：没画出来的路径（错误提示、确认框、
 * 空状态）扫不到，用户自己写的内容（会话标题、文件名、模型名）本来就该是中文而不该被算成漏网。
 * 后者靠白名单排掉，前者只能靠别的手段。
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";

const dir = process.argv[2] ?? "/tmp/lyra-language-switch";
await mkdir(dir, { recursive: true });

const app = await startApp({ port: 9743, seed: seedInteractions });
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const shot = async (name: string) => {
	const result = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(dir, `${name}.png`), Buffer.from(result.data, "base64"));
};

/**
 * 每一处能读到的字，连同它是从哪儿来的。
 *
 * `where` 是给人看的定位串——标签名加上前两个 class，足够在一屏输出里找回源码，又不会长到刷屏。
 */
const SCRAPE = `(() => {
	const out = [];
	const where = (el) => {
		const cls = (el.className && typeof el.className === "string" ? el.className : "").split(/\\s+/).filter(Boolean).slice(0, 2).join(".");
		return el.tagName.toLowerCase() + (cls ? "." + cls : "") + (el.dataset && el.dataset.lyRow ? "[row]" : "");
	};
	for (const el of document.querySelectorAll("*")) {
		if (el.closest("script, style")) continue;
		const label = el.getAttribute("aria-label");
		if (label) out.push({ kind: "aria", where: where(el), text: label });
		const tip = el.getAttribute("data-ly-tip");
		if (tip) out.push({ kind: "tip", where: where(el), text: tip });
		const title = el.getAttribute("title");
		if (title) out.push({ kind: "title", where: where(el), text: title });
		if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
			const ph = el.getAttribute("placeholder");
			if (ph) out.push({ kind: "placeholder", where: where(el), text: ph });
		}
		// 只取直接文本节点，否则每一层祖先都会把同一句话再报一遍。
		for (const node of el.childNodes) {
			if (node.nodeType !== 3) continue;
			const text = (node.textContent ?? "").trim();
			if (text) out.push({ kind: "text", where: where(el), text });
		}
	}
	return out;
})()`;

/**
 * 本来就该是中文的东西。
 *
 * 会话标题、项目名、文件名是用户自己写下的；fixture 里的对话内容同理。把它们算成漏网，这条探针
 * 永远红，而红得没有意义。
 */
const OWN_CONTENT = [
	/^lyra$/i,
	/^e2e/,
	/测试/,
	/^你好/,
	/^第 \d+/,
	/交互验证/,
	// 语法高亮的代码样例：它的中文是被上色的对象，不是说给人听的话。见 check-i18n 的豁免名单。
	/把名字招呼一下/,
	/function greet/,
];

interface Sample {
	kind: string;
	where: string;
	text: string;
}

const scrape = () => app.evaluate<Sample[]>(SCRAPE);
const setLocale = async (locale: string) => {
	await app.evaluate(
		`window.lyra.settings.get().then((s) => window.lyra.settings.save({ ...s, uiLocale: ${JSON.stringify(locale)} }))`,
	);
	await wait(1500);
};

const CJK = /[一-鿿]/;

/** 进设置页，并停在某一节上——设置是文案最密的地方，不扫等于没扫。 */
const openSettings = async (section: string): Promise<boolean> => {
	await app.evaluate(`(() => {
		const hit = document.querySelector(".ly-sidebar-foot button");
		hit?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		return Boolean(hit);
	})()`);
	await wait(900);
	const hit = await app.evaluate<boolean>(
		`(() => {
			const found = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === ${JSON.stringify(section)});
			found?.click();
			return Boolean(found);
		})()`,
	);
	await wait(900);
	return hit;
};

/** 一整轮：主界面加上几节设置，合成一份。位置带上来处，红了才知道去哪找。 */
const sweep = async (locale: string): Promise<Sample[]> => {
	const all: Sample[] = [];
	all.push(...(await scrape()).map((one) => ({ ...one, where: `chat/${one.where}` })));
	await shot(`${locale}-1-chat`);
	for (const [index, section] of SECTIONS[locale].entries()) {
		const opened = await openSettings(section);
		if (!opened) throw new Error(`点不开设置里的「${section}」——导航的名字对不上，扫的会是上一页`);
		all.push(...(await scrape()).map((one) => ({ ...one, where: `${section}/${one.where}` })));
		if (index === 0) await shot(`${locale}-2-settings`);
	}
	return all;
};

/**
 * 挑的是文案最多、且各自走不同取词路径的几节。
 *
 * 两套名字，因为导航自己也会跟着换语言——只写中文的话，第二轮点不中任何一节，于是三次都停在同
 * 一页上，扫出来的是同一批字重复三遍，看着像三十几处漏网，其实是一处。这个坑踩过一次。
 */
const SECTIONS: Record<string, string[]> = {
	"zh-CN": ["常规", "外观", "模型设置"],
	en: ["General", "Appearance", "Models"],
};

try {
	const before = await sweep("zh-CN");
	const zhCount = before.filter((one) => CJK.test(one.text)).length;
	process.stdout.write(`中文界面：${before.length} 处文字，其中 ${zhCount} 处含中文\n`);

	await setLocale("en");
	const after = await sweep("en");

	const leftovers = after.filter(
		(one) => CJK.test(one.text) && !OWN_CONTENT.some((pattern) => pattern.test(one.text)),
	);
	process.stdout.write(`英文界面：${after.length} 处文字，其中 ${leftovers.length} 处仍是中文\n\n`);

	if (leftovers.length > 0) {
		for (const one of leftovers.slice(0, 40)) {
			process.stdout.write(`  ✗ ${one.kind} @ ${one.where}\n      ${one.text.slice(0, 90)}\n`);
		}
		if (leftovers.length > 40) process.stdout.write(`  … 还有 ${leftovers.length - 40} 处\n`);
	}

	// 换回去：这个 profile 是临时的，但探针留下的截图是要给人看的，最后一张应该是原来的样子。
	await setLocale("zh-CN");
	process.exitCode = leftovers.length === 0 ? 0 : 1;
	process.stdout.write(leftovers.length === 0 ? "\n扫到的都跟着换了\n" : `\n${leftovers.length} 处没跟着换\n`);
} finally {
	await app.stop();
}
