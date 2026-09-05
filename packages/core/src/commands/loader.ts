/**
 * Slash commands: prompts the user has written down and can run by name.
 *
 * A command is a markdown file. Its body is a prompt template, its frontmatter says what the
 * command is for, and typing `/name` in the composer sends the body instead of the name. That is
 * the whole idea — the value is not in the mechanism but in not retyping the same careful
 * instructions every week.
 *
 * Four directories are searched, and two of them are not ours:
 *
 *   <project>/.lyra/commands/**\/*.md     the project's own, shared through the repository
 *   ~/.lyra/commands/**\/*.md             yours, everywhere
 *   <project>/.claude/commands/**\/*.md   what Claude Code reads
 *   ~/.claude/commands/**\/*.md
 *
 * Reading `.claude` is deliberate. That layout is what most people who write these already have,
 * this repository included, and a command file is a prompt in a markdown file — there is nothing
 * in it that belongs to one program. Refusing to read them would mean asking everyone to copy
 * their commands across to be told the same thing back, which is a worse product for no reason
 * beyond wanting our directory to be the only one that counts.
 *
 * Nested directories become namespaced names: `git/commit.md` is `/git:commit`. It is how the same
 * convention names them elsewhere, and it keeps a folder of twenty related commands legible in a
 * list.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { parseFrontmatter } from "../skills/loader.ts";

export interface SlashCommand {
	/** What you type after the slash. Namespaced by directory: `git/commit.md` is `git:commit`. */
	name: string;
	/** One line, shown beside the name while choosing. */
	description: string;
	/** The prompt template, frontmatter removed. */
	content: string;
	/** Absolute path to the file, so the UI can open it for editing. */
	path: string;
	/** Whether it travels with the project or with the user. */
	scope: "workspace" | "user";
	/**
	 * Which convention it was found under.
	 *
	 * Worth surfacing rather than hiding: someone who cannot find the file they are looking at is
	 * usually looking in the wrong one of two directories that both exist.
	 */
	origin: "lyra" | "claude" | "agents";
	/** From frontmatter `argument-hint`. Shown as a placeholder once the command is chosen. */
	argumentHint?: string;
	/**
	 * 展开后的文本怎么送出去。默认 `prompt`。
	 *
	 * 三种投递方式对应三个真实的场景，而在此之前只有第一种：
	 *
	 *   `prompt`   开一个新回合。绝大多数命令是这个——「帮我审一下这个 diff」。
	 *   `steer`    插进正在跑的那个回合。`/focus 只看 src/` 是在模型已经跑偏的时候说的，
	 *              等它停下来再说，那一轮的钱已经花完了。
	 *   `followUp` 排在当前回合之后。「跑完之后顺手把测试也跑一遍」——不打断，但也不用人守着。
	 *
	 * 会话空闲时三者等价（都是开一个新回合），差别只在有东西正在跑的时候。
	 */
	deliver?: CommandDelivery;
}

/** 一条命令展开后怎么送出去。 */
export type CommandDelivery = "prompt" | "steer" | "followUp";

const DELIVERIES: CommandDelivery[] = ["prompt", "steer", "followUp"];

export interface CommandDiagnostic {
	path: string;
	message: string;
}

