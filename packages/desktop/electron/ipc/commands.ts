/**
 * Slash commands, from the four directories they can live in to the composer that lists them.
 *
 * Read on demand rather than cached. The files are small, there are rarely more than a few dozen,
 * and the alternative is a list that goes stale the moment someone edits one in another window —
 * which is exactly what people do with these, since editing a command is editing a text file.
 */

import { ipcMain, shell } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { builtinCommandsFor, collectSkills, commandSources, loadCommands, loadPlugins, lyraHome, type BuiltinCommand, type SlashCommand } from "@lyra/core";
import { settings } from "../app-settings.ts";

export interface CommandsList {
	commands: SlashCommand[];
	/** 内建命令。名字和说明在 core，动作由各个宿主实现。 */
	builtins: BuiltinCommand[];
	diagnostics: { path: string; message: string }[];
	/**
	 * The skills the same project can use, offered in the same menu.
	 *
	 * A plugin's whole promise is that its skills are callable — waza's own manifest says
	 * 「callable as /waza:think, /waza:check …」 — and until now nothing in the app could call one.
	 * The agent picked them up on its own judgement and there was no way to ask for one by name, so
	 * a bundle you installed deliberately could sit there for a week without running once.
	 *
	 * The same list the session hands the model (`collectSkills`), so the menu cannot offer a skill
	 * the agent does not have.
	 */
	skills: SkillEntry[];
}

/** What the menu needs to offer a skill. The body is not sent; the model reads it when asked. */
export interface SkillEntry {
	name: string;
	description: string;
	source: "workspace" | "user" | "builtin";
	/** Set when it came from a bundle, which is also how it is named: `<plugin>:<skill>`. */
	pluginId?: string;
}

/** Where a newly created command goes, per scope. Only ours — nothing writes into `.claude`. */
function directoryFor(scope: "workspace" | "user", cwd: string): string {
	return scope === "workspace" ? join(cwd, ".lyra", "commands") : join(lyraHome(), "commands");
}

/**
 * What a new command file starts as.
 *
 * A working example rather than an empty file: the frontmatter keys that matter, one placeholder,
 * and a sentence saying what happens if you ignore it. Someone who has never written one of these
 * can rename the file, change the last line, and have a command — which is the difference between
 * a feature people try once and one they keep.
 */
function template(name: string): string {
	return `---
description: ${name} 是做什么的，一句话
argument-hint: <可选：这个命令接受什么参数>
---

在这里写下你希望 Agent 执行的指令。

用 $ARGUMENTS 代表你在命令后面输入的全部内容，或者用 $1、$2 分别取第一个、第二个参数。
如果这里一个占位符都没写，你输入的内容会被附加到末尾——所以留空也能用。
`;
}

export function registerCommandsIpc(): void {
	/*
	 * `cwd` may be empty: the settings window opens before any project is chosen, and a chat with
	 * no checkout behind it never has one. User-level commands still apply in both cases.
	 */
	ipcMain.handle("commands:list", async (_event, cwd: string): Promise<CommandsList> => {
		const { commands, diagnostics } = await loadCommands(commandSources(cwd || null, lyraHome()));
		/*
		 * Read fresh rather than taken from a live session: the menu opens whether or not one is
		 * running, and installing a plugin has to show up without restarting anything.
		 */
		const bundles = await loadPlugins(
			[
				{ dir: join(cwd || lyraHome(), ".lyra", "plugins"), source: "workspace" as const },
				{ dir: join(lyraHome(), "plugins"), source: "user" as const },
			],
			[],
		).catch(() => ({ plugins: [] }));
		const { skills } = await collectSkills(cwd || lyraHome(), bundles.plugins, settings()).catch(() => ({ skills: [] }));
		return {
			commands,
			diagnostics,
			/*
			 * 内建命令跟着一起回去。
			 *
			 * 这一页回答的是「有哪些命令可以用」，而在此之前它的答案漏了 `/compact` `/clear`
			 * `/commands` ——那三条只有 `/` 菜单知道，因为它们写在那个组件里。一个列表漏掉了
			 * 用得最多的三条，比没有这个列表更误导。
			 */
			builtins: builtinCommandsFor(["compact", "clear", "manage-commands"]),
			skills: skills.map((skill) => ({
				name: skill.name,
				description: skill.description,
				source: skill.source,
				...(skill.pluginId ? { pluginId: skill.pluginId } : {}),
			})),
		};
	});

	/**
	 * Create the file and answer with its path, so the caller can open it for editing.
	 *
	 * Refuses to overwrite. Creating a command that silently replaced one you already had would be
	 * a way to lose work with two clicks, and the name is the one thing the user typed.
	 */
	ipcMain.handle(
		"commands:create",
		async (
			_event,
			scope: "workspace" | "user",
			name: string,
			cwd: string,
		): Promise<{ ok: true; path: string } | { ok: false; error: string }> => {
			const clean = name.trim().toLowerCase();
			if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(clean)) {
				return { ok: false, error: "命令名只能用小写字母、数字和连字符，例如 review-diff。" };
			}
			if (scope === "workspace" && !cwd) return { ok: false, error: "先打开一个项目，才能创建项目级命令。" };

			const dir = directoryFor(scope, cwd);
			const path = join(dir, `${clean}.md`);
			try {
				await mkdir(dir, { recursive: true });
				// `wx` fails when it is already there, which is the check and the write in one step.
				await writeFile(path, template(clean), { flag: "wx" });
			} catch (error) {
				const code = (error as NodeJS.ErrnoException).code;
				if (code === "EEXIST") return { ok: false, error: `已经有一个叫 ${clean} 的命令了。` };
				return { ok: false, error: error instanceof Error ? error.message : String(error) };
			}
			return { ok: true, path };
		},
	);

	ipcMain.handle("commands:reveal", async (_event, scope: "workspace" | "user", cwd: string): Promise<string> => {
		const dir = directoryFor(scope, cwd);
		await mkdir(dir, { recursive: true });
		await shell.openPath(dir);
		return dir;
	});

	/** Open one command file in whatever the system uses for markdown. */
	ipcMain.handle("commands:open", async (_event, path: string): Promise<void> => {
		await shell.openPath(path);
	});
}
