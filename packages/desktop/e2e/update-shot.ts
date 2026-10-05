/**
 * The update badge and dialog, driven through a real download of the real release.
 *
 * Not a test — `node e2e/update-shot.ts` — and it is here rather than in `*.test.ts` because it
 * needs the network and a published release, which a test suite must not. What it is for is the
 * half of this feature that only exists once it is on screen: whether the ring actually closes,
 * whether pausing looks paused, whether closing the dialog leaves the badge still counting, and
 * whether there is a way back in after the announcement has been waved off.
 *
 * It walks the phases in order and photographs each one, so the sequence can be reviewed as a
 * sequence. The caller is expected to have dropped `packages/desktop/package.json` to an older
 * version first — `app.getVersion()` reads that file, and an app that is already the latest
 * version has, correctly, nothing to show.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { downloadDir } from "../electron/ipc/update-download.ts";
import { startApp } from "./app.ts";

const out = process.argv[2] ?? "/tmp/lyra-update";

async function seed(home: string): Promise<void> {
	await mkdir(home, { recursive: true });
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1180, height: 820, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: [],
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
			sync: { enabled: false, port: 4517, token: null },
			appearance: { theme: process.env.LYRA_SHOT_THEME === "light" ? "light" : "dark" },
		}),
	);
}

const app = await startApp({ port: 9452, seed });
const say = (message: string) => process.stdout.write(`${message}\n`);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Crop to the sidebar's bottom corner, which is where the badge lives and all it needs to be seen. */
async function shot(name: string, full = false): Promise<void> {
	const clip = full ? undefined : { x: 0, y: 700, width: 340, height: 120, scale: 2 };
	const picture = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png", ...(clip ? { clip } : {}) });
	await writeFile(`${out}-${name}.png`, Buffer.from(picture.data, "base64"));
	say(`  → ${out}-${name}.png`);
}

/**
 * Put the badge into `:hover` and photograph it, if this machine will let us.
 *
 * `Input.dispatchMouseEvent` was the obvious way and it does not work: a synthetic move updates
 * where the page thinks the pointer is, but the *hover* that CSS matches on is decided by the
 * compositor from the real cursor, which is wherever the person running this left it. It appeared
 * to work when the badge was large enough to sit under the cursor by luck, and stopped the moment
 * it was made smaller.
 *
 * So this reports rather than throws. A step that passes or fails on where someone left their
 * mouse is not a check, and dressing it as one costs more than the animation it covers is worth —
 * the phases either side of it are asserted properly, and this returns whether the photograph
 * beside it is worth looking at.
 */
async function hoverBadge(): Promise<boolean> {
	const box = await app.evaluate<{ x: number; y: number } | null>(`(() => {
		const badge = document.querySelector(".ly-update-dot");
		if (!badge) return null;
		const r = badge.getBoundingClientRect();
		return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
	})()`);
	if (!box) throw new Error("没有找到更新按钮");
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y, buttons: 0 });
	await wait(600);

	/*
	 * Checked, not assumed.
	 *
	 * A hover that silently fails to land produces two identical screenshots and a reviewer who
	 * concludes the animation is broken — which is exactly what happened once here, and cost a
	 * detour into `CSS.forcePseudoState` (which cannot work: `app.ts` opens a socket per call, and
	 * a `nodeId` belongs to the session that issued it).
	 */
	const open = await app.evaluate<{ hovered: boolean; label: number }>(`({
		hovered: Boolean(document.querySelector(".ly-update-dot:hover")),
		label: document.querySelector(".ly-update-version")?.getBoundingClientRect().width ?? 0,
	})`);
	if (open.hovered && open.label >= 4) return true;
	say(`   （hover 没落上，这台机器的真实光标不在角标上：${JSON.stringify(open)}——截图跳过）`);
	return false;
}

/** Move the pointer away, so the next photograph is of the resting state. */
async function unhoverBadge(): Promise<void> {
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 900, y: 300, buttons: 0 });
	await wait(500);
}

async function phase(): Promise<string> {
	return app.evaluate<string>(`window.lyra.updates.state().then((p) => JSON.stringify(p))`);
}

const dialogOpen = () => app.evaluate<boolean>(`document.body.innerText.includes("有新版本可以更新")`);
const badgeThere = () => app.evaluate<boolean>(`Boolean(document.querySelector(".ly-update-dot"))`);
const clickBadge = () => app.evaluate(`document.querySelector(".ly-update-dot")?.click()`);
const escape = () =>
	app.evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);