/** Lowercase kebab-case, in colon-separated segments. */
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?::[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
const MAX_DESCRIPTION = 200;
/**
 * How deep to walk into a commands directory.
 *
 * Deep enough for the one level of grouping people actually use, shallow enough that pointing
 * this at a directory which happens to contain a checkout does not walk it.
 */
const MAX_DEPTH = 3;

export interface CommandSource {
	dir: string;
	scope: SlashCommand["scope"];
	origin: SlashCommand["origin"];
}

/**
 * Every command directory that could apply, in the order that decides collisions.
 *
 * Project before user, ours before Claude's. The first is the ordinary rule for layered
 * configuration — the repository you are in is more specific than your home directory. The second
 * is only a tie-break, and it points this way so that a command written for Lyra can deliberately
 * shadow one of the same name found elsewhere.
 */
export function commandSources(cwd: string | null, home: string): CommandSource[] {
	const sources: CommandSource[] = [];
	if (cwd) sources.push({ dir: join(cwd, ".lyra", "commands"), scope: "workspace", origin: "lyra" });
	sources.push({ dir: join(home, "commands"), scope: "user", origin: "lyra" });
	if (cwd) sources.push({ dir: join(cwd, ".claude", "commands"), scope: "workspace", origin: "claude" });
	sources.push({ dir: join(claudeHome(), "commands"), scope: "user", origin: "claude" });
	return sources;
}

/** Where Claude Code keeps its user-level configuration. */
function claudeHome(): string {
	return process.env.CLAUDE_CONFIG_DIR || join(process.env.HOME || process.env.USERPROFILE || "", ".claude");
}

export async function loadCommands(
	sources: CommandSource[],
): Promise<{ commands: SlashCommand[]; diagnostics: CommandDiagnostic[] }> {
	const commands: SlashCommand[] = [];
	const diagnostics: CommandDiagnostic[] = [];
	/** name → the file that won it, so a shadowing diagnostic can name the winner. */
	const seen = new Map<string, string>();

	for (const source of sources) {
		for (const file of await walk(source.dir, MAX_DEPTH)) {
			const raw = await readFile(file, "utf8").catch(() => null);
			if (raw === null) continue;

			const parsed = parseFrontmatter(raw);
			if (!parsed) {
				diagnostics.push({ path: file, message: "文件开头的 YAML 无法解析。" });
				continue;
			}
			if (parsed.problem) diagnostics.push({ path: file, message: "开头的 `---` 没有闭合，整个文件都被当成了正文。" });
			const { frontmatter, body } = parsed;

			const name =
				typeof frontmatter.name === "string" && frontmatter.name.trim()
					? frontmatter.name.trim()
					: nameFrom(source.dir, file);
			if (!NAME_PATTERN.test(name)) {
				diagnostics.push({ path: file, message: `命令名只能是小写字母、数字和连字符，用冒号分组；当前是“${name}”。` });
				continue;
			}

			/*
			 * A description is wanted but not required.
			 *
			 * A skill without one is unusable — the model picks skills by reading descriptions. A
			 * command is picked by a person who already knows what they meant when they wrote it,
			 * so refusing to load one over a missing line would be pedantry that costs the user a
			 * command. The first line of the body stands in.
			 */
			const described =
				typeof frontmatter.description === "string" && frontmatter.description.trim()
					? frontmatter.description.trim()
					: firstLine(body);
			const description = described.length > MAX_DESCRIPTION ? `${described.slice(0, MAX_DESCRIPTION - 1)}…` : described;

			/*
			 * 写错的投递方式当没写，并且说出来。
			 *
			 * 静默退回 `prompt` 的话，一条写着 `deliver: steering`（少个 -ing 的拼法）的命令
			 * 会安静地变成普通命令——而它跟正确的那条唯一的区别，是在模型跑偏时不起作用，
			 * 那正是写它的人最不会去测的时刻。
			 */
			const rawDeliver = frontmatter.deliver ?? frontmatter["delivery"];
			let deliver: CommandDelivery | undefined;
			if (typeof rawDeliver === "string" && rawDeliver.trim()) {
				const value = rawDeliver.trim() as CommandDelivery;
				if (DELIVERIES.includes(value)) deliver = value;
				else diagnostics.push({ path: file, message: `\`deliver\` 只能是 ${DELIVERIES.join("、")}；当前是“${rawDeliver}”，已按 prompt 处理。` });
			}

			/*
			 * Earlier sources win; a later file of the same name is shadowed rather than an error.
			 *
			 * The shadowing is right and stays. Doing it in silence was not: someone whose `/deploy`
			 * started behaving like someone else's had nothing to look at — the command list showed
			 * exactly one `/deploy`, and it was not theirs.
			 */
			const winner = seen.get(name);
			if (winner) {
				diagnostics.push({ path: file, message: `命令“${name}”已由 ${winner} 定义，这一个被遮蔽了。` });
				continue;
			}
			seen.set(name, file);

			const hint = frontmatter["argument-hint"];
			commands.push({
				name,
				description,
				content: body.trim(),
				path: file,
				scope: source.scope,
				origin: source.origin,
				argumentHint: typeof hint === "string" && hint.trim() ? hint.trim() : undefined,
				deliver,
			});
		}
	}

	commands.sort((a, b) => a.name.localeCompare(b.name));
	return { commands, diagnostics };
}

/** `<dir>/git/commit.md` under `<dir>` becomes `git:commit`. */
function nameFrom(dir: string, file: string): string {
	return relative(dir, file)
		.replace(/\.md$/i, "")
		.split(sep)
		.join(":")
		.toLowerCase();
}

/** The first line with anything on it, minus the heading marks a template usually opens with. */
function firstLine(body: string): string {
	for (const line of body.split("\n")) {
		const text = line.replace(/^#+\s*/, "").trim();
		if (text) return text;
	}
	return "";
}

/** Every `.md` file under a directory, depth-limited, returning nothing when it does not exist. */
async function walk(dir: string, depth: number): Promise<string[]> {
	if (depth <= 0) return [];
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
	if (!entries) return [];

	const files: string[] = [];
	for (const entry of entries) {
		// A dotfile in a commands directory is editor debris, not a command.
		if (entry.name.startsWith(".")) continue;
		const path = join(dir, entry.name);
		if (entry.isDirectory()) files.push(...(await walk(path, depth - 1)));
		else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) files.push(path);
	}
	return files.sort();
}
