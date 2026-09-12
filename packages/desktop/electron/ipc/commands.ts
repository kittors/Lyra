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
import { lyraHome } from "@lyra/core";
import { registerReferenceFiles } from "../reference-files.ts";
import { settings } from "../app-settings.ts";
import { listCommands, type CommandsList } from "../commands-service.ts";

export type { SkillEntry } from "../commands-service.ts";

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
		const result = await listCommands(cwd, settings());
		await registerReferenceFiles(result.skills.flatMap(skill => skill.path ? [skill.path] : []));
		return result;
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