/** Press the button whose label contains this text, anywhere on screen. */
const press = (text: string) =>
	app.evaluate(`(() => {
		const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(${JSON.stringify(text)}));
		if (!button) throw new Error("没有找到按钮：" + ${JSON.stringify(text)});
		button.click();
		return true;
	})()`);

try {
	await wait(3500);
	const info = await app.evaluate<string>(`window.lyra.updates.check().then((i) => JSON.stringify(i))`);
	say(`检查更新：${info}`);
	if (!JSON.parse(info).available) throw new Error("没有可用更新——先把 package.json 的版本降下去");
	const latest = JSON.parse(info).latest;

	/*
	 * Start from nothing on disk.
	 *
	 * The downloader is a resuming one, and it is right to be: a complete file from an earlier run
	 * is finished work, so `start()` goes straight to `preparing`. Which means a second run of this
	 * script photographs the ending five times and never once sees a download — it did, and reported
	 * `failed` where the ring should have been, which took a while to recognise as the *feature*
	 * working rather than the phase being wrong.
	 */
	await rm(downloadDir(tmpdir(), latest), { recursive: true, force: true });

	say("1. 静止：应当是一个圆点，而且不比旁边的图标重");
	/*
	 * Measured, not eyeballed.
	 *
	 * "Too big" was the report, and a screenshot alone cannot settle it — the number that matters is
	 * the badge against the two glyphs it shares the row with. A saturated 34px disc beside a 16px
	 * hairline was the version that got reported; anything much past 20 is on the way back to it.
	 */
	const sizes = await app.evaluate<{ badge: number; help: number }>(`(() => {
		const badge = document.querySelector(".ly-update-dot").getBoundingClientRect();
		const help = [...document.querySelectorAll(".ly-sidebar-foot span")]
			.find((s) => s.textContent?.trim() === "?")
			.getBoundingClientRect();
		return { badge: Math.round(badge.height), help: Math.round(help.height) };
	})()`);
	say(`   角标 ${sizes.badge}px，旁边的 ? 是 ${sizes.help}px`);
	if (sizes.badge > sizes.help + 6) throw new Error(`角标比旁边的图标大太多：${sizes.badge} vs ${sizes.help}`);
	await shot("1-dot");

	say("2. 悬停：横向展开，显示版本号");
	if (await hoverBadge()) await shot("2-hover");
	await unhoverBadge();

	/*
	 * The screenshots below are taken on a short leash on purpose.
	 *
	 * 135MB arrives in about four seconds on this connection, so a comfortable `wait(4000)` before
	 * photographing "downloading" photographs a download that has already finished. Everything in
	 * this section is therefore measured in a few hundred milliseconds.
	 */
	say("3. 从弹窗里按下载，然后立刻关掉弹窗——这是被报上来的那一步");
	await clickBadge();
	await wait(400);
	if (!(await dialogOpen())) throw new Error("点角标没有打开弹窗");
	await press("下载安装");
	await wait(400);
	await escape();
	await wait(200);
	if (await dialogOpen()) throw new Error("Escape 没有关掉弹窗");

	say("4. 弹窗关了，角标该继续报进度");
	// `[data-ring]`, not `svg`: the glyph in the middle is an SVG too, so the loose selector matched
	// the warning triangle of a failed download and reported a ring in the one phase that has none.
	const ring = await app.evaluate<{ ring: boolean; phase: string }>(`({
		ring: Boolean(document.querySelector(".ly-update-dot [data-ring]")),
		phase: document.querySelector(".ly-update-dot")?.dataset.phase ?? "(没有角标)",
	})`);
	say(`   角标状态 ${ring.phase}，进度环 ${ring.ring}`);
	if (!ring.ring) throw new Error("关掉弹窗之后角标没有进度环——这正是被报上来的问题");
	// Stated as `downloading` rather than "not idle": a run that reached the ending early is a run
	// that photographed nothing, and it should say so instead of passing on a technicality.
	if (ring.phase !== "downloading") throw new Error(`这时候本该正在下载，实际是 ${ring.phase}`);
	const before = JSON.parse(await phase());
	/*
	 * Waited for, not slept past.
	 *
	 * GitHub answers a release asset with a redirect to its object store, so the gap between
	 * `downloading` being announced and anything arriving is a DNS lookup, a TLS handshake and a
	 * second request. At 700ms this read `0 → 0` and called the download stopped, on a download
	 * that was merely still connecting — and a fixed three seconds is the same mistake with a
	 * larger number: measured here, that handshake takes anywhere from 1.5s to over 4s on the same
	 * connection, so the constant that passes on a good evening reports a broken download on a bad
	 * one. What the step is actually asserting is that bytes arrive after the dialog is closed, so
	 * it waits for one and gives up only when waiting has stopped being plausible.
	 */
	const deadline = Date.now() + 20_000;
	let after = before;
	while (after.received <= before.received && after.at === "downloading" && Date.now() < deadline) {
		await wait(250);
		after = JSON.parse(await phase());
	}
	say(`   ${before.received} → ${after.received} 字节（${after.at}）`);
	if (!(after.received > before.received)) throw new Error("关掉弹窗之后下载停了");
	await shot("4-downloading-after-close");
	if (await hoverBadge()) await shot("4b-downloading-hover");
	await unhoverBadge();

	say("5. 再点角标：应当能回到弹窗，并且看到进度");
	await clickBadge();
	await wait(400);
	if (!(await dialogOpen())) throw new Error("关掉之后再点角标进不去弹窗——这正是被报上来的问题");
	await shot("5-reopened", true);

	say("6. 暂停");
	await press("暂停");
	await wait(600);
	const paused = JSON.parse(await phase());
	say(`   ${JSON.stringify(paused)}`);
	if (paused.at !== "paused") throw new Error(`暂停之后应当是 paused，实际是 ${paused.at}`);
	await shot("6-dialog-paused", true);

	say("7. 按「关闭」：弹窗该走，角标该留");
	await press("关闭");
	await wait(400);
	if (await dialogOpen()) throw new Error("「关闭」没有关掉弹窗");
	if (!(await badgeThere())) throw new Error("关掉弹窗不该把角标一起带走");
	say("   ✓ 弹窗关了，角标留着");
	await shot("7-closed-still-there");

	say("8. 把下载取消掉——这是被报上来的那一步：角标仍然该在");
	/*
	 * The regression this step exists for.
	 *
	 * 以后再说 used to hide the badge for this version, and cancelling the download then took away
	 * the last reason to keep it — so the update disappeared from the window entirely while still
	 * being available, and the only way back was 设置 → 关于, which nobody would think to look for.
	 * Now the rule is one line: a newer version exists, so the dot exists. Nothing on this screen
	 * can take it away except installing the update.
	 */
	await clickBadge();
	await wait(400);
	if (!(await dialogOpen())) throw new Error("关掉之后点角标进不去弹窗");
	await press("取消下载");
	await wait(800);
	say(`   ${await phase()}`);
	if (!(await badgeThere())) throw new Error("取消下载之后角标没了——这正是被报上来的问题");
	say("   ✓ 下载取消了，角标还在");
	await shot("8-cancelled-still-there");

	say("9. 设置 → 常规 → 关于 也说得出同一件事");
	await app.evaluate(`document.querySelector("[data-ly-open-settings]").click()`);
	await wait(600);
	await press("常规");
	await wait(600);
	// Scrolled into view before photographing: 关于 is the last section of a long page, and a
	// full-window shot of the top of it proves only that the page still scrolls.
	const about = await app.evaluate<string>(`(() => {
		const row = [...document.querySelectorAll("div")].find((d) => d.textContent?.trim().startsWith("版本当前"));
		row?.scrollIntoView({ block: "center" });
		return row?.textContent?.trim().slice(0, 80) ?? "(没有找到关于区块)";
	})()`);
	await wait(500);
	say(`   ${about}`);
	if (!about.includes(latest)) throw new Error(`关于区块没有提到新版本 ${latest}：${about}`);
	await shot("9-about", true);

	await press("查看更新");
	await wait(500);
	if (!(await dialogOpen())) throw new Error("设置里的「查看更新」没有打开弹窗");
	say("   ✓ 第二个入口通向同一个弹窗");
	await shot("10-about-dialog", true);

	say("10. 从这里重新下载，走到底");
	await press("下载安装");
	await wait(20000);
	/*
	 * `failed: 开发模式下不做就地更新` is the correct ending here, not a fault.
	 *
	 * The executable this runs is Electron's own bundle inside `node_modules`, renamed to Lyra.app;
	 * swapping it for a release would replace the runtime `pnpm dev` depends on. So the last step
	 * refuses on purpose, and what this photograph is for is that the refusal arrives as a phase
	 * with a sentence in it rather than as a button that stops responding.
	 */
	say(`   ${await phase()}`);
	await shot("11-final", true);
} finally {
	await app.stop();
}
