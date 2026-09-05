/**
 * 同名冲突的两个动作：看差异，改用那个。
 *
 * 设置页能列出谁盖了谁，但「差在哪」和「怎么换」以前都要去开文件。这里补上：diff 由主进程算
 * （它能读任意路径，也认得没有文件的内置规则），偏好写进本机的 settings.json——写完把路径
 * 交回去，页面要把它显示出来，不然下次找不到自己改了什么。
 */

import { ipcMain } from "electron";
import { readFile } from "node:fs/promises";
import { BUILTIN_RULES, computeDiff, settingsPath } from "@lyra/core";
import { applySettings, settings } from "../app-settings.ts";
import { sessions } from "../session-hub.ts";

type Kind = "rule" | "skill";
type BuiltinRule = (typeof BUILTIN_RULES)[number];

/** 内置规则没有文件；按它会被写成的样子拼一份，让 diff 有东西可比。 */
function builtinRuleText(rule: BuiltinRule): string {
	const head: string[] = [];
	if (rule.description) head.push(`description: ${rule.description}`);
	if (rule.alwaysApply) head.push("alwaysApply: true");
	if (rule.conditions.length > 0) head.push(`condition: [${rule.conditions.map((c: RegExp) => JSON.stringify(c.source)).join(", ")}]`);
	if (rule.globs && rule.globs.length > 0) head.push(`globs: [${rule.globs.map((g: string) => JSON.stringify(g)).join(", ")}]`);
	return `---\n${head.join("\n")}\n---\n${rule.content}`;
}

async function textOf(kind: Kind, path: string): Promise<string> {
	if (kind === "rule" && path.startsWith("builtin:")) {
		const rule = BUILTIN_RULES.find((r) => r.path === path);
		return rule ? builtinRuleText(rule) : "";
	}
	return readFile(path, "utf8");
}

export function registerCapabilitiesIpc(): void {
	/** 赢家在前、输家在后：hunk 里的「+」是输家多出来的，也就是改用它会多出什么。 */
	ipcMain.handle("capabilities:diff", async (_event, kind: Kind, winner: string, loser: string) => {
		const [before, after] = await Promise.all([textOf(kind, winner), textOf(kind, loser)]);
		const diff = computeDiff(before, after);
		return { hunks: diff.hunks, added: diff.added, removed: diff.removed, winner, loser };
	});

	ipcMain.handle("capabilities:prefer", async (_event, kind: Kind, name: string, path: string) => {
		const current = settings();
		await applySettings({ ...current, capabilityPreferences: { ...current.capabilityPreferences, [`${kind}:${name}`]: path } });
		// 开着的会话立刻跟上，跟关掉一条规则时一样：人刚做的动作就是「用那个」。
		for (const session of sessions.values()) await session.can.reloadRules(session.cwd, settings()).catch(() => {});
		return { wroteTo: settingsPath() };
	});
}
