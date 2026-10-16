/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * Settings → Subagents, the thinking-level dropdown of each sub-agent, in all seven interface languages.
 *
 * The dropdown used to list core's options as they came, and core draws its built-in levels in Chinese
 * (`TEXT` in `thinking-options.ts`): an English window read 「低/中/高」 with a Chinese line under each,
 * and "Default · 高" beside them. The composer's reasoning menu had long spoken the interface language;
 * both now go through the same localisation.
 *
 * The component test proves what the dropdown renders per language. This adds what it cannot: the real
 * window, and a page that is already open following a language switch made in Settings. A test that
 * mounts afresh for every language stays green with the subscription unplugged.
 *
 *   node --experimental-strip-types e2e/agents-thinking-language-demo.ts            # after: video + checks
 *   node --experimental-strip-types e2e/agents-thinking-language-demo.ts --before   # a build without the fix: three stills
 */

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";
import { MESSAGE_CATALOGS, type MessageKey, type ResolvedUiLocale } from "../src/i18n/messages/index.ts";

const PORT = 9447;
const OUT = join(homedir(), "Desktop", "Lyra智能体档位语言测试");
const STAMP = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);
const PHASE = process.argv.includes("--before") ? "before" : "after";

/** gpt-5.6-sol's built-in ladder, in order: `NONE_TO_MAX` in `thinking-options.ts`. */
const LADDER = ["off", "low", "medium", "high", "xhigh", "max"] as const;
/** Levels someone wrote on the model themselves. `low` is a standard id with a name of its own. */
const HOUSE = [
	{ id: "adaptive", label: "自适应", detail: "由服务商决定思考多久", isDefault: true },
	{ id: "low", label: "省着点", detail: "自己写的说明，不该被翻译" },
];
/** Walked through the language menu after English, ending where most people run it. */
const LOCALES: ResolvedUiLocale[] = ["ja", "fr", "ko", "ru", "zh-TW", "zh-CN"];

function say(locale: ResolvedUiLocale, key: string, vars: Record<string, string> = {}): string {
	const text = MESSAGE_CATALOGS[locale][key as MessageKey];
	if (typeof text !== "string") throw new Error(`${locale} has no plain message ${key}`);
	return Object.entries(vars).reduce((out, [name, value]) => out.replace(`{${name}}`, value), text);
}

const checks: { ok: boolean; what: string; saw: string }[] = [];
function check(what: string, ok: boolean, saw: string) {
	checks.push({ ok, what, saw });
	console.log(`   ${ok ? "✅" : "❌"} ${what}${ok ? "" : `  —— 看到的是：${saw}`}`);
}

const model = (modelId: string, extra: Record<string, unknown> = {}) => ({
	id: `relay/${modelId}`, providerId: "relay", modelId, name: modelId,
	contextWindow: 400_000, maxOutputTokens: 128_000, supportsThinking: true, supportsImages: true, supportsTools: true,
	...extra,
});

let app: RunningApp;

async function shot(name: string) {
	await app.evaluate(
		"Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a=>a.finished.catch(()=>{}))).then(()=>new Promise(requestAnimationFrame))",
	);
	const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	const file = join(OUT, `${STAMP}_${PHASE}_${name}.png`);
	await writeFile(file, Buffer.from(data, "base64"));
	console.log(`   📸 ${file}`);
}

type Row = { label: string; detail: string };
/**
 * The open dropdown's rows: each one's name and the line under it, as drawn.
 *
 * A name too long for the row carries a hidden copy for its hover marquee (`data-ly-scroll-dup` in
 * `ScrollText`); read with it, the Russian default came out twice.
 */
const menuRows = () => app.evaluate<Row[]>(
	`[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((item) => { const body = item.querySelector(".min-w-0.flex-1"); const read = (e) => { const c = e.cloneNode(true); c.querySelectorAll("[data-ly-scroll-dup]").forEach((d) => d.remove()); return c.textContent.trim(); }; const [label, detail] = [...(body ? body.children : [])].map(read); return { label: label ?? "", detail: detail ?? "" }; })`,
);
const thinkingFor = (locale: ResolvedUiLocale, name: string) => `[aria-label=${JSON.stringify(say(locale, "agents.thinkingFor", { name }))}]`;
const buttonText = (selector: string) => app.evaluate<string>(`document.querySelector(${JSON.stringify(selector)})?.textContent.trim() ?? ""`);
/** Kana, CJK ideographs and Hangul: none of them belongs in an English row. */
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;

