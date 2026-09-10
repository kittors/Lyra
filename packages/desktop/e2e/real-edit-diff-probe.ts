/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 让真实模型去改一个真实文件，看会不会把 `-` 写进源码（客户问题 4）。
 *
 * 客户的截图里，改完的 Vue 文件多出了 `-import { useRegionStore } …` 这样的行——模型按 unified diff
 * 的习惯写了 `-旧行 / +新行`，而 `parsePatch` 把没有 `+` 前缀的行当正文原样收下，于是 `-` 被真的写
 * 进了文件，工具还报告成功。
 *
 * 这里故意**要求**模型用 unified diff 的写法，把那条路径逼出来。两个断言：
 *
 *   1. 文件里绝不能出现 `-import` / `-<` 这类被写进去的删除标记；
 *   2. 编辑最终要成功——守卫是「拒绝并让模型重来」，不是「从此改不动文件」。
 */

import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";

const REAL_HOME = join(homedir(), ".lyra");
const WAIT = `(ms) => new Promise((r) => setTimeout(r, ms))`;

/** 照客户截图里那个文件的形状造一份。 */
const TARGET = `import { FactoryVO } from '@/api/factory/types'
import { useRegionStore } from '@/store/modules/region'
import { RegionOption } from '@/api/region/types'
import FactoryForm from './FactoryForm.vue'
import ImportResultDialog from '@/components/ImportResultDialog'
`;

let projectDir = "";

async function seed(home: string): Promise<void> {
	await mkdir(home, { recursive: true });
	projectDir = join(home, "project");
	await mkdir(projectDir, { recursive: true });
	await writeFile(join(projectDir, "Factory.ts"), TARGET);
	const projectId = createHash("sha256").update(projectDir).digest("hex").slice(0, 16);
	await mkdir(join(home, "sessions", projectId), { recursive: true });

	for (const file of ["credentials.json", "vault.key"]) {
		await copyFile(join(REAL_HOME, file), join(home, file)).catch(() => {
			throw new Error(`没找到 ~/.lyra/${file}——真实模型调用需要它`);
		});
	}
	const real = JSON.parse(await readFile(join(REAL_HOME, "settings.json"), "utf8"));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			...real,
			// 编辑要落盘，不能停在审批上——这个 profile 是临时的，目录也是这个探针自己造的。
			permissionMode: "full",
			projects: [{ id: projectId, path: projectDir, name: "验收工程", pinned: true, lastOpenedAt: Date.now() }],
			pinnedSessionIds: [],
			sync: { enabled: false },
		}),
	);
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1400, height: 900 }));
}

let app: RunningApp;
const results: Array<{ name: string; ok: boolean; detail: string }> = [];
function check(name: string, ok: boolean, detail: string) {
	results.push({ name, ok, detail });
	console.log(`${ok ? "✅" : "❌"} ${name}\n     ${detail.replace(/\n/g, "\n     ")}`);
}

/*
 * 把 patch 的字面内容直接写给模型。
 *
 * 上一版只是「请按 unified diff 的习惯写」，而 gemini-3.8-flash-high 自己纠正成了正确格式——
 * 于是那条路径根本没被走到，测试是绿的但什么都没证明。要验守卫，就得让工具真的收到那段文本。
 * 模型在这里只当传声筒，`edit` 收到的、执行的、拒绝的，全都是真的。
 */
const PROMPT = [
	"请调用一次 edit 工具，参数完全按我给的来，一个字都不要改：",
	"",
	"path: Factory.ts",
	"tag: 先 read 一次 Factory.ts，用它头上那个 4 位 tag",
	"patch 参数的内容就是下面这五行（含开头的减号和加号）：",
	"",
	"REPLACE 2-3",
	"-import { useRegionStore } from '@/store/modules/region'",
	"-import { RegionOption } from '@/api/region/types'",
	"+import { listRegion } from '@/api/region'",
	"+import { RegionNode, RegionOption } from '@/api/region/types'",
	"",
	"如果工具拒绝了，请读懂它给的理由，然后按它说的方式重写这次编辑并完成它。",
].join("\n");

