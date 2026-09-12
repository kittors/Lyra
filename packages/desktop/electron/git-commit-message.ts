/**
 * A commit message written by the configured model, from the actual diff.
 *
 * The wand in the Git panel used to invent `feat: 更新 foo、bar 的改动` from file names. That is
 * a script, not a model, and it is why the button felt fake. This asks the same model a conversation
 * would, with no tools, about the patch that is actually staged (or the working tree, if nothing
 * is staged).
 */

import {
	resolveModel,
	streamAssistant,
	type AssistantMessage,
	type Settings,
	type TextContent,
} from "@lyra/core";
import { getSettings } from "./app-settings.ts";
import { git } from "./git-exec.ts";

const PATCH_LIMIT = 16_000;

/** Same ids as `src/components/git/commit-language.ts`. Unknown ids fall back to Chinese. */
export const COMMIT_LANGUAGE_PROSE: Record<string, string> = {
	zh: "Write the commit message in Simplified Chinese.",
	en: "Write the commit message in English.",
	ja: "Write the commit message in Japanese.",
	ko: "Write the commit message in Korean.",
	es: "Write the commit message in Spanish.",
	fr: "Write the commit message in French.",
	de: "Write the commit message in German.",
	pt: "Write the commit message in Portuguese.",
	ru: "Write the commit message in Russian.",
};

export function buildCommitPrompt(
	patch: string,
	language: string,
	source: "staged" | "unstaged",
): { system: string; user: string } {
	const languageLine = COMMIT_LANGUAGE_PROSE[language] ?? COMMIT_LANGUAGE_PROSE.zh;
	const scope =
		source === "staged"
			? "This patch is what is currently staged and will go into the next commit."
			: "Nothing is staged. This patch is the unstaged working tree; describe that work anyway.";
	return {
		system: [
			"You write git commit messages.",
			"Use Conventional Commits: type(optional-scope): subject.",
			"Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore.",
			"The first line is the subject, at most 72 characters, no trailing period.",
			"Add a blank line and a short body only when the subject cannot carry the change.",
			"Do not wrap the message in markdown fences or quotes.",
			"Do not mention being an AI, and do not invent files that are not in the patch.",
			languageLine,
		].join(" "),
		user: `${scope}\n\n${patch}`,
	};
}

export function cleanCommitMessage(raw: string): string {
	let text = raw.trim();
	if (text.startsWith("```")) {
		text = text.replace(/^```[a-zA-Z0-9_-]*\s*/, "").replace(/\s*```$/, "").trim();
	}
	if (
		(text.startsWith('"') && text.endsWith('"')) ||
		(text.startsWith("'") && text.endsWith("'"))
	) {
		text = text.slice(1, -1).trim();
	}
	return text;
}

function assistantText(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("")
		.trim();
}

export async function collectCommitPatch(
	cwd: string,
): Promise<{ patch: string; source: "staged" | "unstaged" } | null> {
	const staged = await git(cwd, ["diff", "--cached", "--no-color"]).catch(() => "");
	if (staged.trim()) return { patch: cap(staged), source: "staged" };

	const unstaged = await git(cwd, ["diff", "--no-color"]).catch(() => "");
	const untracked = await git(cwd, ["ls-files", "--others", "--exclude-standard"]).catch(() => "");
	const parts: string[] = [];
	if (unstaged.trim()) parts.push(unstaged.trim());
	if (untracked.trim()) {
		parts.push(
			"Untracked files:\n" +
				untracked
					.trim()
					.split("\n")
					.map((path) => `  ${path}`)
					.join("\n"),
		);
	}
	if (parts.length === 0) return null;
	return { patch: cap(parts.join("\n\n")), source: "unstaged" };
}

export async function generateCommitMessage(
	cwd: string,
	options: {
		settings?: Settings;
		stream?: typeof streamAssistant;
		readPatch?: typeof collectCommitPatch;
	} = {},
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
	const settings = options.settings ?? getSettings();
	if (!settings) return { ok: false, error: "还没有读到设置" };

	const resolved = resolveModel(settings, settings.defaultModelId);
	if (!resolved) return { ok: false, error: "请先在设置里配置一个默认模型" };

	const readPatch = options.readPatch ?? collectCommitPatch;
	const collected = await readPatch(cwd);
	if (!collected) return { ok: false, error: "没有可供生成提交信息的改动" };

	const language = settings.commitLanguage ?? "zh";
	const prompt = buildCommitPrompt(collected.patch, language, collected.source);
	const stream = options.stream ?? streamAssistant;

	try {
		const gen = stream(
			resolved.provider,
			resolved.model,
			{
				systemPrompt: prompt.system,
				messages: [{ role: "user", content: [{ type: "text", text: prompt.user }], timestamp: Date.now() }],
				tools: [],
			},
			{
				thinking: "off",
				maxTokens: 400,
				retryAttempts: 2,
				signal: AbortSignal.timeout(45_000),
			},
		);
		let next = await gen.next();
		while (!next.done) {
			if (next.value.type === "error") return { ok: false, error: next.value.error };
			next = await gen.next();
		}
		const text = cleanCommitMessage(assistantText(next.value));
		if (!text) return { ok: false, error: "模型没有写出提交说明" };
		return { ok: true, message: text };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}

function cap(text: string): string {
	if (text.length <= PATCH_LIMIT) return text;
	return `${text.slice(0, PATCH_LIMIT)}\n\n[diff truncated]`;
}
