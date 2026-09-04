/**
 * Answering the card that offers to turn a correction into a rule.
 *
 * Three calls, and the interesting one is the preview: the file is rendered in the main process
 * rather than in the window, so what the card shows is produced by the same function that writes
 * the file. A second renderer in the UI would drift, and the direction it would drift is the one
 * that matters — somebody approving text that is not what lands on disk.
 *
 * Both answers go through the session, which is where the offer budget lives. A window that
 * dismissed a card without telling the session would leave it free to ask again immediately.
 */

import { ipcMain } from "electron";
import { join } from "node:path";
import { collectRules, FOREIGN_USER_SOURCES, loadPlugins, lyraHome, renderRuleFile, type CorrectionSuggestion, type RuleDestination } from "@lyra/core";
import { applySettings, settings } from "../app-settings.ts";
import { sessions } from "../session-hub.ts";

export function registerRulesIpc(): void {
	/**
	 * 这个项目现在有哪些规则——包括被关掉的和被同名文件盖掉的。
	 *
	 * 直接扫盘而不是问会话：这一页在第一个会话存在之前就能打开，而「打开设置看看有什么规则」
	 * 不该先付出加载技能、连 MCP 的代价。
	 */
	ipcMain.handle("rules:list", async (_event, cwd: string) => {
		const loaded = await loadPlugins(
			[
				{ dir: join(cwd, ".lyra", "plugins"), source: "workspace" as const },
				{ dir: join(lyraHome(), "plugins"), source: "user" as const },
			],
			settings().disabledPlugins,
		);
		return {
			...(await collectRules(cwd, settings(), loaded.plugins)),
			/*
			 * 有哪些外部工具的个人规则可以勾，跟着列表一起回去。
			 *
			 * 从 core 的 `SPECS` 派生，界面不再抄一份——一个只在 core 里加了、界面上没有的
			 * 工具，等于一个永远勾不上的开关。
			 */
			foreignUserSources: FOREIGN_USER_SOURCES,
			enabledForeignUserRules: settings().enabledForeignUserRules ?? [],
		};
	});

	/** 勾或取消一个外部工具的个人规则目录。 */
	ipcMain.handle("rules:setForeignUser", async (_event, id: string, enabled: boolean) => {
		const current = settings();
		const on = new Set(current.enabledForeignUserRules ?? []);
		if (enabled) on.add(id);
		else on.delete(id);
		await applySettings({ ...current, enabledForeignUserRules: [...on] });
		for (const session of sessions.values()) await session.can.reloadRules(session.cwd, settings()).catch(() => {});
	});

	/** 关掉或打开一条规则。按名字记，所以同名的一起。 */
	ipcMain.handle("rules:setDisabled", async (_event, name: string, disabled: boolean) => {
		const current = settings();
		const off = new Set(current.disabledRules ?? []);
		if (disabled) off.add(name);
		else off.delete(name);
		await applySettings({ ...current, disabledRules: [...off] });
		/*
		 * 已经开着的会话要立刻跟上。
		 *
		 * 不这样的话，在设置里关掉一条规则，正在跑的那个对话还会继续被它拦——而人刚刚做的
		 * 动作明确就是「别再拦我了」。
		 */
		for (const session of sessions.values()) await session.can.reloadRules(session.cwd, settings()).catch(() => {});
	});

	/** The markdown a suggestion becomes — what the card shows, and what gets saved. */
	ipcMain.handle("rules:preview", async (_event, suggestion: CorrectionSuggestion) => renderRuleFile(suggestion));

	ipcMain.handle(
		"rules:keep",
		async (_event, sessionId: string, scope: RuleDestination, name: string, content: string) => {
			const session = sessions.get(sessionId);
			/*
			 * A closed session means there is nowhere to save it *to*: the destination depends on the
			 * session's own cwd. Refusing loudly is better than guessing a project directory.
			 */
			if (!session) throw new Error("这个会话已经关掉了，规则没有保存。");
			return session.keepSuggestedRule(scope, name, content);
		},
	);

	ipcMain.handle("rules:decline", async (_event, sessionId: string) => {
		sessions.get(sessionId)?.declineSuggestedRule();
	});
}