async function main() {
	app = await startApp({ port: 9414, seed });
	try {
		const turn = await app.evaluate<Record<string, unknown>>(`(async () => {
			const wait = ${WAIT};
			const field = document.querySelector("main textarea");
			const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
			setter.call(field, ${JSON.stringify(PROMPT)});
			field.dispatchEvent(new Event("input", { bubbles: true }));
			field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

			const deadline = Date.now() + 240000;
			let started = false, quiet = 0;
			while (Date.now() < deadline) {
				await wait(200);
				const turning = Boolean(document.querySelector('button[aria-label="停止"]'));
				if (turning) { started = true; quiet = 0; }
				else if (started && ++quiet > 20) break;
			}
			const list = await window.lyra.sessions.list();
			const meta = list[0];
			const snapshot = meta ? await window.lyra.sessions.open(meta.projectId, meta.id) : null;
			const messages = snapshot?.messages ?? [];
			const edits = [];
			for (const m of messages) {
				if (m.role === "assistant") {
					for (const c of m.content ?? []) if (c.type === "toolCall" && c.name === "edit") edits.push({ kind: "call", patch: (c.argumentsText ?? "").slice(0, 900) });
				}
				if (m.role === "toolResult" && m.toolName === "edit") {
					edits.push({ kind: "result", isError: Boolean(m.isError), text: (m.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("").slice(0, 400) });
				}
			}
			return { started, model: meta?.modelId ?? null, edits };
		})()`);

		const edits = turn.edits as Array<Record<string, unknown>>;
		const calls = edits.filter((e) => e.kind === "call");
		const results_ = edits.filter((e) => e.kind === "result");
		// `argumentsText` 是 JSON，换行在里面是 `\\n` 两个字符——按原义写正则会漏判，上一版就漏了。
		const wroteDiff = calls.some((c) => /(\\n|\n)-\S/.test(String(c.patch)));
		const rejected = results_.filter((r) => r.isError && /not a unified diff/i.test(String(r.text)));
		const succeeded = results_.some((r) => !r.isError);

		console.log(`\n模型：${turn.model}`);
		console.log(`edit 调用 ${calls.length} 次，结果 ${results_.length} 条；其中被判为 unified diff 而拒绝的 ${rejected.length} 条\n`);
		for (const r of results_) console.log(`  · ${r.isError ? "拒绝" : "成功"}：${String(r.text).replace(/\n/g, " ").slice(0, 160)}`);

		const after = await readFile(join(projectDir, "Factory.ts"), "utf8");
		console.log(`\n改完的文件：\n${after.split("\n").map((l) => "    " + l).join("\n")}`);

		// 这是客户看到的那个后果：源码里多出以 `-` 开头的行。
		const poisoned = after.split("\n").filter((line) => /^-\S/.test(line));
		check("源码里没有被写进去的 `-` 删除标记（问题 4）", poisoned.length === 0, poisoned.length ? `多出来的行：${JSON.stringify(poisoned)}` : "一行都没有");
		check("编辑最终成功了（守卫是拒绝重来，不是从此改不动）", succeeded, succeeded ? "有一次 edit 成功落盘" : "没有任何一次 edit 成功");
		check(
			"文件内容确实被改成了要求的样子",
			after.includes("import { listRegion } from '@/api/region'") && !after.includes("useRegionStore"),
			after.includes("listRegion") ? "新的 import 在，旧的已移除" : "没改到点上",
		);
		if (wroteDiff || rejected.length > 0) {
			check(
				"模型确实写出了 unified diff，守卫被真的触发并让它重来了（问题 4 的根）",
				rejected.length > 0 && succeeded,
				`拒绝 ${rejected.length} 次，之后成功 ${results_.filter((r) => !r.isError).length} 次`,
			);
		} else {
			console.log("ℹ️  这次模型没有按 unified diff 写，守卫没有被触发——上面三条仍然有效。");
		}
	} finally {
		const passed = results.filter((r) => r.ok).length;
		console.log(`\n${passed}/${results.length} 通过`);
		const home = app.home;
		await app.stop();
		await rm(home, { recursive: true, force: true });
		if (passed !== results.length) process.exitCode = 1;
	}
}

await main();