async function main() {
	await mkdir(OUT, { recursive: true });
	app = await startApp({
		port: PORT,
		seed: async (home) => {
			const cwd = join(home, "project");
			await mkdir(cwd, { recursive: true });
			await writeFile(join(home, "window.json"), JSON.stringify({ width: 1400, height: 900 }));
			await writeFile(join(home, "settings.json"), JSON.stringify({
				uiLocale: "en",
				permissionMode: "full",
				projectMemory: false,
				thinking: "high",
				autoSummarizeTitle: false,
				mcpServers: [],
				hooks: [],
				sync: { enabled: false },
				projects: [{ path: cwd, name: "MicroManagement", pinned: true, lastOpenedAt: Date.now() }],
				defaultModelId: "relay/gpt-5.6-sol",
				subAgentProfiles: { review: { modelId: "relay/house-model" } },
				providers: [{
					// Nothing is sent: the page under test never starts a turn.
					id: "relay", name: "Relay", api: "openai-responses", baseUrl: "http://127.0.0.1:9/v1", apiKey: "probe-key", enabled: true,
					models: [model("gpt-5.6-sol"), model("house-model", { thinkingOptions: HOUSE })],
				}],
			}));
		},
	});

	const frames: Frame[] = [];
	const stop = PHASE === "after" ? await startRecording(PORT, frames) : async () => {};
	const d = driver(app);
	/** A section of the settings sidebar, by the name it has in the current language. */
	const openSection = async (label: string) => {
		await app.evaluate(`(()=>{document.querySelector('[data-probe-nav]')?.removeAttribute('data-probe-nav');const nav=document.querySelector('.ly-settings-nav-pill')?.parentElement;const b=[...(nav ? nav.querySelectorAll('button') : [])].find((e)=>e.textContent.trim()===${JSON.stringify(label)});if(!b)throw new Error("no settings section " + ${JSON.stringify(label)});b.scrollIntoView({block:"center"});b.setAttribute('data-probe-nav','');})()`);
		await pause(300);
		await d.click("[data-probe-nav]");
		await pause(1200);
	};
	/**
	 * Marks a row of the open menu by its name, then presses it with the real mouse.
	 *
	 * By the name, not the row's text: a language row starts with its badge (「日」, 「EN」). Scrolled
	 * in first, since the menu has a height limit and the real mouse only reaches what is shown.
	 */
	const clickMenuItem = async (name: string) => {
		await app.evaluate(`(()=>{document.querySelector('[data-probe-item]')?.removeAttribute('data-probe-item');const e=[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find((b)=>b.querySelector(".min-w-0.flex-1")?.firstElementChild?.textContent.trim()===${JSON.stringify(name)});if(!e)throw new Error("no menu row " + ${JSON.stringify(name)});e.scrollIntoView({block:"nearest"});e.setAttribute('data-probe-item','');})()`);
		await pause(300);
		await d.click("[data-probe-item]");
	};
	const openDropdown = async (selector: string) => {
		await d.click(selector);
		await d.until(`document.querySelector('[role="menu"] [role="menuitem"]')`, 5000);
		await pause(900);
	};
	const closeDropdown = async () => {
		await d.key("Escape", 27);
		await d.until(`!document.querySelector('[role="menu"]')`, 5000);
		await pause(600);
	};
	const expectedLadder = (locale: ResolvedUiLocale): Row[] => [
		{ label: say(locale, "agents.defaultThinking", { level: say(locale, "thinking.high") }), detail: "" },
		...LADDER.map((id) => ({ label: say(locale, `thinking.${id}`), detail: say(locale, `thinking.detail.${id}`) })),
	];

	try {
		await app.evaluate("document.fonts.ready");
		await d.until(`document.querySelector("[data-ly-open-settings]")`, 20000);
		await pause(1000);

		console.log("① English window: Settings → Subagents");
		await d.click("[data-ly-open-settings]");
		await pause(1500);
		await openSection(say("en", "settings.agents"));
		await d.until(`document.querySelector(${JSON.stringify(thinkingFor("en", "explore"))})`, 20000);
		await pause(900);
		await shot("01_英文界面的子智能体列表");

		const exploreButton = await buttonText(thinkingFor("en", "explore"));
		const reviewButton = await buttonText(thinkingFor("en", "review"));
		console.log(`   explore 的按钮：${exploreButton} · review 的按钮：${reviewButton}`);
		if (PHASE === "after") {
			check("explore 的按钮写「Default · High」", exploreButton === "Default · High", exploreButton);
			check("review 用的是自己配的档位，按钮写「Default · 省着点」", reviewButton === "Default · 省着点", reviewButton);
		}

		console.log("② explore's dropdown: GPT-5.6 Sol's built-in levels");
		await openDropdown(thinkingFor("en", "explore"));
		const english = await menuRows();
		console.log(`   ${english.map((row) => (row.detail ? `${row.label}（${row.detail}）` : row.label)).join(" / ")}`);
		await shot("02_explore的思考等级下拉");
		if (PHASE === "after") {
			const want = expectedLadder("en");
			check("名字依次是 Default · High / Off / Low / Medium / High / Extra high / Max", english.map((row) => row.label).join("/") === want.map((row) => row.label).join("/"), english.map((row) => row.label).join("/"));
			check("每一档下面那行说明是英文的那句", english.map((row) => row.detail).join("|") === want.map((row) => row.detail).join("|"), english.map((row) => row.detail).join("|"));
			check("整个下拉里一个中文字都没有", !english.some((row) => CJK.test(row.label + row.detail)), JSON.stringify(english));
		}
		await closeDropdown();

		console.log("③ review's dropdown: levels configured on the model keep their own words");
		await openDropdown(thinkingFor("en", "review"));
		const house = await menuRows();
		console.log(`   ${house.map((row) => (row.detail ? `${row.label}（${row.detail}）` : row.label)).join(" / ")}`);
		await shot("03_自己配的档位保留原文");
		if (PHASE === "after") {
			const want: Row[] = [{ label: "Default · 省着点", detail: "" }, ...HOUSE.map(({ label, detail }) => ({ label, detail }))];
			check("「自适应」「省着点」和它们的说明原样列出，标准 id 的 low 也不被换成 Low", JSON.stringify(house) === JSON.stringify(want), JSON.stringify(house));
		}
		await closeDropdown();
		if (PHASE === "before") return;

		console.log("④ The other six languages, switched in Settings → General while the page stays mounted");
		let from: ResolvedUiLocale = "en";
		for (const [index, locale] of LOCALES.entries()) {
			await openSection(say(from, "settings.general"));
			await openDropdown(`[aria-label=${JSON.stringify(say(from, "language.title"))}]`);
			await clickMenuItem(say(from, `language.${locale}`));
			await pause(1200);
			await openSection(say(locale, "settings.agents"));
			await d.until(`document.querySelector(${JSON.stringify(thinkingFor(locale, "explore"))})`, 10000);
			const button = await buttonText(thinkingFor(locale, "explore"));
			await openDropdown(thinkingFor(locale, "explore"));
			const rows = await menuRows();
			const want = expectedLadder(locale);
			console.log(`   ${locale}: ${rows.map((row) => row.label).join(" / ")}`);
			check(
				`${locale}：按钮「${want[0].label}」，七行名字和说明都是这种语言的`,
				button === want[0].label && JSON.stringify(rows) === JSON.stringify(want),
				`${button} · ${JSON.stringify(rows)}`,
			);
			await shot(`${String(index + 4).padStart(2, "0")}_${locale}_explore的思考等级下拉`);
			await closeDropdown();
			from = locale;
		}

		console.log("⑤ Back in Chinese, the configured levels are still their own words");
		await openDropdown(thinkingFor("zh-CN", "review"));
		const houseZh = await menuRows();
		check("中文界面里 review 的下拉仍是「默认 · 省着点 / 自适应 / 省着点」", houseZh.map((row) => row.label).join("/") === "默认 · 省着点/自适应/省着点", houseZh.map((row) => row.label).join("/"));
		await closeDropdown();
		await pause(1000);
	} catch (error) {
		// Counted, so a run that died halfway cannot print a full score for the part it reached.
		check("剧本从头跑到尾", false, error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	} finally {
		await stop();
		await app.stop();
		if (PHASE === "after") {
			const passed = checks.filter((one) => one.ok).length;
			const video = join(OUT, `${STAMP}_子智能体档位七种语言_${passed}of${checks.length}.mp4`);
			if (frames.length > 0) await encode(frames, video);
			console.log(`\n${passed}/${checks.length} 通过 · 🎬 ${video}`);
			if (passed !== checks.length) process.exitCode = 1;
		}
	}
}

await main();
